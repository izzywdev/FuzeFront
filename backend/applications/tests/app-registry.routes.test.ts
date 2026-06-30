// Route-level integration tests for the app-registry surface, exercising the
// FULL stack (router + service + lifecycle + BOLA) over an in-memory fake knex.
// Permit and the Kafka emitter are stubbed via their DI seams so BOTH authz
// states (granted / denied) and the off-path (no Kafka) are tested with no
// broker or PDP. Covers: register→activate→suspend lifecycle, idempotent
// activate, builtin delete→403, duplicate slug→409, manifest 400, BOLA
// cross-org get/list, and pagination (limit + nextCursor).
import express from 'express'
import request from 'supertest'

// ── In-memory fake knex supporting exactly the chains the service uses. ────────
interface Row {
  [k: string]: any
}
const store: { rows: Row[] } = { rows: [] }

function makeQuery(table: string) {
  if (table !== 'apps' && table !== 'organization_memberships') {
    throw new Error(`fake-knex: unexpected table ${table}`)
  }
  let dataset = table === 'apps' ? store.rows : (store as any).memberships || []
  const predicates: ((r: Row) => boolean)[] = []
  let orderKeys: { col: string; dir: 'asc' | 'desc' }[] = []
  let limitN: number | undefined
  let selectCols: string[] | undefined

  const q: any = {
    where(arg: any, val?: any) {
      if (typeof arg === 'function') {
        // sub-builder: build a child predicate set with OR/AND semantics.
        const sub = makeSubBuilder()
        arg.call(sub, sub)
        predicates.push(sub.evaluate)
      } else if (typeof arg === 'object') {
        predicates.push(r => Object.entries(arg).every(([k, v]) => r[k] === v))
      } else if (val !== undefined) {
        predicates.push(r => r[arg] === val)
      }
      return q
    },
    whereNot(col: string, val: any) {
      predicates.push(r => r[col] !== val)
      return q
    },
    whereNull(col: string) {
      predicates.push(r => r[col] === null || r[col] === undefined)
      return q
    },
    whereNotNull(col: string) {
      predicates.push(r => r[col] !== null && r[col] !== undefined)
      return q
    },
    whereIn(col: string, vals: any[]) {
      predicates.push(r => vals.includes(r[col]))
      return q
    },
    orderBy(col: string, dir: 'asc' | 'desc' = 'asc') {
      orderKeys.push({ col, dir })
      return q
    },
    limit(n: number) {
      limitN = n
      return q
    },
    select(...cols: string[]) {
      selectCols = cols
      return q
    },
    _run() {
      let res = dataset.filter(r => predicates.every(p => p(r)))
      for (const { col, dir } of [...orderKeys].reverse()) {
        res = res.sort((a, b) => {
          const av = norm(a[col])
          const bv = norm(b[col])
          const cmp = av < bv ? -1 : av > bv ? 1 : 0
          return dir === 'asc' ? cmp : -cmp
        })
      }
      if (limitN !== undefined) res = res.slice(0, limitN)
      if (selectCols) res = res.map(r => Object.fromEntries(selectCols!.map(c => [c, r[c]])))
      return res
    },
    first() {
      return Promise.resolve(q._run()[0])
    },
    then(resolve: any, reject: any) {
      return Promise.resolve(q._run()).then(resolve, reject)
    },
    async insert(payload: Row | Row[]) {
      const rows = Array.isArray(payload) ? payload : [payload]
      const builder: any = {
        onConflict() {
          return { ignore: async () => doInsert(false) }
        },
        then(resolve: any, reject: any) {
          return doInsert(true).then(resolve, reject)
        },
      }
      async function doInsert(throwOnDup: boolean) {
        for (const row of rows) {
          if (table === 'apps' && row.slug) {
            const dup = store.rows.find(r => r.slug === row.slug)
            if (dup) {
              if (throwOnDup) {
                const e: any = new Error('duplicate key value violates unique constraint')
                e.code = '23505'
                throw e
              }
              continue // onConflict ignore
            }
          }
          if (table === 'apps') store.rows.push({ ...row })
        }
        return undefined
      }
      return builder
    },
    async update(patch: Row) {
      const res = q._run()
      for (const r of res) {
        const target = store.rows.find(x => x === r) || store.rows.find(x => x.slug === r.slug)
        if (target) Object.assign(target, patch)
      }
      return res.length
    },
    async del() {
      const res = q._run()
      store.rows = store.rows.filter(r => !res.includes(r))
      return res.length
    },
  }
  return q
}

