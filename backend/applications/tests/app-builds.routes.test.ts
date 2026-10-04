// Route tests for routes/app-builds.ts: build sessions (flag
// fuzefront.apps.build-with-agent) and marketplace publication (flag
// fuzefront.apps.marketplace-publishing). Both flag states are exercised for
// EVERY gated endpoint. Permit, the launcher, the session store, the caller
// resolver and the flag client are injected via their DI seams; `apps` is a
// compact in-memory fake knex. The SQL of the real store is covered separately
// by app-build-sessions.store.integration.test.ts (real Postgres).
process.env.LOG_LEVEL = 'silent'
process.env.APP_BUILD_READ_RATE_LIMIT = '100000'
process.env.APP_BUILD_WRITE_RATE_LIMIT = '100000'
process.env.APP_BUILD_CALLBACK_RATE_LIMIT = '100000'

import express from 'express'
import request from 'supertest'

interface Row { [k: string]: any }
const appRows: Row[] = []

function appsQuery() {
  const preds: ((r: Row) => boolean)[] = []
  const run = () => appRows.filter(r => preds.every(p => p(r)))
  const q: any = {
    where(arg: any, val?: any) {
      if (typeof arg === 'object') preds.push(r => Object.entries(arg).every(([k, v]) => r[k] === v))
      else preds.push(r => r[arg] === val)
      return q
    },
    whereNotNull(c: string) { preds.push(r => r[c] != null); return q },
    whereNull(c: string) { preds.push(r => r[c] == null); return q },
    first: async () => run()[0],
    update: async (patch: Row) => { const m = run(); m.forEach(r => Object.assign(r, patch)); return m.length },
  }
  return q
}
const fakeDb: any = (t: string) => {
  if (t !== 'apps') throw new Error(`fake-db: unexpected table ${t}`)
  return appsQuery()
}
jest.mock('../src/config/database', () => ({ db: fakeDb }))
jest.mock('../src/middleware/auth', () => ({
  authenticateToken: (req: any, res: any, next: any) => {
    req.user = req.headers['x-test-user'] ? JSON.parse(req.headers['x-test-user']) : null
    if (!req.user) return res.status(401).json({ error: 'unauthorized' })
    next()
  },
}))
jest.mock('../src/app-registry/caller', () => ({
  resolveCaller: async (u: any) => ({
    userId: u.id,
    organizationIds: u.organizationIds ?? [],
    roles: u.roles ?? [],
    isPlatformAdmin: (u.roles ?? []).includes('admin'),
  }),
}))

import { fromUuid, toUuid, parseId } from '@izzywdev/fuzefront-identity'
import { setFlagClient, FLAGS } from '../src/app-registry/flags'
import { setPermitClient } from '../src/app-registry/permit'
import { setBuilderLauncher, FuzeAgentHttpLauncher } from '../src/app-registry/builder-launcher'
import {
  setBuildSessionStore,
  encodeSessionCursor,
  decodeSessionCursor,
  type BuildSessionRow,
  type BuildSessionStore,
} from '../src/app-registry/build-sessions'
import appBuildsRouter from '../src/routes/app-builds'

// ── ids ──
const U_ALICE = '10000000-0000-4000-8000-00000000000a'
const U_BOB = '10000000-0000-4000-8000-00000000000b' // org member, not admin
const U_EVE = '10000000-0000-4000-8000-00000000000e' // outsider
const ORG = '20000000-0000-4000-8000-000000000001'
const OTHER_ORG = '20000000-0000-4000-8000-000000000002'
const ALICE_PERSONAL = '20000000-0000-4000-8000-0000000000aa'
const ORG_WIRE = fromUuid('organization', ORG)

const alice = { id: U_ALICE, roles: ['user'], organizationIds: [ORG, ALICE_PERSONAL] }
const bob = { id: U_BOB, roles: ['user'], organizationIds: [ORG] }
const eve = { id: U_EVE, roles: ['user'], organizationIds: [] as string[] }
const admin = { id: '10000000-0000-4000-8000-0000000000ff', roles: ['admin'], organizationIds: [] as string[] }
const consumer = { id: 'consumer-registration', roles: ['admin'], organizationIds: [] as string[] }
const as = (u: any) => ({ 'x-test-user': JSON.stringify(u) })

