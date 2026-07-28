import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'
import { v4 as uuidv4 } from 'uuid'

jest.mock('../src/config/permit', () => ({
  __esModule: true,
  default: { api: {} },
}))

import * as portalFlagModule from '../src/utils/portalFlag'
import { db, initializeDatabaseConnection } from '../src/config/database'
import { resolvePortalContext, _clearPortalCacheForTests } from '../src/middleware/portalContext'
import { authenticateToken } from '../src/middleware/auth'
import authRoutes, { drainProvisioningQueue } from '../src/routes/auth'
import portalRoutes from '../src/routes/portal'
import {
  ROOT_PORTAL_ID,
  ROOT_PORTAL_SLUG,
  generatePortalId,
} from '../src/repositories/portalRepository'

// Controls the master flag for every consumer of utils/portalFlag (routes,
// middleware/auth, middleware/portalContext) via one mutable boolean — see the
// feature-flags skill: BOTH states must be exercised. This substitutes for the
// OpenFeature test provider (no Unleash/@fuzefront/feature-flags package is
// installed in this sandbox) but keeps the exact same call contract every
// production module already uses.
//
// jest.spyOn (mutating the REAL module's exported function in place) rather
// than jest.mock(path, factory): tests/setup.ts imports routes/auth.ts (for
// drainProvisioningQueue) BEFORE this file's own top-level code runs, which
// already binds middleware/auth.ts's copy of `isMultiTenantPortalsEnabled` to
// the real module object. jest.mock() only redirects requires that happen
// AFTER it registers, so middleware/auth wouldn't see it; jest.spyOn mutates
// the one shared module object every importer's CJS-compiled property lookup
// reads at call time, so every consumer observes the same override.
let flagEnabled = false
beforeAll(() => {
  initializeDatabaseConnection()
  jest.spyOn(portalFlagModule, 'isMultiTenantPortalsEnabled').mockImplementation(
    async () => flagEnabled
  )
})

// This file's bootstrap-mode/login tests exercise the REAL login route,
// which fires selfHealProvisioningOnLogin (organizationProvisioning) without
// awaiting it. Drain explicitly (same pattern as tests/setup.ts's global
// afterAll) so those in-flight promises settle before this file's own test
// run ends, rather than racing the global teardown.
afterAll(async () => {
  await drainProvisioningQueue(8_000)
})

const app = express()
app.use(express.json())
app.use(resolvePortalContext)
app.use('/api/v1/portal', portalRoutes)

async function createUser(): Promise<string> {
  const id = uuidv4()
  await db('users').insert({
    id,
    email: `portal-route-${id.slice(0, 8)}@test.local`,
    first_name: 'Portal',
    last_name: 'Route',
    roles: JSON.stringify(['user']),
    created_at: new Date(),
    updated_at: new Date(),
  })
  return id
}

async function createPortal(opts: {
  slug: string
  isRoot?: boolean
  domain?: string
}): Promise<{ portalId: string; organizationId: string }> {
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
    status: 'active',
    billing_mode: 'free',
    branding: JSON.stringify({ name: opts.slug }),
    identity_policy: JSON.stringify({ allowPasswordLogin: true, allowSelfSignup: true }),
    is_root: !!opts.isRoot,
  })
  if (opts.domain) {
    await db('portal_domains').insert({
      portal_id: portalId,
      domain: opts.domain,
      kind: 'subdomain',
      is_primary: true,
      verification_status: 'verified',
      tls_status: 'issued',
    })
  }
  return { portalId, organizationId: orgId }
}

function signToken(userId: string, portalId?: string): string {
  return jwt.sign(
    { userId, sessionId: uuidv4(), ...(portalId ? { portalId } : {}) },
    process.env.JWT_SECRET!,
    { expiresIn: '24h' }
  )
}

beforeEach(async () => {
  flagEnabled = false
  _clearPortalCacheForTests()
  await db('portal_domains').del()
  await db('portals').del()
})

describe('GET /api/v1/portal/context — flag OFF (FF-EPIC-09-S4 AC1)', () => {
  it('returns 404 — unchanged from pre-epic behavior (no such route existed)', async () => {
    await createPortal({ slug: ROOT_PORTAL_SLUG, isRoot: true })
    const res = await request(app).get('/api/v1/portal/context').set('Host', 'app.fuzefront.test')
    expect(res.status).toBe(404)
  })
})