// Models a knex-style nested builder as an ordered list of clauses, each tagged
// AND/OR, evaluated left-to-right exactly like SQL (the first clause is a bare
// term; andWhere/whereIn AND; orWhere/orWhereNull OR).
function makeSubBuilder() {
  const clauses: { kind: 'and' | 'or'; pred: (r: Row) => boolean }[] = []
  function pred(arg: any, op?: any, val?: any): (r: Row) => boolean {
    if (typeof arg === 'function') {
      const child = makeSubBuilder()
      arg.call(child, child)
      return child.evaluate
    }
    if (val !== undefined) return (r: Row) => compare(r[arg], op, val)
    return (r: Row) => r[arg] === op
  }
  const firstIsOr = () => clauses.length === 0
  const sub: any = {
    where(arg: any, op?: any, val?: any) {
      clauses.push({ kind: 'and', pred: pred(arg, op, val) })
      return sub
    },
    andWhere(arg: any, op?: any, val?: any) {
      clauses.push({ kind: 'and', pred: pred(arg, op, val) })
      return sub
    },
    orWhere(arg: any, op?: any, val?: any) {
      clauses.push({ kind: firstIsOr() ? 'and' : 'or', pred: pred(arg, op, val) })
      return sub
    },
    whereIn(col: string, vals: any[]) {
      clauses.push({ kind: 'and', pred: (r: Row) => vals.includes(r[col]) })
      return sub
    },
    orWhereNull(col: string) {
      clauses.push({
        kind: firstIsOr() ? 'and' : 'or',
        pred: (r: Row) => r[col] === null || r[col] === undefined,
      })
      return sub
    },
    evaluate(r: Row): boolean {
      if (clauses.length === 0) return true
      let acc = clauses[0].pred(r)
      for (let i = 1; i < clauses.length; i++) {
        const c = clauses[i]
        acc = c.kind === 'and' ? acc && c.pred(r) : acc || c.pred(r)
      }
      return acc
    },
  }
  return sub
}

function norm(v: any): any {
  return v instanceof Date ? v.toISOString() : v
}

function compare(a0: any, op: string, b0: any): boolean {
  const a = norm(a0)
  const b = norm(b0)
  switch (op) {
    case '>': return a > b
    case '<': return a < b
    case '=': return a === b
    case '>=': return a >= b
    case '<=': return a <= b
    default: return a === b
  }
}

const fakeDb: any = (table: string) => makeQuery(table)
fakeDb.fn = { now: () => new Date() }

jest.mock('../src/config/database', () => ({ db: (t: string) => fakeDb(t) }))

// Auth middleware: inject the test user.
jest.mock('../src/middleware/auth', () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    req.user = req.headers['x-test-user'] ? JSON.parse(req.headers['x-test-user']) : null
    if (!req.user) return _res.status(401).json({ error: 'unauthorized' })
    next()
  },
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}))

import { setPermitClient } from '../src/app-registry/permit'
import { setAppRegistryEmitter } from '../src/app-registry/events'
import { setFlagClient, FLAGS } from '../src/app-registry/flags'
import appRegistryRouter from '../src/routes/app-registry'

// Emitter spy (off-path: no real Kafka).
const emitted: { type: string; payload: any }[] = []
const stubEmitter = {
  appRegistered: async (p: any) => { emitted.push({ type: 'registered', payload: p }) },
  appActivated: async (p: any) => { emitted.push({ type: 'activated', payload: p }) },
  appSuspended: async (p: any) => { emitted.push({ type: 'suspended', payload: p }) },
  appHeartbeat: async (p: any) => { emitted.push({ type: 'heartbeat', payload: p }) },
}

// Permit toggle so we can test BOTH authz states.
let permitGrant = true
setPermitClient({ check: async () => permitGrant })
setAppRegistryEmitter(stubEmitter)

// Feature-flag in-memory client so BOTH flag states are exercised. Defaults
// match the rules: release write flag pinned ON for the happy path (an explicit
// OFF-path test flips it), kafka kill-switch ON.
let writeFlag = true
let kafkaFlag = true
setFlagClient({
  getBooleanValue: async (key: string, def: boolean) => {
    if (key === FLAGS.V1_REGISTRY_WRITE) return writeFlag
    if (key === FLAGS.KAFKA_EVENTS_KILL_SWITCH) return kafkaFlag
    return def
  },
})

function buildApp() {
  const app = express()
  app.use(express.json())
  app.set('io', { emit: () => undefined })
  app.use('/api/v1/app-registry', appRegistryRouter)
  return app
}

const orgA = '11111111-1111-1111-1111-111111111111'
const orgB = '22222222-2222-2222-2222-222222222222'
const userA = { id: 'user-a', roles: ['user'] }
const userB = { id: 'user-b', roles: ['user'] }
const admin = { id: 'admin', roles: ['admin'] }

function asUser(u: any) {
  return { 'x-test-user': JSON.stringify(u) }
}

