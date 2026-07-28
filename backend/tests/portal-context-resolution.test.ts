import { v4 as uuidv4 } from 'uuid'
import express from 'express'
import request from 'supertest'

jest.mock('../src/config/permit', () => ({
  __esModule: true,
  default: { api: {} },
}))

import { db, initializeDatabaseConnection } from '../src/config/database'
import {
  createResolvePortalContext,
  invalidatePortalCache,
  _clearPortalCacheForTests,
} from '../src/middleware/portalContext'
import { ROOT_PORTAL_ID, ROOT_PORTAL_SLUG, generatePortalId } from '../src/repositories/portalRepository'

beforeAll(() => {
  initializeDatabaseConnection()
})

async function createUser(): Promise<string> {
  const id = uuidv4()
  await db('users').insert({
    id,
    email: `portal-resolve-${id.slice(0, 8)}@test.local`,
    first_name: 'Portal',
    last_name: 'Resolve',
    roles: JSON.stringify(['admin', 'user']),
    created_at: new Date(),
    updated_at: new Date(),
  })
  return id
}

async function createPortal(opts: {
  slug: string
  status?: 'active' | 'suspended'
  isRoot?: boolean
  domain?: { domain: string; kind: 'subdomain' | 'custom' }
}) {
  const userId = await createUser()
  const orgId = uuidv4()
  await db('organizations').insert({
    id: orgId,
    name: opts.slug,
    slug: `${opts.slug}-${orgId.slice(0, 6)}`,
    owner_id: userId,
    type: opts.isRoot ? 'platform' : 'organization',
    settings: JSON.stringify({}),
    metadata: JSON.stringify({}),
    is_active: true,
    provisioning_state: 'active',
  })
  const portalId = opts.isRoot ? ROOT_PORTAL_ID : generatePortalId()
  await db('portals').insert({
    id: portalId,
    organization_id: orgId,
    slug: opts.slug,
    name: opts.slug,
    status: opts.status ?? 'active',
    billing_mode: 'free',
    branding: JSON.stringify({ name: opts.slug }),
    identity_policy: JSON.stringify({ allowPasswordLogin: true, allowSelfSignup: false }),
    is_root: !!opts.isRoot,
  })
  if (opts.domain) {
    await db('portal_domains').insert({
      portal_id: portalId,
      domain: opts.domain.domain,
      kind: opts.domain.kind,
      is_primary: true,
      verification_status: 'verified',
      tls_status: 'issued',
    })
  }
  return portalId
}

function buildApp(enabled: boolean) {
  const app = express()
  const middleware = createResolvePortalContext({
    db,
    isEnabled: async () => enabled,
  })
  app.use(middleware)
  app.get('/api/v1/portal/context', (req: any, res) => {
    res.json({
      portal: req.portal ? { id: req.portal.id, slug: req.portal.slug } : null,
      portalsFlagEnabled: req.portalsFlagEnabled,
    })
  })
  app.get('/p/:slug/whatever', (req: any, res) => {
    res.json({ portal: req.portal ? { id: req.portal.id, slug: req.portal.slug } : null })
  })
  return app
}

beforeEach(async () => {
  _clearPortalCacheForTests()
  await db('portal_domains').del()
  await db('portals').del()
})