// ── in-memory session store ──
const sessions = new Map<string, BuildSessionRow>()
const roles = new Map<string, string>() // `${user}|${org}` -> role
const personalOrgs = new Map<string, string>()
const orgs = new Set<string>()
const memStore: BuildSessionStore = {
  async insert(row) { sessions.set(row.id, { ...row }) },
  async findById(id) {
    const r = sessions.get(id)
    if (!r) return null
    const app = appRows.find(a => a.id === r.app_id)
    return { ...r, app_slug: app?.slug ?? null }
  },
  async list(q) {
    let rows = [...sessions.values()].filter(r =>
      q.organizationId
        ? r.organization_id === q.organizationId && (q.includeAllInOrg || r.requested_by_user_id === q.requesterId)
        : r.requested_by_user_id === q.requesterId
    )
    rows.sort((a, b) =>
      b.created_at.getTime() - a.created_at.getTime() || (a.id < b.id ? 1 : -1))
    if (q.cursor) {
      const ct = new Date(q.cursor.createdAt).getTime()
      rows = rows.filter(r => r.created_at.getTime() < ct || (r.created_at.getTime() === ct && r.id < q.cursor!.id))
    }
    return rows.slice(0, q.limit + 1)
  },
  async transition(id, from, patch) {
    const r = sessions.get(id)
    if (!r || !from.includes(r.status)) return false
    Object.assign(r, patch)
    return true
  },
  async patch(id, patch) { Object.assign(sessions.get(id)!, patch) },
  async findPersonalOrgId(u) { return personalOrgs.get(u) ?? null },
  async orgExists(o) { return orgs.has(o) },
  async getOrgRole(u, o) { return roles.get(`${u}|${o}`) ?? null },
  async findAppBySlug(slug) {
    const a = appRows.find(r => r.slug === slug)
    return a ? { id: a.id, slug: a.slug, organization_id: a.organization_id, created_by_user_id: a.created_by_user_id ?? null } : null
  },
}

// ── toggles / spies ──
let buildFlag = true
let creatorFlag = true
let publishFlag = true
let permitGrant = true
const permitChecks: any[] = []
const assigned: any[] = []
setFlagClient({
  getBooleanValue: async (key: string, def: boolean) => {
    if (key === FLAGS.BUILD_WITH_AGENT) return buildFlag
    if (key === FLAGS.CREATOR_OWNERSHIP) return creatorFlag
    if (key === FLAGS.MARKETPLACE_PUBLISHING) return publishFlag
    return def
  },
})
const spyPermit = {
  check: async (user: string, action: string, resource: any) => { permitChecks.push({ user, action, resource }); return permitGrant },
  api: { users: { assignRole: async (d: any) => { assigned.push(d) } }, resourceInstances: { create: async () => undefined } },
}
setPermitClient(spyPermit)
let launchImpl: (i: any) => Promise<any> = async () => ({ agentSessionRef: 'sess-1', agentSessionUrl: 'https://agent.example/s/1' })
const launches: any[] = []
const stubLauncher = { launch: async (i: any) => { launches.push(i); return launchImpl(i) } }
setBuilderLauncher(stubLauncher)
setBuildSessionStore(memStore)

const app = express()
app.use(express.json())
app.use('/api/v1/app-registry', appBuildsRouter)
const B = '/api/v1/app-registry'

function manifestFor(slug: string, visibility = 'organization') {
  return JSON.stringify({ manifestVersion: '1', slug, name: slug, menuLabel: slug, mode: 'portal', visibility,
    integration: { type: 'module-federation', remoteEntry: `https://x/${slug}/remoteEntry.js`, scope: 's', module: './m' } })
}
function seedApp(slug: string, extra: Row = {}) {
  appRows.push({ id: `30000000-0000-4000-8000-0000000000${appRows.length + 10}`, slug, name: slug, status: 'registered',
    mode: 'portal', builtin: false, organization_id: ORG, manifest: manifestFor(slug), created_by_user_id: null,
    marketplace_submitted_at: null, is_marketplace_approved: false, marketplace_approved_at: null,
    approved_by: null, marketplace_metadata: '{}', created_at: new Date(), updated_at: new Date(), ...extra })
  return appRows[appRows.length - 1]
}