function manifest(slug: string, extra: any = {}) {
  return {
    manifestVersion: '1',
    slug,
    name: slug,
    menuLabel: slug,
    mode: 'portal',
    integration: {
      type: 'module-federation',
      remoteEntry: `https://${slug}.example.com/remoteEntry.js`,
      scope: `${slug}App`,
      module: `./${slug}`,
    },
    visibility: 'organization',
    ...extra,
  }
}

const app = buildApp()

beforeEach(() => {
  store.rows = []
  ;(store as any).memberships = [
    { user_id: 'user-a', organization_id: orgA, status: 'active', role: 'admin' },
    { user_id: 'user-b', organization_id: orgB, status: 'active', role: 'admin' },
  ]
  emitted.length = 0
  permitGrant = true
  writeFlag = true
  kafkaFlag = true
})

describe('registerApp', () => {
  it('registers an app (201) in status registered and emits app.registered', async () => {
    const res = await request(app)
      .post('/api/v1/app-registry/apps')
      .set(asUser(userA))
      .send({ manifest: manifest('market'), organizationId: orgA })
    expect(res.status).toBe(201)
    expect(res.body.slug).toBe('market')
    expect(res.body.status).toBe('registered')
    expect(res.headers['x-app-heartbeat-token']).toBeTruthy()
    expect(emitted.find(e => e.type === 'registered')).toBeTruthy()
  })

  it('rejects an invalid manifest with 400 validation_error', async () => {
    const res = await request(app)
      .post('/api/v1/app-registry/apps')
      .set(asUser(userA))
      .send({ manifest: { manifestVersion: '1', slug: 'x' }, organizationId: orgA })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('validation_error')
    expect(Array.isArray(res.body.fields)).toBe(true)
  })

  it('returns 409 on duplicate slug', async () => {
    await request(app).post('/api/v1/app-registry/apps').set(asUser(userA))
      .send({ manifest: manifest('market'), organizationId: orgA })
    const res = await request(app).post('/api/v1/app-registry/apps').set(asUser(userA))
      .send({ manifest: manifest('market'), organizationId: orgA })
    expect(res.status).toBe(409)
    expect(res.body.error).toBe('conflict')
  })

  it('forbids registering into an org the caller does not belong to (BOLA)', async () => {
    const res = await request(app).post('/api/v1/app-registry/apps').set(asUser(userA))
      .send({ manifest: manifest('market'), organizationId: orgB })
    expect(res.status).toBe(403)
  })

  it('denies register when Permit denies (authz off-path)', async () => {
    permitGrant = false
    const res = await request(app).post('/api/v1/app-registry/apps').set(asUser(userA))
      .send({ manifest: manifest('market'), organizationId: orgA })
    expect(res.status).toBe(403)
  })
})

describe('feature flags — both states', () => {
  it('release flag OFF → write surface dark (503), GET still works', async () => {
    writeFlag = false
    const reg = await request(app).post('/api/v1/app-registry/apps').set(asUser(userA))
      .send({ manifest: manifest('market'), organizationId: orgA })
    expect(reg.status).toBe(503)
    expect(reg.body.error).toBe('feature_disabled')

    // Reads are NOT gated even with the write flag off.
    store.rows.push(mkRow('pub', orgA, 'public'))
    const get = await request(app).get('/api/v1/app-registry/apps').set(asUser(userA))
    expect(get.status).toBe(200)
  })

  it('release flag ON → register succeeds (on-path)', async () => {
    writeFlag = true
    const reg = await request(app).post('/api/v1/app-registry/apps').set(asUser(userA))
      .send({ manifest: manifest('market'), organizationId: orgA })
    expect(reg.status).toBe(201)
  })

  it('kafka kill-switch OFF → action succeeds but no event emitted', async () => {
    kafkaFlag = false
    const reg = await request(app).post('/api/v1/app-registry/apps').set(asUser(userA))
      .send({ manifest: manifest('market'), organizationId: orgA })
    expect(reg.status).toBe(201)
    expect(emitted.find(e => e.type === 'registered')).toBeFalsy()
  })

  it('kafka kill-switch ON → event emitted (on-path)', async () => {
    kafkaFlag = true
    const reg = await request(app).post('/api/v1/app-registry/apps').set(asUser(userA))
      .send({ manifest: manifest('market'), organizationId: orgA })
    expect(reg.status).toBe(201)
    expect(emitted.find(e => e.type === 'registered')).toBeTruthy()
  })
})