describe('GET /api/v1/portal/context — flag ON', () => {
  it('returns the public projection for the resolved (root) portal', async () => {
    flagEnabled = true
    await createPortal({ slug: ROOT_PORTAL_SLUG, isRoot: true })

    const res = await request(app).get('/api/v1/portal/context').set('Host', 'app.fuzefront.test')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ id: ROOT_PORTAL_ID, slug: ROOT_PORTAL_SLUG, isRoot: true })
    expect(res.body.branding).toBeDefined()
    expect(res.body.identityPolicy).toBeDefined()
    expect(res.body.authEntry).toBeDefined()
    // Public projection — never leaks internal fields.
    expect(res.body.organizationId).toBeUndefined()
    expect(res.body.billingMode).toBeUndefined()
    expect(res.body.domains).toBeUndefined()
  })

  it('resolves a tenant portal by Host', async () => {
    flagEnabled = true
    await createPortal({ slug: ROOT_PORTAL_SLUG, isRoot: true })
    await createPortal({ slug: 'northwind', domain: 'northwind.fuzefront.test' })

    const res = await request(app)
      .get('/api/v1/portal/context')
      .set('Host', 'northwind.fuzefront.test')
    expect(res.status).toBe(200)
    expect(res.body.slug).toBe('northwind')
  })

  it('returns 403 PORTAL_SUSPENDED for a suspended portal', async () => {
    flagEnabled = true
    await createPortal({ slug: ROOT_PORTAL_SLUG, isRoot: true })
    const { portalId } = await createPortal({ slug: 'suspendo', domain: 'suspendo.fuzefront.test' })
    await db('portals').where({ id: portalId }).update({ status: 'suspended' })

    const res = await request(app)
      .get('/api/v1/portal/context')
      .set('Host', 'suspendo.fuzefront.test')
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('PORTAL_SUSPENDED')
  })
})

describe('GET /api/v1/portal/current — flag OFF', () => {
  it('returns 404 even with a valid token — unchanged from pre-epic behavior', async () => {
    const userId = await createUser()
    const token = signToken(userId)
    const res = await request(app)
      .get('/api/v1/portal/current')
      .set('Authorization', `Bearer ${token}`)
      .set('Host', 'app.fuzefront.test')
    expect(res.status).toBe(404)
  })

  it('still requires authentication (401 with no token) — auth middleware itself is unaffected', async () => {
    const res = await request(app).get('/api/v1/portal/current').set('Host', 'app.fuzefront.test')
    expect(res.status).toBe(401)
  })
})

describe('GET /api/v1/portal/current — flag ON (FF-EPIC-10-S3 JWT/session binding)', () => {
  it('returns the caller\'s own portal resolved from the token portal_id claim', async () => {
    flagEnabled = true
    await createPortal({ slug: ROOT_PORTAL_SLUG, isRoot: true })
    const userId = await createUser()
    const { portalId } = await createPortal({ slug: 'acme', domain: 'acme.fuzefront.test' })

    const token = signToken(userId, portalId)
    const res = await request(app)
      .get('/api/v1/portal/current')
      .set('Authorization', `Bearer ${token}`)
      .set('Host', 'acme.fuzefront.test')

    expect(res.status).toBe(200)
    expect(res.body.id).toBe(portalId)
    expect(res.body.slug).toBe('acme')
    expect(res.body.domains).toEqual(
      expect.arrayContaining([expect.objectContaining({ domain: 'acme.fuzefront.test' })])
    )
  })

  it('AC3 — rejects (401) a token whose portal_id claim mismatches the Host-resolved portal', async () => {
    flagEnabled = true
    await createPortal({ slug: ROOT_PORTAL_SLUG, isRoot: true })
    const userId = await createUser()
    const { portalId: portalA } = await createPortal({ slug: 'portal-a', domain: 'portal-a.fuzefront.test' })
    await createPortal({ slug: 'portal-b', domain: 'portal-b.fuzefront.test' })

    // Token minted for portal A, presented on portal B's Host.
    const token = signToken(userId, portalA)
    const res = await request(app)
      .get('/api/v1/portal/current')
      .set('Authorization', `Bearer ${token}`)
      .set('Host', 'portal-b.fuzefront.test')

    expect(res.status).toBe(401)
  })

  it('risk mitigation — a legacy token with no portal_id claim binds to the resolved (root) portal', async () => {
    flagEnabled = true
    const rootOrg = await createPortal({ slug: ROOT_PORTAL_SLUG, isRoot: true })
    const userId = await createUser()

    const token = signToken(userId) // no portalId claim
    const res = await request(app)
      .get('/api/v1/portal/current')
      .set('Authorization', `Bearer ${token}`)
      .set('Host', 'unresolvable-host.example.com') // falls back to root

    expect(res.status).toBe(200)
    expect(res.body.id).toBe(rootOrg.portalId)
  })

  it('returns 403 FORBIDDEN_PORTAL when no portal is bound and no root portal is seeded (bootstrap mode)', async () => {
    flagEnabled = true
    // Bug 4 fix — no portals at all (bootstrap). resolvePortalContext now
    // PASSES THROUGH instead of 404ing (previously it 404'd here before
    // authenticateToken ever ran). The request still reaches /current, which
    // makes its own honest decision: no portalId is bound (no claim, no root
    // to fall back to) -> 403 FORBIDDEN_PORTAL from the route's own logic,
    // not a blanket middleware block.
    const userId = await createUser()
    const token = signToken(userId)
    const res = await request(app)
      .get('/api/v1/portal/current')
      .set('Authorization', `Bearer ${token}`)
      .set('Host', 'nothing.example.com')
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('FORBIDDEN_PORTAL')
  })
})

