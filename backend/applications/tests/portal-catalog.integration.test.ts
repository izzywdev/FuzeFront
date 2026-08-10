// FF-EPIC-12 (S1/S2/S3/S5) — the per-portal app catalog, tested end-to-end
// against a REAL Postgres. Real DB (not the fake in-memory knex used by
// app-registry.routes.test.ts) because this feature's core risk is a
// correlated `whereExists` SQL join (S2) and real FK-violation error codes
// (S1) — a hand-rolled fake query engine could silently mask exactly the bugs
// this suite exists to catch. Mirrors migrations.idempotency.integration.
// test.ts's self-contained ephemeral-DB setup; skips cleanly if Postgres is
// unreachable.
import path from 'path'
import jwt from 'jsonwebtoken'
import { Client } from 'pg'
import express from 'express'
import request from 'supertest'
import {
  runMigrations,
  initializeDatabaseConnection,
  closeDatabase,
  configureDatabase,
} from '@fuzefront/core'

const HOST = process.env.DB_HOST || 'localhost'
const PORT = parseInt(process.env.DB_PORT || '5432')
const USER = process.env.DB_USER || 'fuzeinfra'
const PASSWORD = process.env.DB_PASSWORD || 'fuzeinfra_secure_password'
const DB = 'fuzefront_apps_catalog_jest'
const JWT_SECRET = 'portal-catalog-test-secret'

async function pgReachable(): Promise<boolean> {
  const c = new Client({ host: HOST, port: PORT, user: USER, password: PASSWORD, database: 'postgres' })
  try {
    await c.connect()
    await c.query('SELECT 1')
    await c.end()
    return true
  } catch {
    return false
  }
}

let reachable = false

const dbOptions = {
  migrationsTableName: 'knex_migrations_apps',
  migrationsDir: path.join(__dirname, '..', 'dist', 'migrations'),
}

const ROOT_ORG_ID = '00000000-0000-0000-0000-000000000010'
const TENANT_ORG_ID = '00000000-0000-0000-0000-000000000020'
const OTHER_ORG_ID = '00000000-0000-0000-0000-000000000030'
const ROOT_PORTAL_ID = 'prt_root_00000000000000000000000000'
const TENANT_PORTAL_ID = 'prt_tenant_0000000000000000000000'

let PUBLIC_APP_ID: string
let TENANT_PRIVATE_APP_ID: string

beforeAll(async () => {
  reachable = await pgReachable()
  if (!reachable) return

  process.env.USE_POSTGRES = 'true'
  process.env.NODE_ENV = 'production'
  process.env.DB_HOST = HOST
  process.env.DB_PORT = String(PORT)
  process.env.DB_USER = USER
  process.env.DB_PASSWORD = PASSWORD
  process.env.DB_NAME = DB
  process.env.JWT_SECRET = JWT_SECRET

  const admin = new Client({ host: HOST, port: PORT, user: USER, password: PASSWORD, database: 'postgres' })
  await admin.connect()
  await admin.query(`DROP DATABASE IF EXISTS ${DB}`)
  await admin.query(`CREATE DATABASE ${DB}`)
  await admin.end()

  // Minimal cross-service dependency tables (organizations/users owned by
  // security-service, portals owned by the host backend) — same pattern as
  // migrations.idempotency.integration.test.ts.
  const c = new Client({ host: HOST, port: PORT, user: USER, password: PASSWORD, database: DB })
  await c.connect()
  await c.query('CREATE EXTENSION IF NOT EXISTS pgcrypto')
  await c.query('CREATE TABLE users (id uuid PRIMARY KEY DEFAULT gen_random_uuid())')
  await c.query('CREATE TABLE organizations (id uuid PRIMARY KEY DEFAULT gen_random_uuid())')
  await c.query(
    'CREATE TABLE portals (id varchar(44) PRIMARY KEY, organization_id uuid, is_root boolean NOT NULL DEFAULT false)'
  )
  await c.query('CREATE TABLE organization_memberships (user_id uuid, organization_id uuid, status varchar, role varchar)')
  await c.query(`INSERT INTO organizations (id) VALUES ('${ROOT_ORG_ID}'), ('${TENANT_ORG_ID}'), ('${OTHER_ORG_ID}')`)
  await c.query(
    `INSERT INTO portals (id, organization_id, is_root) VALUES
       ('${ROOT_PORTAL_ID}', '${ROOT_ORG_ID}', true),
       ('${TENANT_PORTAL_ID}', '${TENANT_ORG_ID}', false)`
  )
  await c.end()

  configureDatabase(dbOptions)
  await runMigrations(dbOptions)
  initializeDatabaseConnection(dbOptions)
}, 60000)