beforeEach(() => {
  appRows.length = 0
  sessions.clear(); roles.clear(); personalOrgs.clear(); orgs.clear()
  roles.set(`${U_ALICE}|${ORG}`, 'admin')
  roles.set(`${U_BOB}|${ORG}`, 'member')
  personalOrgs.set(U_ALICE, ALICE_PERSONAL)
  orgs.add(ORG); orgs.add(OTHER_ORG); orgs.add(ALICE_PERSONAL)
  buildFlag = true; creatorFlag = true; publishFlag = true; permitGrant = true
  permitChecks.length = 0; assigned.length = 0; launches.length = 0
  launchImpl = async () => ({ agentSessionRef: 'sess-1', agentSessionUrl: 'https://agent.example/s/1' })
  setBuilderLauncher(stubLauncher)
  setPermitClient(spyPermit)
})

async function createOrgSession(user = alice, extra: any = {}) {
  return request(app).post(`${B}/build-sessions`).set(as(user))
    .send({ context: 'organization', organizationId: ORG_WIRE, name: 'Invoicer', brief: 'Build an invoicing app', ...extra })
}

describe('createBuildSession', () => {
  it('personal: resolves the personal org, launches, returns 201 building with prefixed ids', async () => {
    const res = await request(app).post(`${B}/build-sessions`).set(as(alice))
      .send({ context: 'personal', name: 'Todo', brief: 'a todo app' })
    expect(res.status).toBe(201)
    expect(res.body.status).toBe('building')
    expect(res.body.id).toMatch(/^front_abs_/)
    expect(res.body.organizationId).toBe(fromUuid('organization', ALICE_PERSONAL))
    expect(res.body.requestedBy).toBe(fromUuid('user', U_ALICE))
    expect(res.body.agentSessionUrl).toBe('https://agent.example/s/1')
    expect(launches[0]).toMatchObject({ context: 'personal', organizationId: fromUuid('organization', ALICE_PERSONAL),
      requestedByUserId: fromUuid('user', U_ALICE), buildSessionId: res.body.id })
    // personal context never needs a Permit apps:register check
    expect(permitChecks).toHaveLength(0)
    // the stored id is the native uuid of the minted TypeID
    expect(sessions.has(toUuid(parseId('appBuildSession', res.body.id)))).toBe(true)
  })

  it('personal: 409 when the caller has no personal org (nothing persisted, no launch)', async () => {
    const res = await request(app).post(`${B}/build-sessions`).set(as(bob))
      .send({ context: 'personal', name: 'x', brief: 'y' })
    expect(res.status).toBe(409)
    expect(res.body.error).toBe('no_personal_org')
    expect(sessions.size).toBe(0); expect(launches).toHaveLength(0)
  })

  it('organization: member with apps:register builds into the org (Permit checked on that tenant)', async () => {
    const res = await createOrgSession(bob)
    expect(res.status).toBe(201)
    expect(res.body.organizationId).toBe(ORG_WIRE)
    expect(res.body.context).toBe('organization')
    expect(permitChecks[0]).toMatchObject({ action: 'apps:register', resource: { type: 'App', tenant: ORG } })
  })

  it('organization: not a member -> 403 and nothing persisted', async () => {
    const res = await createOrgSession(eve)
    expect(res.status).toBe(403)
    expect(sessions.size).toBe(0); expect(launches).toHaveLength(0)
  })

  it('organization: member without Permit apps:register -> 403', async () => {
    permitGrant = false
    const res = await createOrgSession(alice)
    expect(res.status).toBe(403)
    expect(sessions.size).toBe(0)
  })

  it('organization: platform admin bypasses membership/Permit but the org must exist', async () => {
    permitGrant = false
    expect((await createOrgSession(admin)).status).toBe(201)
    const missing = await createOrgSession(admin, { organizationId: fromUuid('organization', '20000000-0000-4000-8000-0000000000ee') })
    expect(missing.status).toBe(404)
  })

  it('service account cannot start builds (no users row)', async () => {
    expect((await createOrgSession(consumer)).status).toBe(403)
  })

  it('validation: strict body, no client id, org required iff organization, brief capped', async () => {
    const post = (b: any) => request(app).post(`${B}/build-sessions`).set(as(alice)).send(b)
    expect((await post({ context: 'personal', name: 'x', brief: 'y', id: 'front_abs_x' })).status).toBe(400)
    expect((await post({ context: 'organization', name: 'x', brief: 'y' })).status).toBe(400)
    expect((await post({ context: 'personal', organizationId: ORG_WIRE, name: 'x', brief: 'y' })).status).toBe(400)
    expect((await post({ context: 'personal', name: 'x', brief: 'y'.repeat(4001) })).status).toBe(400)
    expect((await post({ context: 'personal', name: '', brief: 'y' })).status).toBe(400)
    expect((await post({ context: 'organization', organizationId: 'org_notvalid', name: 'x', brief: 'y' })).status).toBe(400)
    expect(sessions.size).toBe(0)
  })

  it('503 builder_unavailable (and NO row) when the launcher is not configured', async () => {
    setBuilderLauncher(null)
    delete process.env.FUZEAGENT_BUILD_API_URL
    delete process.env.FUZEAGENT_BUILD_API_TOKEN
    const res = await createOrgSession(alice)
    expect(res.status).toBe(503)
    expect(res.body.error).toBe('builder_unavailable')
    expect(sessions.size).toBe(0)
  })

  it('502 launch_failed marks the row failed with error_code launch_failed', async () => {
    launchImpl = async () => { throw new Error('boom') }
    const res = await createOrgSession(alice)
    expect(res.status).toBe(502)
    expect(res.body.error).toBe('launch_failed')
    const [row] = [...sessions.values()]
    expect(row.status).toBe('failed')
    expect(row.error_code).toBe('launch_failed')
  })

  it('does not regress a session the agent already advanced while launch() was returning', async () => {
    launchImpl = async (i: any) => {
      await memStore.transition(toUuid(parseId('appBuildSession', i.buildSessionId)), ['launching'], { status: 'deploying' })
      return { agentSessionRef: 'r' }
    }
    const res = await createOrgSession(alice)
    expect(res.status).toBe(201)
    expect(res.body.status).toBe('deploying')
  })

  it('flag OFF -> 503 feature_disabled, nothing persisted, no launch', async () => {
    buildFlag = false
    const res = await createOrgSession(alice)
    expect(res.status).toBe(503)
    expect(res.body.error).toBe('feature_disabled')
    expect(sessions.size).toBe(0); expect(launches).toHaveLength(0)
  })
})