// Coordinator-flagged bug 1 — authenticateToken previously evaluated the
// multi-tenant flag with {userId}, resolvePortalContext with {} (pre-auth, no
// user). Those two evaluations can legitimately disagree under per-user
// targeting, and the OLD guard `resolvedPortal && resolvedPortal.id !==
// decoded.portalId` skipped the reject whenever resolvedPortal was undefined
// — silently ACCEPTING a cross-portal token. Fixed by (a) failing closed
// whenever a claimed portal_id has no portal context to verify it against,
// and (b) authenticateToken reusing resolvePortalContext's exact decision
// (req.portalsFlagEnabled) instead of a second, independent evaluation.
describe('FF-EPIC-10-S3 fail-closed fix — cross-portal token rejection under context disagreement', () => {
  it('fails closed (401) when a portal_id-bearing token reaches authenticateToken with NO portal context at all (resolvePortalContext never ran)', async () => {
    // A minimal app that mounts ONLY authenticateToken — simulating exactly
    // the disagreement scenario: some route (or a future refactor) has the
    // flag ON but no resolvePortalContext upstream, so req.portal/
    // req.portalsFlagEnabled are both absent and authenticateToken must fall
    // back to its own evaluation. The bug let this silently ACCEPT the token;
    // the fix must REJECT it, because there is no portal context to verify
    // the claim against.
    flagEnabled = true
    const bareApp = express()
    bareApp.use(authenticateToken as any)
    bareApp.get('/probe', (req: any, res) => res.json({ portalId: req.user?.portalId ?? null }))

    const userId = await createUser()
    const token = signToken(userId, 'prt_someOtherPortal')

    const res = await request(bareApp).get('/probe').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(401)
  })

  it('resolvePortalContext and authenticateToken evaluate the flag exactly ONCE for the same request (cannot disagree)', async () => {
    flagEnabled = true
    await createPortal({ slug: ROOT_PORTAL_SLUG, isRoot: true })
    const userId = await createUser()
    const { portalId } = await createPortal({ slug: 'shared-eval', domain: 'shared-eval.fuzefront.test' })
    const token = signToken(userId, portalId)

    const spy = portalFlagModule.isMultiTenantPortalsEnabled as jest.Mock
    const callsBefore = spy.mock.calls.length

    const res = await request(app)
      .get('/api/v1/portal/current')
      .set('Authorization', `Bearer ${token}`)
      .set('Host', 'shared-eval.fuzefront.test')
    expect(res.status).toBe(200)

    // Exactly two calls for this request: resolvePortalContext (pre-auth) and
    // the /current route handler's own separate feature-gate check. Zero
    // ADDITIONAL calls from authenticateToken — it reused
    // resolvePortalContext's cached decision instead of re-evaluating, which
    // is what guarantees the two middlewares cannot disagree.
    const callsDuringRequest = spy.mock.calls.length - callsBefore
    expect(callsDuringRequest).toBe(2)
  })
})

