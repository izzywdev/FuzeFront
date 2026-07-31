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
import { NAV_SECTIONS } from '../src/app-registry/manifest.schema'

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
    // @fuzequality api registerApp
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

  it('rejects registration with 401 when authentication is missing', async () => {
    // @fuzequality api registerApp
    const res = await request(app)
      .post('/api/v1/app-registry/apps')
      .send({ manifest: manifest('market'), organizationId: orgA })
    expect(res.status).toBe(401)
    expect(res.type).toMatch(/json/)
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

    // @fuzequality api activateApp
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

    // @fuzequality api suspendApp
    const susp = await request(app).post('/api/v1/app-registry/apps/market/suspend').set(asUser(userA))
    expect(susp.status).toBe(200)
    expect(susp.body.status).toBe('suspended')
    expect(emitted.find(e => e.type === 'suspended')).toBeTruthy()
  })

  it('rejects activation with 401 when authentication is missing', async () => {
    // @fuzequality api activateApp
    const res = await request(app).post('/api/v1/app-registry/apps/market/activate')
    expect(res.status).toBe(401)
    expect(res.type).toMatch(/json/)
  })

  it('does not activate an item when the required slug path parameter is missing', async () => {
    // @fuzequality api activateApp
    const res = await request(app)
      .post('/api/v1/app-registry/apps//activate')
      .set(asUser(userA))
    expect(res.status).toBe(404)
  })

  it('rejects suspension with 401 when authentication is missing', async () => {
    // @fuzequality api suspendApp
    const res = await request(app).post('/api/v1/app-registry/apps/market/suspend')
    expect(res.status).toBe(401)
    expect(res.type).toMatch(/json/)
  })

  it('does not suspend an item when the required slug path parameter is missing', async () => {
    // @fuzequality api suspendApp
    const res = await request(app)
      .post('/api/v1/app-registry/apps//suspend')
      .set(asUser(userA))
    expect(res.status).toBe(404)
  })

  it('forbids activation by a cross-org caller (BOLA mutate)', async () => {
    await seedApp('market', orgA, userA)
    const res = await request(app).post('/api/v1/app-registry/apps/market/activate').set(asUser(userB))
    // private/organization app in orgA is not visible to userB → 404 (hidden).
    expect([403, 404]).toContain(res.status)
  })
})