afterAll(async () => {
  if (!reachable) return
  await closeDatabase().catch(() => undefined)
})

// ── fixtures, seeded fresh per describe-block via db() (live after beforeAll) ──
import { db } from '../src/config/database'

async function seedApps(): Promise<void> {
  await db('apps').del()
  const publicApp = await db('apps')
    .insert({
      slug: 'public-catalog-app',
      name: 'Public Catalog App',
      url: 'https://public.example.com',
      status: 'activated',
      mode: 'portal',
      builtin: false,
      organization_id: null,
      visibility: 'public',
      manifest: JSON.stringify({
        manifestVersion: '1',
        slug: 'public-catalog-app',
        name: 'Public Catalog App',
        menuLabel: 'Public',
        mode: 'portal',
        visibility: 'public',
        integration: { type: 'iframe', url: 'https://public.example.com' },
      }),
      heartbeat_token: 'tok-public',
    })
    .returning('id')
  PUBLIC_APP_ID = publicApp[0].id ?? publicApp[0]

  const tenantApp = await db('apps')
    .insert({
      slug: 'tenant-private-app',
      name: 'Tenant Private App',
      url: 'https://tenant.example.com',
      status: 'activated',
      mode: 'portal',
      builtin: false,
      organization_id: TENANT_ORG_ID,
      visibility: 'private',
      manifest: JSON.stringify({
        manifestVersion: '1',
        slug: 'tenant-private-app',
        name: 'Tenant Private App',
        menuLabel: 'Tenant',
        mode: 'portal',
        visibility: 'private',
        integration: { type: 'iframe', url: 'https://tenant.example.com' },
      }),
      heartbeat_token: 'tok-tenant',
    })
    .returning('id')
  TENANT_PRIVATE_APP_ID = tenantApp[0].id ?? tenantApp[0]
}

async function clearCatalog(): Promise<void> {
  await db('portal_apps').del()
}