describe('FuzeAgentHttpLauncher', () => {
  const input = { buildSessionId: 'front_abs_x', organizationId: 'org_x', requestedByUserId: 'usr_x', context: 'personal' as const, name: 'n', brief: 'b' }
  afterEach(() => { jest.restoreAllMocks(); delete process.env.APP_REGISTRY_PUBLIC_BASE_URL })

  it('POSTs the documented payload with the bearer token and never logs the token', async () => {
    process.env.APP_REGISTRY_PUBLIC_BASE_URL = 'https://app.example.com/'
    const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true, status: 200, json: async () => ({ agentSessionRef: 'ref-9', agentSessionUrl: 'https://a/9' }),
    } as any)
    const out = jest.spyOn(process.stdout, 'write')
    const err = jest.spyOn(process.stderr, 'write')
    const r = await new FuzeAgentHttpLauncher('https://agent.example/build', 'SECRET-TOKEN').launch(input)
    expect(r).toEqual({ agentSessionRef: 'ref-9', agentSessionUrl: 'https://a/9' })
    const [url, init] = fetchSpy.mock.calls[0] as any
    expect(url).toBe('https://agent.example/build')
    expect(init.headers.authorization).toBe('Bearer SECRET-TOKEN')
    const body = JSON.parse(init.body)
    expect(body).toMatchObject({ ...input, callbackUrl: 'https://app.example.com/api/v1/app-registry/build-sessions/front_abs_x/status' })
    const logged = [...out.mock.calls, ...err.mock.calls].map(c => String(c[0])).join('')
    expect(logged).not.toContain('SECRET-TOKEN')
  })

  it('callbackUrl is same-origin relative when no public base URL is set', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({ ok: true, status: 200, json: async () => ({ sessionId: 's' }) } as any)
    await new FuzeAgentHttpLauncher('https://agent.example/build', 't').launch(input)
    expect(JSON.parse((fetchSpy.mock.calls[0] as any)[1].body).callbackUrl).toBe('/api/v1/app-registry/build-sessions/front_abs_x/status')
  })

  it('throws on a non-2xx and on a response with no session reference', async () => {
    jest.spyOn(global, 'fetch' as any).mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) } as any)
    await expect(new FuzeAgentHttpLauncher('https://a', 't').launch(input)).rejects.toThrow(/500/)
    jest.spyOn(global, 'fetch' as any).mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) } as any)
    await expect(new FuzeAgentHttpLauncher('https://a', 't').launch(input)).rejects.toThrow(/no session reference/)
  })
})