describe('lifecycle register → activate → suspend', () => {
  async function seedApp(slug: string, org: string, who: any) {
    await request(app).post('/api/v1/app-registry/apps').set(asUser(who))
      .send({ manifest: manifest(slug), organizationId: org })
  }

  it('activates then suspends, with idempotent no-ops', async () => {
    await seedApp('market', orgA, userA)

    const act = await request(app).post('/api/v1/app-registry/apps/market/activate').set(asUser(userA))
    expect(act.status).toBe(200)
    expect(act.body.status).toBe('activated')
    expect(emitted.find(e => e.type === 'activated')).toBeTruthy()

    // idempotent activate → still 200, no second event.
    emitted.length = 0
    const act2 = await request(app).post('/api/v1/app-registry/apps/market/activate').set(asUser(userA))
    expect(act2.status).toBe(200)
    expect(act2.body.status).toBe('activated')
    expect(emitted.find(e => e.type === 'activated')).toBeFalsy()

    const susp = await request(app).post('/api/v1/app-registry/apps/market/suspend').set(asUser(userA))
    expect(susp.status).toBe(200)
    expect(susp.body.status).toBe('suspended')
    expect(emitted.find(e => e.type === 'suspended')).toBeTruthy()
  })

  it('forbids activation by a cross-org caller (BOLA mutate)', async () => {
    await seedApp('market', orgA, userA)
    const res = await request(app).post('/api/v1/app-registry/apps/market/activate').set(asUser(userB))
    // private/organization app in orgA is not visible to userB → 404 (hidden).
    expect([403, 404]).toContain(res.status)
  })
})

describe('deleteApp', () => {
  it('deletes a non-builtin app (204)', async () => {
    await request(app).post('/api/v1/app-registry/apps').set(asUser(userA))
      .send({ manifest: manifest('market'), organizationId: orgA })
    const res = await request(app).delete('/api/v1/app-registry/apps/market').set(asUser(userA))
    expect(res.status).toBe(204)
  })

  it('returns 403 when deleting a builtin app', async () => {
    // Seed a builtin directly into the store.
    store.rows.push({
      slug: 'clock', name: 'Clock', status: 'activated', mode: 'portal', builtin: true,
      organization_id: null, visibility: 'public',
      manifest: JSON.stringify({ ...manifest('clock'), builtin: true, visibility: 'public' }),
      created_at: new Date(), updated_at: new Date(),
    })
    const res = await request(app).delete('/api/v1/app-registry/apps/clock').set(asUser(admin))
    expect(res.status).toBe(403)
  })
})

describe('getApp BOLA', () => {
  it('hides a cross-org private app as 404', async () => {
    await request(app).post('/api/v1/app-registry/apps').set(asUser(userA))
      .send({ manifest: manifest('market', { visibility: 'private' }), organizationId: orgA })
    const mine = await request(app).get('/api/v1/app-registry/apps/market').set(asUser(userA))
    expect(mine.status).toBe(200)
    const theirs = await request(app).get('/api/v1/app-registry/apps/market').set(asUser(userB))
    expect(theirs.status).toBe(404)
  })

  it('a public app is visible cross-org', async () => {
    store.rows.push({
      slug: 'pub', name: 'Pub', status: 'activated', mode: 'portal', builtin: false,
      organization_id: orgA, visibility: 'public',
      manifest: JSON.stringify({ ...manifest('pub'), visibility: 'public' }),
      created_at: new Date(), updated_at: new Date(),
    })
    const res = await request(app).get('/api/v1/app-registry/apps/pub').set(asUser(userB))
    expect(res.status).toBe(200)
  })
})

describe('listApps BOLA + pagination', () => {
  it('only lists apps visible to the caller', async () => {
    store.rows.push(
      mkRow('a1', orgA, 'organization'),
      mkRow('b1', orgB, 'organization'),
      mkRow('p1', orgB, 'public'),
    )
    const res = await request(app).get('/api/v1/app-registry/apps').set(asUser(userA))
    expect(res.status).toBe(200)
    const slugs = res.body.apps.map((a: any) => a.slug).sort()
    expect(slugs).toEqual(['a1', 'p1']) // b1 (orgB private/org) hidden
  })

  it('paginates with limit and nextCursor', async () => {
    for (let i = 0; i < 5; i++) store.rows.push(mkRow(`app${i}`, orgA, 'organization', i))
    const page1 = await request(app).get('/api/v1/app-registry/apps?limit=2').set(asUser(userA))
    expect(page1.body.apps.length).toBe(2)
    expect(page1.body.nextCursor).toBeTruthy()

    const page2 = await request(app)
      .get(`/api/v1/app-registry/apps?limit=2&cursor=${encodeURIComponent(page1.body.nextCursor)}`)
      .set(asUser(userA))
    expect(page2.body.apps.length).toBe(2)
    const seen = [...page1.body.apps, ...page2.body.apps].map((a: any) => a.slug)
    expect(new Set(seen).size).toBe(4) // no overlap across pages
  })
})

function mkRow(slug: string, org: string, visibility: string, i = 0) {
  const created = new Date(Date.now() + i * 1000)
  return {
    slug, name: slug, status: 'activated', mode: 'portal', builtin: false,
    organization_id: org, visibility,
    manifest: JSON.stringify({ ...manifest(slug), visibility }),
    created_at: created, updated_at: created,
  }
}