// ═════════════════════════════ S1 — catalog service ═════════════════════════
describe('FF-EPIC-12-S1 — PortalAppCatalogService (real Postgres)', () => {
  beforeAll(async () => {
    if (!reachable) return
    await seedApps()
  })
  beforeEach(async () => {
    if (!reachable) return
    await clearCatalog()
  })

  it('skips (Postgres unreachable)', () => {
    if (!reachable) console.warn('Postgres unreachable — skipping portal-catalog integration suite')
    expect(true).toBe(true)
  })

  it('AC2 — enable() is idempotent: re-enabling creates no duplicate row', async () => {
    if (!reachable) return
    const { portalAppCatalogService } = await import('../src/app-registry/catalog')

    await portalAppCatalogService.enable(TENANT_PORTAL_ID, PUBLIC_APP_ID, { pinnedOrder: 5 })
    await portalAppCatalogService.enable(TENANT_PORTAL_ID, PUBLIC_APP_ID) // re-enable, no opts
    await portalAppCatalogService.enable(TENANT_PORTAL_ID, PUBLIC_APP_ID) // and again

    const rows = await db('portal_apps').where({ portal_id: TENANT_PORTAL_ID, app_id: PUBLIC_APP_ID })
    expect(rows).toHaveLength(1)
    expect(rows[0].enabled).toBe(true)
    // pinnedOrder from the FIRST enable call is preserved by subsequent
    // no-opts re-enables (never reset to a default).
    expect(rows[0].pinned_order).toBe(5)
  })

  it('AC3 — disable() SOFT-disables and retains config/order for re-enable', async () => {
    if (!reachable) return
    const { portalAppCatalogService } = await import('../src/app-registry/catalog')

    await portalAppCatalogService.enable(TENANT_PORTAL_ID, PUBLIC_APP_ID, {
      pinnedOrder: 7,
      config: { theme: 'dark' },
    })
    const disabled = await portalAppCatalogService.disable(TENANT_PORTAL_ID, PUBLIC_APP_ID)
    expect(disabled?.enabled).toBe(false)

    // Row retained, not deleted.
    const rows = await db('portal_apps').where({ portal_id: TENANT_PORTAL_ID, app_id: PUBLIC_APP_ID })
    expect(rows).toHaveLength(1)
    expect(rows[0].pinned_order).toBe(7)
    // jsonb columns come back already-parsed from the pg driver.
    expect(rows[0].config).toEqual({ theme: 'dark' })

    // Bare re-enable (no opts) restores enabled=true WITHOUT clobbering the
    // preserved order/config.
    const reenabled = await portalAppCatalogService.enable(TENANT_PORTAL_ID, PUBLIC_APP_ID)
    expect(reenabled.enabled).toBe(true)
    expect(reenabled.pinnedOrder).toBe(7)
    expect(reenabled.config).toEqual({ theme: 'dark' })
  })

  it('AC4 — enable() with a nonexistent app_id maps to a clear FK error (field=app)', async () => {
    if (!reachable) return
    const { portalAppCatalogService, PortalAppFkViolationError } = await import('../src/app-registry/catalog')
    await expect(
      portalAppCatalogService.enable(TENANT_PORTAL_ID, '00000000-0000-0000-0000-00000000dead')
    ).rejects.toBeInstanceOf(PortalAppFkViolationError)
    try {
      await portalAppCatalogService.enable(TENANT_PORTAL_ID, '00000000-0000-0000-0000-00000000dead')
      throw new Error('expected enable() to reject')
    } catch (err) {
      expect(err).toBeInstanceOf(PortalAppFkViolationError)
      expect((err as InstanceType<typeof PortalAppFkViolationError>).field).toBe('app')
    }
  })

  it('AC4 — enable() with a nonexistent portal_id maps to a clear FK error (field=portal)', async () => {
    if (!reachable) return
    const { portalAppCatalogService, PortalAppFkViolationError } = await import('../src/app-registry/catalog')
    try {
      await portalAppCatalogService.enable('prt_does_not_exist', PUBLIC_APP_ID)
      throw new Error('expected enable() to reject')
    } catch (err) {
      expect(err).toBeInstanceOf(PortalAppFkViolationError)
      expect((err as InstanceType<typeof PortalAppFkViolationError>).field).toBe('portal')
    }
  })

  it('update() reorders/reconfigures without touching enabled', async () => {
    if (!reachable) return
    const { portalAppCatalogService } = await import('../src/app-registry/catalog')
    await portalAppCatalogService.enable(TENANT_PORTAL_ID, PUBLIC_APP_ID, { pinnedOrder: 1 })
    const updated = await portalAppCatalogService.update(TENANT_PORTAL_ID, PUBLIC_APP_ID, {
      pinnedOrder: 42,
      config: { pinned: true },
    })
    expect(updated?.pinnedOrder).toBe(42)
    expect(updated?.config).toEqual({ pinned: true })
    expect(updated?.enabled).toBe(true)
  })

  it('update()/disable() on a never-added (portal_id, app_id) pair return null', async () => {
    if (!reachable) return
    const { portalAppCatalogService } = await import('../src/app-registry/catalog')
    expect(await portalAppCatalogService.disable(TENANT_PORTAL_ID, PUBLIC_APP_ID)).toBeNull()
    expect(await portalAppCatalogService.update(TENANT_PORTAL_ID, PUBLIC_APP_ID, { pinnedOrder: 1 })).toBeNull()
  })

  it('list() clamps limit server-side and walks the full set via cursor with no gaps/dupes', async () => {
    if (!reachable) return
    const { portalAppCatalogService } = await import('../src/app-registry/catalog')

    // Seed 5 distinct apps enabled for the tenant portal (reuse PUBLIC_APP_ID's
    // row plus 4 synthetic app rows so pinned_order/app_id give a deterministic
    // walk order).
    const extraIds: string[] = []
    for (let i = 0; i < 4; i++) {
      const slug = `catalog-walk-app-${i}`
      const inserted = await db('apps')
        .insert({
          slug,
          name: slug,
          url: 'https://x.example.com',
          status: 'activated',
          mode: 'portal',
          builtin: false,
          organization_id: null,
          visibility: 'public',
          manifest: JSON.stringify({
            manifestVersion: '1',
            slug,
            name: slug,
            menuLabel: slug,
            mode: 'portal',
            visibility: 'public',
            integration: { type: 'iframe', url: 'https://x.example.com' },
          }),
          heartbeat_token: `tok-${slug}`,
        })
        .returning('id')
      extraIds.push(inserted[0].id ?? inserted[0])
    }
    const allIds = [PUBLIC_APP_ID, ...extraIds]
    for (const id of allIds) {
      await portalAppCatalogService.enable(TENANT_PORTAL_ID, id, { pinnedOrder: 0 })
    }

    // Over-max clamp: MAX_LIMIT is 200; requesting 10000 must clamp, not throw
    // or return unbounded.
    const clamped = await portalAppCatalogService.list(TENANT_PORTAL_ID, { limit: 10000 })
    expect(clamped.items.length).toBeLessThanOrEqual(200)

    // Full deterministic walk with a small page size.
    const seen = new Set<string>()
    let cursor: string | null | undefined = undefined
    let pages = 0
    do {
      const page = await portalAppCatalogService.list(TENANT_PORTAL_ID, { limit: 2, cursor: cursor ?? undefined })
      for (const item of page.items) {
        expect(seen.has(item.appId)).toBe(false) // no duplicates across pages
        seen.add(item.appId)
      }
      cursor = page.nextCursor
      pages++
      expect(pages).toBeLessThan(20) // guard against an infinite loop bug
    } while (cursor)

    for (const id of allIds) expect(seen.has(id)).toBe(true) // no gaps
  })
})