describe('list / get / cancel', () => {
  async function seed(n: number, user = alice, org = ORG) {
    const base = Date.now()
    for (let i = 0; i < n; i++) {
      const id = `60000000-0000-4000-8000-${String(i).padStart(12, '0')}`
      sessions.set(id, { id, organization_id: org, requested_by_user_id: user.id, context: 'organization', name: `n${i}`,
        brief: 'b', status: 'building', app_id: null, agent_session_ref: null, agent_session_url: null,
        error_code: null, error_message: null, created_at: new Date(base + Math.floor(i / 2) * 1000), updated_at: new Date() })
    }
  }

  it('paginates: envelope shape, default limit, over-max clamped to 200, cursor walks with no gaps/dupes', async () => {
    await seed(7)
    const first = await request(app).get(`${B}/build-sessions?limit=3`).set(as(alice))
    expect(first.status).toBe(200)
    expect(first.body.items).toHaveLength(3)
    expect(first.body.page).toEqual({ nextCursor: expect.any(String), hasMore: true })
    const seen = first.body.items.map((i: any) => i.id)
    let cursor = first.body.page.nextCursor
    while (cursor) {
      const r = await request(app).get(`${B}/build-sessions?limit=3&cursor=${cursor}`).set(as(alice))
      seen.push(...r.body.items.map((i: any) => i.id))
      cursor = r.body.page.nextCursor
      if (!cursor) expect(r.body.page.hasMore).toBe(false)
    }
    expect(seen).toHaveLength(7)
    expect(new Set(seen).size).toBe(7)

    const big = await request(app).get(`${B}/build-sessions?limit=100000`).set(as(alice))
    expect(big.status).toBe(200)
    expect(big.body.items).toHaveLength(7)
    // clamp is enforced server-side: the store never sees limit > 200
    const spy = jest.spyOn(memStore, 'list')
    await request(app).get(`${B}/build-sessions?limit=100000`).set(as(alice))
    expect(spy.mock.calls[0][0].limit).toBe(200)
    spy.mockRestore()
    const def = jest.spyOn(memStore, 'list')
    await request(app).get(`${B}/build-sessions`).set(as(alice))
    expect(def.mock.calls[0][0].limit).toBe(50)
    def.mockRestore()
  })

  it('400 on a malformed cursor / limit', async () => {
    expect((await request(app).get(`${B}/build-sessions?cursor=%%%`).set(as(alice))).status).toBe(400)
    expect((await request(app).get(`${B}/build-sessions?limit=0`).set(as(alice))).status).toBe(400)
  })

  it('own sessions only by default; org managers see the whole org when organizationId is given', async () => {
    await seed(2, bob)
    expect((await request(app).get(`${B}/build-sessions`).set(as(alice))).body.items).toHaveLength(0)
    const asBob = await request(app).get(`${B}/build-sessions?organizationId=${ORG_WIRE}`).set(as(bob))
    expect(asBob.body.items).toHaveLength(2) // own
    const asAliceAdmin = await request(app).get(`${B}/build-sessions?organizationId=${ORG_WIRE}`).set(as(alice))
    expect(asAliceAdmin.body.items).toHaveLength(2) // manager sees bob's
    const asEve = await request(app).get(`${B}/build-sessions?organizationId=${ORG_WIRE}`).set(as(eve))
    expect(asEve.body.items).toHaveLength(0)
  })

  it('get: requester / org manager / platform admin see it; everyone else gets 404 (never 403)', async () => {
    await seed(1, bob)
    const id = fromUuid('appBuildSession', '60000000-0000-4000-8000-000000000000')
    expect((await request(app).get(`${B}/build-sessions/${id}`).set(as(bob))).status).toBe(200)
    expect((await request(app).get(`${B}/build-sessions/${id}`).set(as(alice))).status).toBe(200) // org admin
    expect((await request(app).get(`${B}/build-sessions/${id}`).set(as(admin))).status).toBe(200)
    expect((await request(app).get(`${B}/build-sessions/${id}`).set(as(eve))).status).toBe(404)
    expect((await request(app).get(`${B}/build-sessions/front_abs_nope`).set(as(alice))).status).toBe(404)
    // a wrong-typed prefix is rejected the same way
    expect((await request(app).get(`${B}/build-sessions/${fromUuid('organization', ORG)}`).set(as(alice))).status).toBe(404)
  })

  it('cancel: requester or org manager from a non-terminal state; terminal -> 409; stranger -> 404', async () => {
    await seed(2, bob)
    const id0 = fromUuid('appBuildSession', '60000000-0000-4000-8000-000000000000')
    const id1 = fromUuid('appBuildSession', '60000000-0000-4000-8000-000000000001')
    expect((await request(app).post(`${B}/build-sessions/${id0}/cancel`).set(as(eve))).status).toBe(404)
    const ok = await request(app).post(`${B}/build-sessions/${id0}/cancel`).set(as(bob))
    expect(ok.status).toBe(200); expect(ok.body.status).toBe('cancelled')
    expect((await request(app).post(`${B}/build-sessions/${id0}/cancel`).set(as(bob))).status).toBe(409)
    expect((await request(app).post(`${B}/build-sessions/${id1}/cancel`).set(as(alice))).status).toBe(200) // org admin
  })

  it('flag OFF -> 503 on list, get and cancel', async () => {
    buildFlag = false
    const id = fromUuid('appBuildSession', '60000000-0000-4000-8000-000000000000')
    for (const r of [
      request(app).get(`${B}/build-sessions`),
      request(app).get(`${B}/build-sessions/${id}`),
      request(app).post(`${B}/build-sessions/${id}/cancel`),
    ]) {
      const res = await r.set(as(alice))
      expect(res.status).toBe(503)
      expect(res.body.error).toBe('feature_disabled')
    }
  })
})