// Coordinator-flagged bug 4 (SERIOUS) — resolvePortalContext is mounted
// globally, ahead of EVERY route. When the flag was ON but no root portal
// existed yet (a fresh install — ensureRootPortal() found no user to own the
// platform org, see repositories/portalRepository.ts), the middleware 404'd
// EVERY request, including login/signup/health, so nothing could ever
// authenticate to create the first user and seed the root portal. The
// platform was permanently bricked until an operator manually flipped the
// flag back off. Fixed: bootstrap mode passes through untouched.
describe('FF-EPIC-10-S1/S4 bootstrap-mode fix — fail-closed must not mean fail-to-boot', () => {
  // Mirrors src/index.ts's real wiring (resolvePortalContext mounted
  // globally ahead of the real auth + portal routers + a bare health route)
  // rather than the bare `app` above, so this exercises the ACTUAL routes a
  // fresh install needs, not a synthetic probe.
  const bootstrapApp = express()
  bootstrapApp.use(express.json())
  bootstrapApp.use(resolvePortalContext)
  bootstrapApp.get('/health', (_req, res) => res.json({ status: 'ok' }))
  bootstrapApp.use('/api/auth', authRoutes)
  bootstrapApp.use('/api/v1/portal', portalRoutes)

  // Seeded by src/seeds/001_initial_users.ts, always present (tests/setup.ts
  // runs seeds globally) — using the real login route end-to-end rather than
  // hand-rolling a bcrypt hash here.
  const ADMIN_EMAIL = 'admin@fuzefront.dev'
  const ADMIN_PASSWORD = 'admin123'

  it('login remains reachable on a fresh install (flag ON, no root portal seeded)', async () => {
    flagEnabled = true
    // beforeEach already cleared portal_domains/portals — genuine bootstrap.

    const res = await request(bootstrapApp)
      .post('/api/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })

    expect(res.status).toBe(200)
    expect(res.body.token).toBeTruthy()
    expect(res.body.user?.email).toBe(ADMIN_EMAIL)
  })

  it('health remains reachable on a fresh install (flag ON, no root portal seeded)', async () => {
    flagEnabled = true

    const res = await request(bootstrapApp).get('/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'ok' })
  })

  it('/portal/context remains reachable (200, generic bootstrap default — not 404) on a fresh install', async () => {
    flagEnabled = true

    const res = await request(bootstrapApp)
      .get('/api/v1/portal/context')
      .set('Host', 'anything.example.com')

    expect(res.status).toBe(200)
    expect(res.body.isRoot).toBe(true)
    expect(res.body.branding?.name).toBe('FuzeFront')
    expect(res.body.authEntry?.loginUrl).toBe('/login')
  })

  it('once a root portal IS seeded, an unresolved tenant host still falls back to it (bootstrap mode no longer applies)', async () => {
    flagEnabled = true
    const { portalId: rootId } = await createPortal({ slug: ROOT_PORTAL_SLUG, isRoot: true })

    const res = await request(bootstrapApp)
      .get('/api/v1/portal/context')
      .set('Host', 'still-unknown.example.com')

    expect(res.status).toBe(200)
    expect(res.body.id).toBe(rootId)
    expect(res.body.slug).toBe(ROOT_PORTAL_SLUG)
  })
})

// Coordinator-flagged bug 5 — the login-token-minting path
// (resolvePortalBindingForLogin, src/routes/auth.ts) independently
// re-evaluated the flag with {userId}, ignoring req.portalsFlagEnabled
// already stashed by resolvePortalContext for this request — the same
// disagreement class closed for authenticateToken (fix b) but left open here.
describe('FF-EPIC-10-S3 bug 5 fix — login token binding reuses the request-resolved flag decision', () => {
  const loginApp = express()
  loginApp.use(express.json())
  loginApp.use(resolvePortalContext)
  loginApp.use('/api/auth', authRoutes)

  const ADMIN_EMAIL = 'admin@fuzefront.dev'
  const ADMIN_PASSWORD = 'admin123'

  it('mints a portal_id claim consistent with the Host-resolved portal, and never double-evaluates the flag', async () => {
    flagEnabled = true
    await createPortal({ slug: ROOT_PORTAL_SLUG, isRoot: true })
    const { portalId, organizationId } = await createPortal({
      slug: 'login-bind-co',
      domain: 'login-bind-co.fuzefront.test',
    })

    const spy = portalFlagModule.isMultiTenantPortalsEnabled as jest.Mock
    const callsBefore = spy.mock.calls.length

    const res = await request(loginApp)
      .post('/api/auth/login')
      .set('Host', 'login-bind-co.fuzefront.test')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })

    expect(res.status).toBe(200)
    const decoded: any = jwt.decode(res.body.token)
    expect(decoded.portalId).toBe(portalId)

    // Session's active_organization_id must match the SAME resolved portal.
    const session = await db('sessions').where({ id: res.body.sessionId }).first()
    expect(session.active_organization_id).toBe(organizationId)

    // Exactly ONE flag evaluation for this request (resolvePortalContext) —
    // resolvePortalBindingForLogin reused req.portalsFlagEnabled instead of
    // re-evaluating independently with {userId}.
    const callsDuringRequest = spy.mock.calls.length - callsBefore
    expect(callsDuringRequest).toBe(1)
  })

  it('mints no portal_id claim when the flag is OFF — unchanged pre-epic token shape', async () => {
    flagEnabled = false
    await createPortal({ slug: ROOT_PORTAL_SLUG, isRoot: true })

    const res = await request(loginApp)
      .post('/api/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })

    expect(res.status).toBe(200)
    const decoded: any = jwt.decode(res.body.token)
    expect(decoded.portalId).toBeUndefined()
  })
})