// ═══════════════════════ S2 — registry list() portal filter ═════════════════
describe('FF-EPIC-12-S2 — app-registry list() portal-catalog filter (no-leak)', () => {
  const platformAdmin = { userId: 'admin-1', organizationIds: [], roles: ['admin'], isPlatformAdmin: true }
  const tenantMember = { userId: 'tenant-user-1', organizationIds: [TENANT_ORG_ID], roles: ['user'], isPlatformAdmin: false }

  beforeAll(async () => {
    if (!reachable) return
    await seedApps()
  })
  beforeEach(async () => {
    if (!reachable) return
    await clearCatalog()
  })

  it('skips (Postgres unreachable)', () => {
    if (!reachable) console.warn('Postgres unreachable — skipping S2 no-leak suite')
    expect(true).toBe(true)
  })

  it("flag OFF (or portalCtx omitted) — byte-identical pre-epic behavior: public app visible", async () => {
    if (!reachable) return
    const { appRegistryService } = await import('../src/app-registry/service')
    const noCtx = await appRegistryService.list({}, tenantMember)
    expect(noCtx.apps.map(a => a.slug)).toContain('public-catalog-app')

    const offCtx = await appRegistryService.list({}, tenantMember, { mode: 'off', portalId: null })
    expect(offCtx.apps.map(a => a.slug)).toContain('public-catalog-app')
  })

  it("AC3 — root portal preserves today's unconditional visibility", async () => {
    if (!reachable) return
    const { appRegistryService } = await import('../src/app-registry/service')
    const result = await appRegistryService.list({}, tenantMember, { mode: 'root', portalId: ROOT_PORTAL_ID })
    expect(result.apps.map(a => a.slug)).toContain('public-catalog-app')
  })

  it('AC1/AC2 — THE NO-LEAK CASE: a public/org-less app NOT in the tenant portal catalog is NOT visible', async () => {
    if (!reachable) return
    const { appRegistryService } = await import('../src/app-registry/service')
    const result = await appRegistryService.list({}, tenantMember, { mode: 'scoped', portalId: TENANT_PORTAL_ID })
    const slugs = result.apps.map(a => a.slug)
    expect(slugs).not.toContain('public-catalog-app') // THE leak this epic fixes
    // The caller's own org-owned app is UNAFFECTED by the portal gate.
    expect(slugs).toContain('tenant-private-app')
  })

  it('once explicitly enabled in the tenant catalog, the public app becomes visible', async () => {
    if (!reachable) return
    const { appRegistryService } = await import('../src/app-registry/service')
    const { portalAppCatalogService } = await import('../src/app-registry/catalog')
    await portalAppCatalogService.enable(TENANT_PORTAL_ID, PUBLIC_APP_ID)

    const result = await appRegistryService.list({}, tenantMember, { mode: 'scoped', portalId: TENANT_PORTAL_ID })
    expect(result.apps.map(a => a.slug)).toContain('public-catalog-app')
  })

  it('a DISABLED catalog entry does not grant visibility', async () => {
    if (!reachable) return
    const { appRegistryService } = await import('../src/app-registry/service')
    const { portalAppCatalogService } = await import('../src/app-registry/catalog')
    await portalAppCatalogService.enable(TENANT_PORTAL_ID, PUBLIC_APP_ID)
    await portalAppCatalogService.disable(TENANT_PORTAL_ID, PUBLIC_APP_ID)

    const result = await appRegistryService.list({}, tenantMember, { mode: 'scoped', portalId: TENANT_PORTAL_ID })
    expect(result.apps.map(a => a.slug)).not.toContain('public-catalog-app')
  })

  it('AC4 — fail closed: a denied portal context returns an EMPTY set, never the unscoped global list', async () => {
    if (!reachable) return
    const { appRegistryService } = await import('../src/app-registry/service')
    // Even the caller's own org-owned app must not leak through 'denied' — the
    // whole visibility filter degrades to "match nothing" (S2 AC4: "empty
    // list ... never falling back to the unscoped global catalog").
    const result = await appRegistryService.list({}, tenantMember, { mode: 'denied', portalId: null })
    expect(result.apps).toHaveLength(0)
  })

  it('platform admin bypasses the portal-catalog gate entirely (sees everything, like today)', async () => {
    if (!reachable) return
    const { appRegistryService } = await import('../src/app-registry/service')
    const result = await appRegistryService.list({}, platformAdmin, { mode: 'denied', portalId: null })
    expect(result.apps.map(a => a.slug)).toEqual(
      expect.arrayContaining(['public-catalog-app', 'tenant-private-app'])
    )
  })
})