describe('reportBuildSessionStatus (agent callback)', () => {
  let sid: string
  let uuid: string
  beforeEach(async () => {
    const res = await createOrgSession(bob)
    sid = res.body.id
    uuid = toUuid(parseId('appBuildSession', sid))
  })
  const report = (user: any, body: any, id = () => sid) =>
    request(app).post(`${B}/build-sessions/${id()}/status`).set(as(user)).send(body)

  it('only a platform admin / the service account may report; a requester may not', async () => {
    expect((await report(bob, { status: 'deploying' })).status).toBe(403)
    expect((await report(alice, { status: 'deploying' })).status).toBe(403) // org admin is not platform admin
    expect((await report(eve, { status: 'deploying' })).status).toBe(403)
    expect((await report(consumer, { status: 'deploying' })).status).toBe(200)
    expect((await report(admin, { status: 'failed', errorCode: 'x' })).status).toBe(200)
  })

  it('401 without authentication', async () => {
    expect((await request(app).post(`${B}/build-sessions/${sid}/status`).send({ status: 'deploying' })).status).toBe(401)
  })

  it('forward-only: backwards / repeat -> 409; terminal states are immutable', async () => {
    expect((await report(consumer, { status: 'deploying' })).body.status).toBe('deploying')
    expect((await report(consumer, { status: 'building' })).status).toBe(409)
    expect((await report(consumer, { status: 'deploying' })).status).toBe(409)
    const failed = await report(consumer, { status: 'failed', errorCode: 'build_error', errorMessage: 'tsc failed' })
    expect(failed.status).toBe(200)
    expect(failed.body).toMatchObject({ status: 'failed', errorCode: 'build_error', errorMessage: 'tsc failed' })
    expect((await report(consumer, { status: 'deploying' })).status).toBe(409)
    expect((await report(consumer, { status: 'failed' })).status).toBe(409)
  })

  it('a cancelled session ignores a late callback (409)', async () => {
    await request(app).post(`${B}/build-sessions/${sid}/cancel`).set(as(bob))
    expect((await report(consumer, { status: 'deploying' })).status).toBe(409)
  })

  it('body validation: appSlug required for deployed and invalid elsewhere; strict', async () => {
    expect((await report(consumer, { status: 'deployed' })).status).toBe(400)
    expect((await report(consumer, { status: 'building', appSlug: 'x' })).status).toBe(400)
    expect((await report(consumer, { status: 'deploying', errorCode: 'x' })).status).toBe(400)
    expect((await report(consumer, { status: 'launching' })).status).toBe(400)
    expect((await report(consumer, { status: 'deploying', id: 'x' })).status).toBe(400)
  })

  it('deployed: unknown slug -> 422 and state unchanged', async () => {
    const res = await report(consumer, { status: 'deployed', appSlug: 'ghost' })
    expect(res.status).toBe(422)
    expect(sessions.get(uuid)!.status).toBe('building')
  })

  it('deployed: an app in a DIFFERENT tenant -> 409 ORG_MISMATCH, no link, no creator', async () => {
    seedApp('alien', { organization_id: OTHER_ORG })
    const res = await report(consumer, { status: 'deployed', appSlug: 'alien' })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('ORG_MISMATCH')
    expect(sessions.get(uuid)!.status).toBe('building')
    expect(sessions.get(uuid)!.app_id).toBeNull()
    expect(appRows.find(a => a.slug === 'alien')!.created_by_user_id).toBeNull()
    expect(assigned).toHaveLength(0)
  })

  it('deployed: links the app and (creator-ownership ON) sets created_by + assigns the creator role', async () => {
    const a = seedApp('invoicer')
    const res = await report(consumer, { status: 'deployed', appSlug: 'invoicer' })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'deployed', appSlug: 'invoicer', appId: fromUuid('app', a.id) })
    expect(a.created_by_user_id).toBe(U_BOB)
    expect(assigned).toEqual([{ user: U_BOB, role: 'creator', resource_instance: 'App:invoicer', tenant: ORG }])
  })

  it('deployed: never overwrites an existing creator (immutable) and skips the role', async () => {
    const a = seedApp('invoicer', { created_by_user_id: U_ALICE })
    expect((await report(consumer, { status: 'deployed', appSlug: 'invoicer' })).status).toBe(200)
    expect(a.created_by_user_id).toBe(U_ALICE)
    expect(assigned).toHaveLength(0)
  })

  it('deployed: creator-ownership OFF -> linked, but no created_by and no role', async () => {
    creatorFlag = false
    const a = seedApp('invoicer')
    expect((await report(consumer, { status: 'deployed', appSlug: 'invoicer' })).status).toBe(200)
    expect(a.created_by_user_id).toBeNull()
    expect(assigned).toHaveLength(0)
  })

  it('deployed: a Permit failure is fail-soft (still 200)', async () => {
    setPermitClient({ check: async () => true, api: { users: { assignRole: async () => { throw new Error('permit down') } } } })
    seedApp('invoicer')
    expect((await report(consumer, { status: 'deployed', appSlug: 'invoicer' })).status).toBe(200)
  })

  it('flag OFF -> 503', async () => {
    buildFlag = false
    const res = await report(consumer, { status: 'deploying' })
    expect(res.status).toBe(503)
    expect(res.body.error).toBe('feature_disabled')
  })
})