describe('resolvePortalContext (FF-EPIC-10-S1)', () => {
  it('is a no-op when the master flag is OFF — req.portal stays undefined', async () => {
    await createPortal({ slug: ROOT_PORTAL_SLUG, isRoot: true })
    const app = buildApp(false)

    const res = await request(app)
      .get('/api/v1/portal/context')
      .set('Host', 'unknown.example.com')
    expect(res.status).toBe(200)
    expect(res.body.portal).toBeNull()
  })

  it('resolves by Host header for a subdomain portal_domains row', async () => {
    await createPortal({ slug: ROOT_PORTAL_SLUG, isRoot: true })
    const portalId = await createPortal({
      slug: 'northwind',
      domain: { domain: 'northwind.fuzefront.test', kind: 'subdomain' },
    })
    const app = buildApp(true)

    const res = await request(app)
      .get('/api/v1/portal/context')
      .set('Host', 'northwind.fuzefront.test')
    expect(res.status).toBe(200)
    expect(res.body.portal).toEqual({ id: portalId, slug: 'northwind' })
  })

  it('resolves by Host header for a custom domain', async () => {
    await createPortal({ slug: ROOT_PORTAL_SLUG, isRoot: true })
    const portalId = await createPortal({
      slug: 'acme',
      domain: { domain: 'portal.acme.example', kind: 'custom' },
    })
    const app = buildApp(true)

    const res = await request(app)
      .get('/api/v1/portal/context')
      .set('Host', 'portal.acme.example')
    expect(res.body.portal).toEqual({ id: portalId, slug: 'acme' })
  })

  it('falls back to /p/<slug> path when the Host does not match', async () => {
    await createPortal({ slug: ROOT_PORTAL_SLUG, isRoot: true })
    const portalId = await createPortal({ slug: 'contoso' })
    const app = buildApp(true)

    const res = await request(app)
      .get('/p/contoso/whatever')
      .set('Host', 'app.fuzefront.test')
    expect(res.body.portal).toEqual({ id: portalId, slug: 'contoso' })
  })

  it('falls back to the root portal when neither Host nor path match', async () => {
    const rootId = await createPortal({ slug: ROOT_PORTAL_SLUG, isRoot: true })
    const app = buildApp(true)

    const res = await request(app)
      .get('/api/v1/portal/context')
      .set('Host', 'totally-unknown.example.com')
    expect(res.body.portal).toEqual({ id: rootId, slug: ROOT_PORTAL_SLUG })
  })

  // Bug 4 fix — a genuine bootstrap state (flag ON, no root portal seeded
  // yet) must PASS THROUGH, not 404. Previously this 404'd every request —
  // including login/signup/health — because the middleware is mounted
  // globally ahead of every route, permanently bricking a fresh install
  // (nothing could authenticate to create the first user and seed the root
  // portal). See the dedicated bootstrap-mode describe block below for the
  // full request-reachability assertions (login, health, etc.).
  it('passes through (does not 404) in bootstrap mode — no root portal seeded yet', async () => {
    // portals table is empty (beforeEach cleared it, and this test creates none).
    const app = buildApp(true)

    const res = await request(app)
      .get('/api/v1/portal/context')
      .set('Host', 'nothing.example.com')
    // The route handler ran (next() was called) — req.portal stayed
    // undefined, so this specific bare test route reports portal: null. It
    // is explicitly NOT the middleware's own blanket 404 anymore.
    expect(res.status).toBe(200)
    expect(res.body.portal).toBeNull()
  })

  it('fails closed with 403 PORTAL_SUSPENDED before any handler runs', async () => {
    await createPortal({ slug: ROOT_PORTAL_SLUG, isRoot: true })
    await createPortal({
      slug: 'suspended-co',
      status: 'suspended',
      domain: { domain: 'suspended-co.fuzefront.test', kind: 'subdomain' },
    })
    const app = buildApp(true)

    const res = await request(app)
      .get('/api/v1/portal/context')
      .set('Host', 'suspended-co.fuzefront.test')
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('PORTAL_SUSPENDED')
  })

  it('caches a resolution and serves it without re-querying until invalidated', async () => {
    await createPortal({ slug: ROOT_PORTAL_SLUG, isRoot: true })
    const portalId = await createPortal({
      slug: 'cached-co',
      domain: { domain: 'cached-co.fuzefront.test', kind: 'subdomain' },
    })
    const app = buildApp(true)

    const first = await request(app)
      .get('/api/v1/portal/context')
      .set('Host', 'cached-co.fuzefront.test')
    expect(first.body.portal).toEqual({ id: portalId, slug: 'cached-co' })

    // Suspend directly in the DB without invalidating the cache — the
    // middleware should still serve the cached (pre-suspend) resolution.
    await db('portals').where({ id: portalId }).update({ status: 'suspended' })

    const second = await request(app)
      .get('/api/v1/portal/context')
      .set('Host', 'cached-co.fuzefront.test')
    expect(second.status).toBe(200)
    expect(second.body.portal).toEqual({ id: portalId, slug: 'cached-co' })

    // Now invalidate — the next request must see the suspension immediately.
    invalidatePortalCache(portalId)
    const third = await request(app)
      .get('/api/v1/portal/context')
      .set('Host', 'cached-co.fuzefront.test')
    expect(third.status).toBe(403)
    expect(third.body.error).toBe('PORTAL_SUSPENDED')
  })

  // Coordinator-flagged bug 2 — a miss (row === null) cached under a host/slug
  // key can never be matched by `entry.row?.id === portalId`, so a targeted
  // invalidatePortalCache(newPortalId) after creating a portal left the STALE
  // "not found" cached for the rest of the TTL, and the brand-new portal
  // stayed unresolvable immediately after creation.
  it('invalidatePortalCache clears a prior negative (miss) lookup so a newly created portal resolves immediately', async () => {
    await createPortal({ slug: ROOT_PORTAL_SLUG, isRoot: true })
    const app = buildApp(true)
    const freshHost = 'brand-new-co.fuzefront.test'

    // 1. Resolve an unknown host BEFORE the portal exists — caches a miss
    //    (falls back to root, but internally records `host:brand-new-co...`
    //    -> null in the cache).
    const before = await request(app).get('/api/v1/portal/context').set('Host', freshHost)
    expect(before.status).toBe(200)
    expect(before.body.portal).toEqual({ id: ROOT_PORTAL_ID, slug: ROOT_PORTAL_SLUG })

    // 2. NOW create the portal + domain for that exact host.
    const newPortalId = await createPortal({
      slug: 'brand-new-co',
      domain: { domain: freshHost, kind: 'subdomain' },
    })

    // 3. Invalidate (as the follow-up EPIC-09 create-portal endpoint will do).
    invalidatePortalCache(newPortalId)

    // 4. The SAME host must now resolve to the new portal, not the stale
    //    negative-cache root fallback.
    const after = await request(app).get('/api/v1/portal/context').set('Host', freshHost)
    expect(after.status).toBe(200)
    expect(after.body.portal).toEqual({ id: newPortalId, slug: 'brand-new-co' })
  })

  it('a full invalidatePortalCache() (no portalId) also clears negative entries', async () => {
    await createPortal({ slug: ROOT_PORTAL_SLUG, isRoot: true })
    const app = buildApp(true)
    const freshHost = 'another-new-co.fuzefront.test'

    await request(app).get('/api/v1/portal/context').set('Host', freshHost) // caches a miss

    const newPortalId = await createPortal({
      slug: 'another-new-co',
      domain: { domain: freshHost, kind: 'subdomain' },
    })
    invalidatePortalCache() // full clear, no portalId

    const after = await request(app).get('/api/v1/portal/context').set('Host', freshHost)
    expect(after.body.portal).toEqual({ id: newPortalId, slug: 'another-new-co' })
  })

  // Coordinator-flagged bug 1(b) — stashes the per-request flag decision so
  // authenticateToken (middleware/auth.ts) can reuse the EXACT SAME result
  // instead of re-evaluating independently with a different context, which
  // is what let the two middlewares disagree in the first place.
  it('stashes the evaluated flag decision on req.portalsFlagEnabled for downstream reuse', async () => {
    await createPortal({ slug: ROOT_PORTAL_SLUG, isRoot: true })

    const onApp = buildApp(true)
    const onRes = await request(onApp).get('/api/v1/portal/context').set('Host', 'x.example.com')
    expect(onRes.body.portalsFlagEnabled).toBe(true)

    const offApp = buildApp(false)
    const offRes = await request(offApp).get('/api/v1/portal/context').set('Host', 'x.example.com')
    expect(offRes.body.portalsFlagEnabled).toBe(false)
  })

  // Round-6 gate-code-review finding — the catch-all previously mapped ANY
  // thrown error (a transient portals-table hiccup in findPortalByDomain /
  // findPortalBySlug / getRootPortal) to a 500 for the WHOLE request. Since
  // this middleware is mounted globally ahead of every route, that turned
  // health/login/metrics into 500s too on a brief DB blip once the flag is
  // ON — the same "fail-closed at the wrong layer" class already fixed for
  // the bootstrap case. Must degrade gracefully instead.
  function throwingDb(): any {
    const chain: any = {
      where: () => chain,
      whereIn: () => chain,
      andWhere: () => chain,
      first: async () => {
        throw new Error('simulated portals-table DB error')
      },
    }
    return (_table: string) => chain
  }

  it('degrades gracefully (does not 500) when EVERY portal lookup throws — a portals-table hiccup must never 500 the whole request', async () => {
    const middleware = createResolvePortalContext({ db: throwingDb(), isEnabled: async () => true })
    const app = express()
    app.use(middleware)
    app.get('/probe', (req: any, res) => res.json({ ok: true, portal: req.portal ?? null }))

    const res = await request(app).get('/probe').set('Host', 'anything.example.com')
    // Each lookup (host, path/slug, root) individually degrades to a miss
    // inside cached(); with every lookup missing, resolution reaches the
    // SAME bootstrap-mode pass-through as "no root portal seeded yet" — the
    // request reaches the downstream handler (health/login/metrics would
    // too), NOT a 500, and req.portal stays undefined rather than a
    // guessed/fabricated portal.
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.portal).toBeNull()
  })

  it('degrades gracefully (does not 500) on an error OUTSIDE the lookups too — the outer catch-all is a last-resort net, not just cached()', async () => {
    // Simulates a genuinely unexpected error that isn't a lookup at all
    // (cached()'s own try/catch only covers findPortalByDomain/
    // findPortalBySlug/getRootPortal) — the flag evaluation itself throwing
    // is a stand-in for "anything else could go wrong here". The outer
    // catch must ALSO pass through, never 500.
    const middleware = createResolvePortalContext({
      isEnabled: async () => {
        throw new Error('simulated unexpected error, not a DB lookup')
      },
    })
    const app = express()
    app.use(middleware)
    app.get('/probe', (req: any, res) => res.json({ ok: true, portal: req.portal ?? null }))

    const res = await request(app).get('/probe').set('Host', 'anything.example.com')
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.portal).toBeNull()
  })

  it('does NOT cache a lookup error — the very next request retries the DB and recovers once it is healthy again', async () => {
    const rootId = await createPortal({ slug: ROOT_PORTAL_SLUG, isRoot: true })
    let shouldThrow = true
    const flakyDb: any = (table: string) => {
      if (shouldThrow) {
        const chain: any = {
          where: () => chain,
          whereIn: () => chain,
          andWhere: () => chain,
          first: async () => {
            throw new Error('simulated transient DB error')
          },
        }
        return chain
      }
      return db(table)
    }
    const middleware = createResolvePortalContext({ db: flakyDb, isEnabled: async () => true })
    const app = express()
    app.use(middleware)
    app.get('/probe', (req: any, res) => res.json({ portal: req.portal ? { id: req.portal.id } : null }))

    const first = await request(app).get('/probe').set('Host', 'flaky-db.example.com')
    expect(first.status).toBe(200)
    expect(first.body.portal).toBeNull() // degraded — DB was "down"

    shouldThrow = false // DB recovers
    const second = await request(app).get('/probe').set('Host', 'flaky-db.example.com')
    expect(second.status).toBe(200)
    // Falls back to root and resolves it correctly — proving the earlier
    // error was NOT cached as a stale miss for the TTL.
    expect(second.body.portal).toEqual({ id: rootId })
  })

  // Round-7 gate-code-review finding (GENUINE FAIL-OPEN, highest priority) —
  // the old behavior treated a host-lookup ERROR exactly like a genuine miss
  // and fell through to path -> root. If the Host maps to a SUSPENDED
  // portal, the domain query hits a transient error, and `root` (an active
  // portal) is still cached from an earlier request, the request resolved
  // to `{ kind: 'resolved', row: rootRow }` and was served ROOT branding —
  // silently defeating suspension for that host. A host-lookup error must
  // instead degrade the WHOLE request to pass-through (req.portal unset),
  // never fall through to path or root.
  function domainLookupThrowingDb(): any {
    return (table: string) => {
      if (table === 'portal_domains') {
        const chain: any = {
          whereIn: () => chain,
          andWhere: () => chain,
          where: () => chain,
          first: async () => {
            throw new Error('simulated transient DB error on domain lookup')
          },
        }
        return chain
      }
      return db(table)
    }
  }

  it('a host-lookup error must NOT fall through to root — suspension must never be defeated by a transient DB error', async () => {
    await createPortal({ slug: ROOT_PORTAL_SLUG, isRoot: true })
    await createPortal({
      slug: 'suspended-co',
      status: 'suspended',
      domain: { domain: 'suspended-co.fuzefront.test', kind: 'subdomain' },
    })

    // Warm the "root" cache entry with a healthy DB first — mirroring the
    // real failure mode: root was already resolved/cached from an earlier,
    // unrelated request, and it is a perfectly healthy, active portal.
    const warmApp = buildApp(true)
    const warm = await request(warmApp)
      .get('/api/v1/portal/context')
      .set('Host', 'totally-unrelated-host.example.com')
    expect(warm.body.portal).toEqual({ id: ROOT_PORTAL_ID, slug: ROOT_PORTAL_SLUG })

    // Now the Host maps to the SUSPENDED portal, but its domain-lookup query
    // throws (a transient DB blip) while `root` is still cached and active.
    const middleware = createResolvePortalContext({
      db: domainLookupThrowingDb(),
      isEnabled: async () => true,
    })
    const app = express()
    app.use(middleware)
    app.get('/probe', (req: any, res) =>
      res.json({ portal: req.portal ? { id: req.portal.id, slug: req.portal.slug } : null })
    )

    const res = await request(app).get('/probe').set('Host', 'suspended-co.fuzefront.test')

    expect(res.status).toBe(200)
    // MUST NOT be served the root portal (or any resolved portal) — the
    // request must degrade to pass-through, never fall through to root.
    expect(res.body.portal).toBeNull()
  })
})