// ═══════════════════════ S5 — flag reader + portal context resolution ═══════
describe('FF-EPIC-12-S5 — fuzefront.apps.portal-catalog flag (both states)', () => {
  it('skips (Postgres unreachable)', () => {
    if (!reachable) console.warn('Postgres unreachable — skipping S5 suite')
    expect(true).toBe(true)
  })

  function signToken(portalId?: string): string {
    return jwt.sign(portalId ? { userId: 'u1', portalId } : { userId: 'u1' }, JWT_SECRET)
  }

  it('flag OFF (default, no client wired) — mode is always "off" regardless of token', async () => {
    if (!reachable) return
    const { setFlagClient } = await import('../src/app-registry/flags')
    setFlagClient(null)
    const { resolvePortalCatalogContext } = await import('../src/app-registry/portalContext')
    const req = { headers: { authorization: `Bearer ${signToken(TENANT_PORTAL_ID)}` } }
    const ctx = await resolvePortalCatalogContext(req as any)
    expect(ctx).toEqual({ mode: 'off', portalId: null })
  })

  it('flag ON + root-bound token — mode "root"', async () => {
    if (!reachable) return
    const { setFlagClient, FLAGS } = await import('../src/app-registry/flags')
    setFlagClient({ getBooleanValue: async (key: string) => key === FLAGS.PORTAL_CATALOG })
    const { resolvePortalCatalogContext, _clearRootPortalCacheForTests } = await import(
      '../src/app-registry/portalContext'
    )
    _clearRootPortalCacheForTests()
    const req = { headers: { authorization: `Bearer ${signToken(ROOT_PORTAL_ID)}` } }
    const ctx = await resolvePortalCatalogContext(req as any)
    expect(ctx).toEqual({ mode: 'root', portalId: ROOT_PORTAL_ID })
  })

  it('flag ON + tenant-bound token — mode "scoped"', async () => {
    if (!reachable) return
    const { setFlagClient, FLAGS } = await import('../src/app-registry/flags')
    setFlagClient({ getBooleanValue: async (key: string) => key === FLAGS.PORTAL_CATALOG })
    const { resolvePortalCatalogContext, _clearRootPortalCacheForTests } = await import(
      '../src/app-registry/portalContext'
    )
    _clearRootPortalCacheForTests()
    const req = { headers: { authorization: `Bearer ${signToken(TENANT_PORTAL_ID)}` } }
    const ctx = await resolvePortalCatalogContext(req as any)
    expect(ctx).toEqual({ mode: 'scoped', portalId: TENANT_PORTAL_ID })
  })

  it('flag ON + NO token — mode "denied" (missing context fails closed, never falls back)', async () => {
    if (!reachable) return
    const { setFlagClient, FLAGS } = await import('../src/app-registry/flags')
    setFlagClient({ getBooleanValue: async (key: string) => key === FLAGS.PORTAL_CATALOG })
    const { resolvePortalCatalogContext } = await import('../src/app-registry/portalContext')
    const req = { headers: {} }
    const ctx = await resolvePortalCatalogContext(req as any)
    expect(ctx).toEqual({ mode: 'denied', portalId: null })
  })

  it('flag ON + a legacy token with no portalId claim — mode "denied"', async () => {
    if (!reachable) return
    const { setFlagClient, FLAGS } = await import('../src/app-registry/flags')
    setFlagClient({ getBooleanValue: async (key: string) => key === FLAGS.PORTAL_CATALOG })
    const { resolvePortalCatalogContext } = await import('../src/app-registry/portalContext')
    const req = { headers: { authorization: `Bearer ${signToken()}` } }
    const ctx = await resolvePortalCatalogContext(req as any)
    expect(ctx).toEqual({ mode: 'denied', portalId: null })
  })

  it('S5 AC4 — an unreachable flag store degrades to OFF (fail-safe release default)', async () => {
    if (!reachable) return
    const { setFlagClient } = await import('../src/app-registry/flags')
    setFlagClient({ getBooleanValue: async () => { throw new Error('Unleash unreachable') } })
    const { resolvePortalCatalogContext } = await import('../src/app-registry/portalContext')
    const req = { headers: { authorization: `Bearer ${signToken(TENANT_PORTAL_ID)}` } }
    const ctx = await resolvePortalCatalogContext(req as any)
    expect(ctx).toEqual({ mode: 'off', portalId: null })
    setFlagClient(null)
  })
})