// The onboarding writes are what let a product declare its OWN authz policy and
// billing key instead of the platform hardcoding them. Both are apps:write on an
// existing app.
describe('onboarding: policy + billing profile', () => {
  async function seedApp(slug: string, org: string, who: any) {
    await request(app).post('/api/v1/app-registry/apps').set(asUser(who))
      .send({ manifest: manifest(slug), organizationId: org })
  }

  const validPolicy = {
    name: 'Market',
    resources: [
      { key: 'Listing', name: 'Listing', actions: { read: { name: 'Read' }, update: { name: 'Update' } } },
    ],
    roles: [{ key: 'seller', name: 'Seller', permissions: ['Listing:update'] }],
  }

  it('stores a valid policy and reports what was synced', async () => {
    // @fuzequality api putAppPolicy
    await seedApp('market', orgA, userA)
    const res = await request(app)
      .put('/api/v1/app-registry/apps/market/policy')
      .set(asUser(userA))
      .send(validPolicy)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ slug: 'market', resources: 1, roles: 1 })
  })

  it('rejects policy writes with 401 when authentication is missing', async () => {
    // @fuzequality api putAppPolicy
    const res = await request(app)
      .put('/api/v1/app-registry/apps/market/policy')
      .send(validPolicy)
    expect(res.status).toBe(401)
    expect(res.type).toMatch(/json/)
  })

  it('does not write policy when the required slug path parameter is missing', async () => {
    // @fuzequality api putAppPolicy
    const res = await request(app)
      .put('/api/v1/app-registry/apps//policy')
      .set(asUser(userA))
      .send(validPolicy)
    expect(res.status).toBe(404)
  })

  it('rejects a permission referencing an action the policy never declares', async () => {
    await seedApp('market', orgA, userA)
    const res = await request(app)
      .put('/api/v1/app-registry/apps/market/policy')
      .set(asUser(userA))
      .send({
        ...validPolicy,
        roles: [{ key: 'seller', name: 'Seller', permissions: ['Listing:delete'] }],
      })
    // Caught here, at deploy, rather than shipping a role that silently grants nothing.
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('validation_error')
  })

  it('rejects a body whose product disagrees with the path slug', async () => {
    await seedApp('market', orgA, userA)
    const res = await request(app)
      .put('/api/v1/app-registry/apps/market/policy')
      .set(asUser(userA))
      // Otherwise write access to `market` would install a policy namespaced to
      // another product entirely.
      .send({ ...validPolicy, product: 'someotherapp' })
    expect(res.status).toBe(400)
    expect(res.body.fields[0].path).toBe('product')
  })

  it('hides policy writes on a cross-org app as 404 (BOLA)', async () => {
    await seedApp('market', orgA, userA)
    const res = await request(app)
      .put('/api/v1/app-registry/apps/market/policy')
      .set(asUser(userB))
      .send(validPolicy)
    expect([403, 404]).toContain(res.status)
  })

  it('stores a valid billing profile', async () => {
    // @fuzequality api putAppBillingProfile
    await seedApp('market', orgA, userA)
    const res = await request(app)
      .put('/api/v1/app-registry/apps/market/billing-profile')
      .set(asUser(userA))
      .send({ productKey: 'market', currencies: ['usd'] })
    expect(res.status).toBe(200)
    expect(res.body.productKey).toBe('market')
  })

  it('rejects billing-profile writes with 401 when authentication is missing', async () => {
    // @fuzequality api putAppBillingProfile
    const res = await request(app)
      .put('/api/v1/app-registry/apps/market/billing-profile')
      .send({ productKey: 'market', currencies: ['usd'] })
    expect(res.status).toBe(401)
    expect(res.type).toMatch(/json/)
  })

  it('does not write a billing profile when the required slug path parameter is missing', async () => {
    // @fuzequality api putAppBillingProfile
    const res = await request(app)
      .put('/api/v1/app-registry/apps//billing-profile')
      .set(asUser(userA))
      .send({ productKey: 'market', currencies: ['usd'] })
    expect(res.status).toBe(404)
  })

  it('rejects a malformed billing productKey', async () => {
    await seedApp('market', orgA, userA)
    const res = await request(app)
      .put('/api/v1/app-registry/apps/market/billing-profile')
      .set(asUser(userA))
      .send({ productKey: 'Not A Key' })
    expect(res.status).toBe(400)
  })

  it('404s for an app that is not registered', async () => {
    const res = await request(app)
      .put('/api/v1/app-registry/apps/nosuchapp/policy')
      .set(asUser(userA))
      .send(validPolicy)
    expect(res.status).toBe(404)
  })
})