describe('cursor codec', () => {
  it('round-trips and rejects garbage', () => {
    const c = encodeSessionCursor({ created_at: new Date('2026-01-01T00:00:00.000Z'), id: 'abc' })
    expect(decodeSessionCursor(c)).toEqual({ createdAt: '2026-01-01T00:00:00.000Z', id: 'abc' })
    expect(decodeSessionCursor('!!!')).toBeNull()
  })
})

describe('marketplace publication', () => {
  const P = (slug: string) => `${B}/apps/${slug}/publication-requests`

  it('submit: manager with apps:write -> 201 pending; stores notes/requestedBy in marketplace_metadata.publication', async () => {
    const a = seedApp('inv')
    const res = await request(app).post(P('inv')).set(as(alice)).send({ target: 'marketplace', notes: 'please' })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ slug: 'inv', status: 'pending', target: 'marketplace', notes: 'please' })
    expect(a.marketplace_submitted_at).toBeInstanceOf(Date)
    expect(a.is_marketplace_approved).toBe(false)
    expect(JSON.parse(a.marketplace_metadata).publication).toMatchObject({ notes: 'please', requestedBy: U_ALICE })
    expect(permitChecks.some(c => c.action === 'apps:write')).toBe(true)
  })

  it('submit: 409 when pending, 409 when approved', async () => {
    seedApp('inv')
    await request(app).post(P('inv')).set(as(alice)).send({ target: 'marketplace' })
    const again = await request(app).post(P('inv')).set(as(alice)).send({ target: 'marketplace' })
    expect(again.status).toBe(409); expect(again.body.code).toBe('ALREADY_PENDING')
    seedApp('pub', { is_marketplace_approved: true, marketplace_approved_at: new Date() })
    const pub = await request(app).post(P('pub')).set(as(alice)).send({ target: 'marketplace' })
    expect(pub.status).toBe(409); expect(pub.body.code).toBe('ALREADY_PUBLISHED')
  })

  it('submit: strict body; non-marketplace target rejected; no Permit -> 403; outsider -> 404', async () => {
    seedApp('inv')
    expect((await request(app).post(P('inv')).set(as(alice)).send({ target: 'org' })).status).toBe(400)
    expect((await request(app).post(P('inv')).set(as(alice)).send({ target: 'marketplace', approved: true })).status).toBe(400)
    permitGrant = false
    expect((await request(app).post(P('inv')).set(as(alice)).send({ target: 'marketplace' })).status).toBe(403)
    permitGrant = true
    expect((await request(app).post(P('inv')).set(as(eve)).send({ target: 'marketplace' })).status).toBe(404)
    expect((await request(app).post(P('nope')).set(as(alice)).send({ target: 'marketplace' })).status).toBe(404)
  })

  it('approve: platform admin only; sets visibility=marketplace (column + manifest), approved flags, approved_by', async () => {
    const a = seedApp('inv')
    await request(app).post(P('inv')).set(as(alice)).send({ target: 'marketplace' })
    expect((await request(app).post(`${P('inv')}/approve`).set(as(alice)).send({})).status).toBe(403)
    const res = await request(app).post(`${P('inv')}/approve`).set(as(admin)).send({})
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'approved', tier: 'marketplace', approvedBy: fromUuid('user', admin.id) })
    expect(a.visibility).toBe('marketplace')
    expect(JSON.parse(a.manifest).visibility).toBe('marketplace')
    expect(a.is_marketplace_approved).toBe(true)
    expect(a.marketplace_approved_at).toBeInstanceOf(Date)
    expect(a.approved_by).toBe(admin.id)
    // now readable by anyone (marketplace tier) — and a repeat approve is a 409
    expect((await request(app).post(`${P('inv')}/approve`).set(as(admin)).send({})).status).toBe(409)
  })

  it('approve by the service account records no approver (not a users row)', async () => {
    const a = seedApp('inv')
    await request(app).post(P('inv')).set(as(alice)).send({ target: 'marketplace' })
    expect((await request(app).post(`${P('inv')}/approve`).set(as(consumer)).send({})).status).toBe(200)
    expect(a.approved_by).toBeNull()
  })

  it('reject: requires a reason, clears the submission, records rejection; can be resubmitted', async () => {
    const a = seedApp('inv')
    await request(app).post(P('inv')).set(as(alice)).send({ target: 'marketplace' })
    expect((await request(app).post(`${P('inv')}/reject`).set(as(admin)).send({})).status).toBe(400)
    expect((await request(app).post(`${P('inv')}/reject`).set(as(alice)).send({ reason: 'no' })).status).toBe(403)
    const res = await request(app).post(`${P('inv')}/reject`).set(as(admin)).send({ reason: 'missing privacy policy' })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'rejected', rejection: { reason: 'missing privacy policy' } })
    expect(a.marketplace_submitted_at).toBeNull()
    expect(a.is_marketplace_approved).toBe(false)
    expect(a.visibility).toBeUndefined()
    // nothing pending now -> reject/approve 409
    expect((await request(app).post(`${P('inv')}/reject`).set(as(admin)).send({ reason: 'again' })).status).toBe(409)
    expect((await request(app).post(`${P('inv')}/approve`).set(as(admin)).send({})).status).toBe(409)
    expect((await request(app).post(P('inv')).set(as(alice)).send({ target: 'marketplace' })).status).toBe(201)
  })

  it('GET publication: managers + admins see state; mere readers get 404; none -> status none', async () => {
    seedApp('inv', { manifest: manifestFor('inv', 'public') })
    const none = await request(app).get(`${B}/apps/inv/publication`).set(as(alice))
    expect(none.status).toBe(200); expect(none.body.status).toBe('none')
    expect((await request(app).get(`${B}/apps/inv/publication`).set(as(eve))).status).toBe(404)
    expect((await request(app).get(`${B}/apps/inv/publication`).set(as(admin))).status).toBe(200)
  })

  it('flag OFF -> 503 feature_disabled on every publication endpoint', async () => {
    publishFlag = false
    seedApp('inv')
    for (const r of [
      request(app).post(P('inv')).send({ target: 'marketplace' }),
      request(app).post(`${P('inv')}/approve`).send({}),
      request(app).post(`${P('inv')}/reject`).send({ reason: 'x' }),
      request(app).get(`${B}/apps/inv/publication`),
    ]) {
      const res = await r.set(as(admin))
      expect(res.status).toBe(503)
      expect(res.body.error).toBe('feature_disabled')
    }
  })
})