// ═══════════════════════════ S3 — catalog admin API ═════════════════════════
describe('FF-EPIC-12-S3 — portal catalog admin routes', () => {
  function buildApp() {
    const routerModule = require('../src/routes/portal-catalog')
    const app = express()
    app.use(express.json())
    app.use('/api/v1/app-registry', routerModule.default)
    return app
  }

  let testApp: express.Express
  let catalogFlagOn = true

  // authenticateToken is mocked here (real-DB session/user lookups are S1/S2's
  // concern, not S3's authz-shape concern) — mirrors app-registry.routes.test.
  // ts's own x-test-user convention exactly.
  jest.mock('../src/middleware/auth', () => ({
    authenticateToken: (req: any, res: any, next: any) => {
      req.user = req.headers['x-test-user'] ? JSON.parse(req.headers['x-test-user']) : null
      if (!req.user) return res.status(401).json({ error: 'unauthorized' })
      next()
    },
    requireRole: () => (_req: any, _res: any, next: any) => next(),
  }))

  // resolveCaller() (app-registry/caller.ts) queries organization_memberships
  // by user_id, a real `uuid` column — these must be valid UUIDs, not
  // arbitrary strings, or the query itself throws (22P02).
  const tenantAdminUser = { id: '10000000-0000-0000-0000-0000000000a1', roles: ['user'] }
  const outsiderUser = { id: '10000000-0000-0000-0000-0000000000a2', roles: ['user'] }
  const platformAdminUser = { id: '10000000-0000-0000-0000-0000000000a3', roles: ['admin'] }

  function asUser(u: any) {
    return { 'x-test-user': JSON.stringify(u) }
  }

  beforeAll(async () => {
    if (!reachable) return
    await seedApps()
    const { setFlagClient, FLAGS } = await import('../src/app-registry/flags')
    setFlagClient({ getBooleanValue: async (key: string) => (key === FLAGS.PORTAL_CATALOG ? catalogFlagOn : false) })
    const { setPermitClient } = await import('../src/app-registry/permit')
    // Grants 'manage' ONLY to tenantAdminUser on TENANT_ORG_ID — models a
    // portal-admin who owns the tenant portal's org but not others (the S3
    // AC4 cross-portal case). Keyed by BOTH user and tenant so `outsiderUser`
    // (an authenticated non-admin with no grant anywhere) is a genuine
    // negative case, not just "any user on the right tenant".
    setPermitClient({
      check: async (user: string, action: string, resource: { tenant?: string }) =>
        action === 'manage' && resource.tenant === TENANT_ORG_ID && user === tenantAdminUser.id,
    })
    testApp = buildApp()
  })
  beforeEach(async () => {
    if (!reachable) return
    await clearCatalog()
    catalogFlagOn = true
  })

  it('skips (Postgres unreachable)', () => {
    if (!reachable) console.warn('Postgres unreachable — skipping S3 route suite')
    expect(true).toBe(true)
  })

  it('flag OFF — the whole admin surface 503s (S5 gates S3 too)', async () => {
    if (!reachable) return
    catalogFlagOn = false
    const res = await request(testApp)
      .get(`/api/v1/app-registry/portals/${TENANT_PORTAL_ID}/catalog`)
      .set(asUser(platformAdminUser))
    expect(res.status).toBe(503)
  })

  it('platform admin can enable an app for ANY portal', async () => {
    if (!reachable) return
    const res = await request(testApp)
      .post(`/api/v1/app-registry/portals/${TENANT_PORTAL_ID}/catalog`)
      .set(asUser(platformAdminUser))
      .send({ appId: PUBLIC_APP_ID, pinnedOrder: 3 })
    expect(res.status).toBe(200)
    expect(res.body.enabled).toBe(true)
    expect(res.body.pinnedOrder).toBe(3)
  })

  it("portal-admin (Permit-granted on the portal's own org) can manage their own portal's catalog", async () => {
    if (!reachable) return
    const res = await request(testApp)
      .post(`/api/v1/app-registry/portals/${TENANT_PORTAL_ID}/catalog`)
      .set(asUser(tenantAdminUser))
      .send({ appId: PUBLIC_APP_ID })
    expect(res.status).toBe(200)
  })

  it('AC4 — a non-admin caller is 403d and the catalog is unchanged', async () => {
    if (!reachable) return
    const res = await request(testApp)
      .post(`/api/v1/app-registry/portals/${TENANT_PORTAL_ID}/catalog`)
      .set(asUser(outsiderUser))
      .send({ appId: PUBLIC_APP_ID })
    expect(res.status).toBe(403)
    const rows = await db('portal_apps').where({ portal_id: TENANT_PORTAL_ID, app_id: PUBLIC_APP_ID })
    expect(rows).toHaveLength(0)
  })

  it('AC4 — the SAME outsider is 403d for a DIFFERENT (non-owned) portal too', async () => {
    if (!reachable) return
    // outsiderUser holds no Permit grant anywhere (the stub only grants
    // TENANT_ORG_ID to whoever calls it) — proves this isn't accidentally
    // permissive for "any authenticated user".
    const res = await request(testApp)
      .get(`/api/v1/app-registry/portals/${ROOT_PORTAL_ID}/catalog`)
      .set(asUser(outsiderUser))
    expect(res.status).toBe(403)
  })

  it('enabling a nonexistent app_id maps to 404 with field=app (AC4 FK mapping)', async () => {
    if (!reachable) return
    const res = await request(testApp)
      .post(`/api/v1/app-registry/portals/${TENANT_PORTAL_ID}/catalog`)
      .set(asUser(platformAdminUser))
      .send({ appId: '00000000-0000-0000-0000-00000000dead' })
    expect(res.status).toBe(404)
    expect(res.body.field).toBe('app')
  })

  it('unknown portal_id in the path is a plain 404 before any catalog write', async () => {
    if (!reachable) return
    const res = await request(testApp)
      .post('/api/v1/app-registry/portals/prt_does_not_exist/catalog')
      .set(asUser(platformAdminUser))
      .send({ appId: PUBLIC_APP_ID })
    expect(res.status).toBe(404)
  })

  it('DELETE soft-disables (200 with the retained row), not a hard delete', async () => {
    if (!reachable) return
    await request(testApp)
      .post(`/api/v1/app-registry/portals/${TENANT_PORTAL_ID}/catalog`)
      .set(asUser(platformAdminUser))
      .send({ appId: PUBLIC_APP_ID })
    const del = await request(testApp)
      .delete(`/api/v1/app-registry/portals/${TENANT_PORTAL_ID}/catalog/${PUBLIC_APP_ID}`)
      .set(asUser(platformAdminUser))
    expect(del.status).toBe(200)
    expect(del.body.enabled).toBe(false)
    const rows = await db('portal_apps').where({ portal_id: TENANT_PORTAL_ID, app_id: PUBLIC_APP_ID })
    expect(rows).toHaveLength(1) // retained
  })

  it('PATCH reorders (pinnedOrder) an existing entry', async () => {
    if (!reachable) return
    await request(testApp)
      .post(`/api/v1/app-registry/portals/${TENANT_PORTAL_ID}/catalog`)
      .set(asUser(platformAdminUser))
      .send({ appId: PUBLIC_APP_ID, pinnedOrder: 1 })
    const patch = await request(testApp)
      .patch(`/api/v1/app-registry/portals/${TENANT_PORTAL_ID}/catalog/${PUBLIC_APP_ID}`)
      .set(asUser(platformAdminUser))
      .send({ pinnedOrder: 99 })
    expect(patch.status).toBe(200)
    expect(patch.body.pinnedOrder).toBe(99)
  })

  it('S3 AC2 — GET catalog is cursor-paginated: envelope shape + limit clamp + full walk, no dup/gaps', async () => {
    if (!reachable) return
    const seededIds: string[] = []
    for (let i = 0; i < 6; i++) {
      const slug = `s3-page-app-${i}`
      const inserted = await db('apps')
        .insert({
          slug,
          name: slug,
          url: 'https://x.example.com',
          status: 'activated',
          mode: 'portal',
          builtin: false,
          organization_id: null,
          visibility: 'public',
          manifest: JSON.stringify({
            manifestVersion: '1',
            slug,
            name: slug,
            menuLabel: slug,
            mode: 'portal',
            visibility: 'public',
            integration: { type: 'iframe', url: 'https://x.example.com' },
          }),
          heartbeat_token: `tok-${slug}`,
        })
        .returning('id')
      const id = inserted[0].id ?? inserted[0]
      seededIds.push(id)
      await request(testApp)
        .post(`/api/v1/app-registry/portals/${TENANT_PORTAL_ID}/catalog`)
        .set(asUser(platformAdminUser))
        .send({ appId: id })
    }

    const seen = new Set<string>()
    let cursor: string | undefined
    let pages = 0
    do {
      const res = await request(testApp)
        .get(`/api/v1/app-registry/portals/${TENANT_PORTAL_ID}/catalog`)
        .query({ limit: 2, ...(cursor ? { cursor } : {}) })
        .set(asUser(platformAdminUser))
      expect(res.status).toBe(200)
      expect(res.body).toHaveProperty('items')
      expect(res.body).toHaveProperty('page')
      expect(res.body.page).toHaveProperty('nextCursor')
      expect(res.body.page).toHaveProperty('hasMore')
      for (const item of res.body.items) {
        expect(seen.has(item.appId)).toBe(false)
        seen.add(item.appId)
      }
      cursor = res.body.page.nextCursor
      pages++
      expect(pages).toBeLessThan(20)
    } while (cursor)

    for (const id of seededIds) expect(seen.has(id)).toBe(true)
  })

  it('every route is rate-limited (standard RateLimit headers present)', async () => {
    if (!reachable) return
    const res = await request(testApp)
      .get(`/api/v1/app-registry/portals/${TENANT_PORTAL_ID}/catalog`)
      .set(asUser(platformAdminUser))
    expect(res.headers['ratelimit-limit']).toBeDefined()
  })
})