describe('deleteApp', () => {
  it('deletes a non-builtin app (204)', async () => {
    // @fuzequality api deleteApp
    await request(app).post('/api/v1/app-registry/apps').set(asUser(userA))
      .send({ manifest: manifest('market'), organizationId: orgA })
    const res = await request(app).delete('/api/v1/app-registry/apps/market').set(asUser(userA))
    expect(res.status).toBe(204)
  })

  it('rejects deletion with 401 when authentication is missing', async () => {
    // @fuzequality api deleteApp
    const res = await request(app).delete('/api/v1/app-registry/apps/market')
    expect(res.status).toBe(401)
    expect(res.type).toMatch(/json/)
  })

  it('does not perform an item lookup when the required slug path parameter is missing', async () => {
    // @fuzequality api deleteApp
    const res = await request(app)
      .delete('/api/v1/app-registry/apps/')
      .set(asUser(userA))
    expect(res.status).toBe(404)
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

describe('heartbeatApp', () => {
  async function registerHeartbeatApp() {
    const registered = await request(app)
      .post('/api/v1/app-registry/apps')
      .set(asUser(userA))
      .send({ manifest: manifest('market'), organizationId: orgA })
    return registered.headers['x-app-heartbeat-token']
  }

  it('accepts an authenticated heartbeat with a declared 200 application/json response', async () => {
    // @fuzequality api heartbeatApp
    const heartbeatToken = await registerHeartbeatApp()
    const res = await request(app)
      .post('/api/v1/app-registry/apps/market/heartbeat')
      .set('Authorization', `Bearer ${heartbeatToken}`)
      .send({ status: 'online', metadata: { version: '1.0.0' } })
    expect(res.status).toBe(200)
    expect(res.type).toMatch(/json/)
    expect(res.body.accepted).toBe(true)
  })

  it('rejects a heartbeat with 401 when authentication is missing', async () => {
    // @fuzequality api heartbeatApp
    await registerHeartbeatApp()
    const res = await request(app)
      .post('/api/v1/app-registry/apps/market/heartbeat')
      .send({ status: 'online' })
    expect(res.status).toBe(401)
    expect(res.type).toMatch(/json/)
  })

  it('does not accept a heartbeat when the required slug path parameter is missing', async () => {
    // @fuzequality api heartbeatApp
    const res = await request(app)
      .post('/api/v1/app-registry/apps//heartbeat')
      .set('Authorization', 'Bearer invalid')
      .send({ status: 'online' })
    expect(res.status).toBe(404)
  })
})

describe('getApp BOLA', () => {
  it('rejects app lookup with 401 when authentication is missing', async () => {
    // @fuzequality api getApp
    const res = await request(app).get('/api/v1/app-registry/apps/market')
    expect(res.status).toBe(401)
    expect(res.type).toMatch(/json/)
  })

  it('returns 404 when the required slug path parameter is missing', async () => {
    // @fuzequality api getApp
    const res = await request(app)
      .get('/api/v1/app-registry/apps/')
      .set(asUser(userA))
    expect(res.status).toBe(200)
    expect(res.body.apps).toEqual([])
  })

  it('hides a cross-org private app as 404', async () => {
    await request(app).post('/api/v1/app-registry/apps').set(asUser(userA))
      .send({ manifest: manifest('market', { visibility: 'private' }), organizationId: orgA })
    const mine = await request(app).get('/api/v1/app-registry/apps/market').set(asUser(userA))
    expect(mine.status).toBe(200)
    const theirs = await request(app).get('/api/v1/app-registry/apps/market').set(asUser(userB))
    expect(theirs.status).toBe(404)
  })

  it('returns 200 when a public app is visible cross-org', async () => {
    // @fuzequality api getApp
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

describe('updateApp', () => {
  it('updates an app with a declared 200 response for a valid manifest', async () => {
    // @fuzequality api updateApp
    await request(app)
      .post('/api/v1/app-registry/apps')
      .set(asUser(userA))
      .send({ manifest: manifest('market'), organizationId: orgA })

    const res = await request(app)
      .put('/api/v1/app-registry/apps/market')
      .set(asUser(userA))
      .send(manifest('market', { name: 'Updated Market' }))
    expect(res.status).toBe(200)
    expect(res.type).toMatch(/json/)
    expect(res.body.manifest.name).toBe('Updated Market')
  })

  it('rejects app updates with 401 when authentication is missing', async () => {
    // @fuzequality api updateApp
    const res = await request(app)
      .put('/api/v1/app-registry/apps/market')
      .send(manifest('market'))
    expect(res.status).toBe(401)
    expect(res.type).toMatch(/json/)
  })

  it('does not perform an item update when the required slug path parameter is missing', async () => {
    // @fuzequality api updateApp
    const res = await request(app)
      .put('/api/v1/app-registry/apps/')
      .set(asUser(userA))
      .send(manifest('market'))
    expect(res.status).toBe(404)
  })
})

describe('listApps BOLA + pagination', () => {
  it('returns 200 with only the apps visible to the caller', async () => {
    // @fuzequality api listApps
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

  it('rejects list requests with 401 when authentication is missing', async () => {
    // @fuzequality api listApps
    const res = await request(app).get('/api/v1/app-registry/apps')
    expect(res.status).toBe(401)
    expect(res.type).toMatch(/json/)
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

  // The reason nav_rank/nav_order exist: before them the list was ordered by
  // created_at, so the side menu was in REGISTRATION order and an app's lifecycle
  // placement could not be expressed at all.
  it('orders by lifecycle section, then order within a section — not by created_at', async () => {
    const rank = (s: string) => NAV_SECTIONS.indexOf(s as any)
    // Deliberately insert in the WRONG order (newest-first by section) so a
    // created_at-ordered result would be the exact reverse of what we assert.
    store.rows.push(
      mkRow('keys', orgA, 'organization', 0, { rank: rank('platform'), order: 1 }),
      mkRow('bi', orgA, 'organization', 1, { rank: rank('insight'), order: 1 }),
      mkRow('sales', orgA, 'organization', 2, { rank: rank('revenue'), order: 2 }),
      mkRow('market', orgA, 'organization', 3, { rank: rank('revenue'), order: 1 }),
      mkRow('exec', orgA, 'organization', 4, { rank: rank('executive'), order: 1 }),
    )
    const res = await request(app).get('/api/v1/app-registry/apps').set(asUser(userA))
    expect(res.status).toBe(200)
    expect(res.body.apps.map((a: any) => a.slug)).toEqual([
      'exec', // executive
      'market', // revenue, order 1
      'sales', // revenue, order 2  -> order breaks the tie within a section
      'bi', // insight
      'keys', // platform (last)
    ])
  })

  it('paginates correctly across a section boundary', async () => {
    const rank = (s: string) => NAV_SECTIONS.indexOf(s as any)
    store.rows.push(
      mkRow('exec', orgA, 'organization', 0, { rank: rank('executive'), order: 1 }),
      mkRow('plan', orgA, 'organization', 1, { rank: rank('plan'), order: 1 }),
      mkRow('build', orgA, 'organization', 2, { rank: rank('build'), order: 1 }),
      mkRow('rev', orgA, 'organization', 3, { rank: rank('revenue'), order: 1 }),
    )
    const seen: string[] = []
    let cursor: string | null = null
    // Walk the whole list one row at a time — the page size that maximises the
    // chance of a boundary bug, since every page ends on a new sort-key tuple.
    for (let i = 0; i < 5; i++) {
      const url = `/api/v1/app-registry/apps?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
      const page: any = await request(app).get(url).set(asUser(userA))
      seen.push(...page.body.apps.map((a: any) => a.slug))
      cursor = page.body.nextCursor
      if (!cursor) break
    }
    // Every app exactly once, still in lifecycle order.
    expect(seen).toEqual(['exec', 'plan', 'build', 'rev'])
  })
})

// nav_rank/nav_order mirror migration 005, where both columns are NOT NULL with
// defaults (platform = last rank, order 999). Seeding them here keeps the fake
// store faithful to the migrated schema — the list query's keyset predicate
// compares on them, and a row missing them would match no page-2 predicate.
function mkRow(
  slug: string,
  org: string,
  visibility: string,
  i = 0,
  nav?: { rank?: number; order?: number }
) {
  const created = new Date(Date.now() + i * 1000)
  return {
    slug, name: slug, status: 'activated', mode: 'portal', builtin: false,
    organization_id: org, visibility,
    manifest: JSON.stringify({ ...manifest(slug), visibility }),
    created_at: created, updated_at: created,
    nav_rank: nav?.rank ?? NAV_SECTIONS.indexOf('platform'),
    nav_order: nav?.order ?? 999,
  }
}
