import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'
import { v4 as uuidv4 } from 'uuid'

jest.mock('../src/config/permit', () => ({
  __esModule: true,
  default: { api: {} },
}))

import * as portalFlagModule from '../src/utils/portalFlag'
import * as identityFlagModule from '../src/utils/identityFlag'
import { db, initializeDatabaseConnection } from '../src/config/database'
import {
  resolvePortalContext,
  createResolvePortalContext,
  _clearPortalCacheForTests,
} from '../src/middleware/portalContext'
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
// OpenFeature test provider (no Unleash/@fuzeone/feature-flags package is
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
  // FF-EPIC-11-S5 — this file predates the home_portal_id-based login
  // rejection and isn't testing it (tests/auth-portal-login-home-portal.test.ts
  // owns that). Pin the identity flag OFF so this file's ADMIN_USER_ID logins
  // keep exercising ONLY the membership-based check they were written
  // against; without this, isPortalScopedUsersEnabled's own S6 AC4
  // fail-closed-to-ENFORCED default (utils/identityFlag.ts — no
  // @fuzeone/feature-flags package resolvable in this sandbox) would
  // silently turn S5 ON here too and reject logins this file asserts succeed.
  jest.spyOn(identityFlagModule, 'isPortalScopedUsersEnabled').mockResolvedValue(false)
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
  it('200 returns the caller\'s own portal resolved from the token portal_id claim', async () => {
    // @fuzequality api getCurrentPortal
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

  // Root cause B fix (gate-code-review round 4) — a legacy token (no
  // portal_id claim) carries NO verifiable portal binding. The OLD code
  // bound it to `resolvedPortal?.id ?? root?.id` — i.e. WHATEVER Host the
  // request happened to resolve to, UNVERIFIED. A pre-epic session
  // presented on a tenant's Host was silently bound to that tenant portal:
  // fail-open cross-portal, exactly what AC3 exists to stop, just reached
  // via the one branch (no claim to compare against) AC3 doesn't cover.
  // POLICY (flagged to the coordinator/owner for sign-off): a legacy token
  // is valid ONLY on the root portal — presented on a Host that resolves to
  // a non-root TENANT portal, it must be rejected outright.
  it('POLICY — a legacy token (no portal_id claim) is REJECTED on a Host that resolves to a non-root tenant portal', async () => {
    flagEnabled = true
    await createPortal({ slug: ROOT_PORTAL_SLUG, isRoot: true })
    await createPortal({ slug: 'tenant-b', domain: 'tenant-b.fuzefront.test' })
    const userId = await createUser()

    const token = signToken(userId) // no portalId claim — a pre-epic session
    const res = await request(app)
      .get('/api/v1/portal/current')
      .set('Authorization', `Bearer ${token}`)
      .set('Host', 'tenant-b.fuzefront.test') // resolves to a NON-root tenant portal

    // Must NEVER silently bind to tenant-b — reject and require re-auth.
    expect(res.status).toBe(401)
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

  // Root cause A fix (gate-code-review round 4) — /current used to
  // independently re-evaluate the flag with {userId} (a SEPARATE bug from
  // the authenticateToken one this describe block was originally written
  // for), so this assertion is updated from "exactly 2" (resolvePortalContext
  // + /current's own check, with authenticateToken already fixed to reuse
  // the cache) to "exactly 1": EVERY consumer downstream of
  // resolvePortalContext — authenticateToken AND /current — now reuses the
  // one shared per-request decision via getRequestPortalsEnabled
  // (utils/portalFlag.ts). Covers context + auth + /current in one request.
  it('resolvePortalContext, authenticateToken, and /current evaluate the flag exactly ONCE for the same request (cannot disagree)', async () => {
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

    // Exactly ONE call for this request — resolvePortalContext's (pre-auth).
    // Zero additional calls from authenticateToken OR the /current route
    // handler; both reused the cached decision, which is what guarantees
    // none of the three can disagree.
    const callsDuringRequest = spy.mock.calls.length - callsBefore
    expect(callsDuringRequest).toBe(1)
  })

  // The fourth consumer — the login-mint path (routes/auth.ts) — covered
  // separately in the "bug 5 fix" describe block below, which already
  // asserts exactly one evaluation for a login request (context + login).
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
  // Fixed id from src/seeds/001_initial_users.ts — used to insert a real
  // organization_memberships row for the cross-tenant-login authz tests.
  const ADMIN_USER_ID = '8dbf6a1b-c0a1-462a-9bf5-934c8c7339c3'

  it('a genuine ACTIVE member logging in on their tenant Host succeeds and is bound (mints a consistent portal_id claim, never double-evaluates the flag)', async () => {
    flagEnabled = true
    await createPortal({ slug: ROOT_PORTAL_SLUG, isRoot: true })
    const { portalId, organizationId } = await createPortal({
      slug: 'login-bind-co',
      domain: 'login-bind-co.fuzefront.test',
    })
    // Cross-tenant login authz fix — membership is now REQUIRED for a
    // tenant-host login to succeed; make ADMIN a genuine active member of
    // this portal's org.
    await db('organization_memberships').insert({
      id: uuidv4(),
      user_id: ADMIN_USER_ID,
      organization_id: organizationId,
      role: 'member',
      status: 'active',
      joined_at: new Date(),
      permissions: JSON.stringify({}),
      metadata: JSON.stringify({}),
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

  // Cross-tenant login authorization fix (round 8) — login previously only
  // verified GLOBAL credentials; ANY valid FuzeFront account logging in on a
  // tenant Host got its session/token silently bound to that tenant's org,
  // regardless of actual membership. Same silent-rebind class already closed
  // for the root portal, now closed for tenant portals too: fail CLOSED.
  it('a NON-member logging in on a tenant Host is rejected (403 FORBIDDEN_PORTAL) — no session/token is created', async () => {
    flagEnabled = true
    await createPortal({ slug: ROOT_PORTAL_SLUG, isRoot: true })
    await createPortal({
      slug: 'members-only-co',
      domain: 'members-only-co.fuzefront.test',
    })
    // Deliberately NO organization_memberships row for ADMIN on this org.

    const sessionCountBefore = await db('sessions').count<{ c: string }[]>('* as c')

    const res = await request(loginApp)
      .post('/api/auth/login')
      .set('Host', 'members-only-co.fuzefront.test')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })

    expect(res.status).toBe(403)
    expect(res.body.error).toBe('FORBIDDEN_PORTAL')
    expect(res.body.token).toBeUndefined()

    // No session row was created for this rejected login.
    const sessionCountAfter = await db('sessions').count<{ c: string }[]>('* as c')
    expect(Number(sessionCountAfter[0].c)).toBe(Number(sessionCountBefore[0].c))
  })

  it('flag OFF — a non-member logging in on a tenant Host still succeeds unchanged (membership check is flag-gated too)', async () => {
    flagEnabled = false
    await createPortal({ slug: ROOT_PORTAL_SLUG, isRoot: true })
    await createPortal({
      slug: 'members-only-off',
      domain: 'members-only-off.fuzefront.test',
    })
    // No membership row — would be rejected if the flag were ON.

    const res = await request(loginApp)
      .post('/api/auth/login')
      .set('Host', 'members-only-off.fuzefront.test')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })

    // Flag OFF -> resolvePortalBindingForLogin short-circuits to {ok:true}
    // before ever reaching req.portal/the membership check — pre-epic
    // behavior, unchanged.
    expect(res.status).toBe(200)
    expect(res.body.token).toBeTruthy()
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

  // Coordinator-flagged extra finding (round 4) — a regular user logging in
  // on the MAIN app host (not a tenant subdomain) resolves to the ROOT/
  // platform portal via resolvePortalContext's fallback. The OLD code force-
  // set sessions.active_organization_id to that root portal's org (the
  // platform org) on EVERY main-domain login once the flag was ON — even
  // though the logging-in user is almost certainly NOT a member of the
  // platform org. That silently rebinds the session's active org, violating
  // "flag-off/main-domain behavior is byte-for-byte unchanged" (latent until
  // the flag is enabled). Fixed: active_organization_id is only set from a
  // genuine TENANT (non-root) portal; a root-portal/main-domain login must
  // get the IDENTICAL session (active_organization_id null, matching
  // pre-epic behavior) whether the flag is on or off.
  it('main-domain login (root portal) does NOT rebind active_organization_id to the platform org, flag ON', async () => {
    flagEnabled = true
    await createPortal({ slug: ROOT_PORTAL_SLUG, isRoot: true })
    // ADMIN_EMAIL (the seeded user) is NOT a member of the platform org —
    // asserting the session's active org stays exactly what pre-epic login
    // already leaves it as (null — sessions.insert() never set it).

    const res = await request(loginApp)
      .post('/api/auth/login')
      .set('Host', 'app.fuzefront.test') // main app host, no tenant subdomain -> resolves to root
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })

    expect(res.status).toBe(200)
    // The token IS still bound to the root portal (a legitimate binding)...
    const decoded: any = jwt.decode(res.body.token)
    expect(decoded.portalId).toBe(ROOT_PORTAL_ID)
    // ...but the session's active org must be UNCHANGED from pre-epic
    // behavior — never force-set to the platform org.
    const session = await db('sessions').where({ id: res.body.sessionId }).first()
    expect(session.active_organization_id).toBeNull()
  })

  it('flag ON + no root portal seeded yet (bootstrap) also never rebinds active_organization_id', async () => {
    flagEnabled = true
    // No portals at all — resolvePortalContext bootstrap-passes-through.

    const res = await request(loginApp)
      .post('/api/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })

    expect(res.status).toBe(200)
    const session = await db('sessions').where({ id: res.body.sessionId }).first()
    expect(session.active_organization_id).toBeNull()
  })
})

// Round-8 gate-code-review fix — a DEGRADED resolution (transient host-lookup
// error) used to be indistinguishable from BOOTSTRAP (both left req.portal
// undefined && req.portalsFlagEnabled true), which caused two downstream
// bugs: (A) authenticateToken 401'd every portal-bound session — a mass
// logout on a brief DB hiccup — and (B) GET /context silently served generic
// bootstrap branding for a host that might map to a SUSPENDED portal, moving
// the suspension leak from root-branding to generic-branding instead of
// fixing it. The fix: resolvePortalContext now stamps `req.portalResolutionDegraded`
// ONLY on the degraded outcome, and both consumers below check it BEFORE
// falling back to their bootstrap/mismatch-only logic.
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

describe('GET /api/v1/portal/context — degraded vs bootstrap must not be conflated (round-8 fix)', () => {
  it('a degraded host-lookup error returns 503 PORTAL_RESOLUTION_UNAVAILABLE — NOT 200 bootstrap/generic branding', async () => {
    await createPortal({ slug: ROOT_PORTAL_SLUG, isRoot: true })
    const { portalId } = await createPortal({
      slug: 'suspended-degraded',
      domain: 'suspended-degraded.fuzefront.test',
    })
    await db('portals').where({ id: portalId }).update({ status: 'suspended' })

    // Warm the "root" cache entry with a healthy lookup first — mirrors the
    // real failure mode: root was already resolved/cached from an earlier,
    // unrelated request, and it is a perfectly healthy, active portal.
    const warmMiddleware = createResolvePortalContext({ db, isEnabled: async () => true })
    const warmApp = express()
    warmApp.use(warmMiddleware)
    warmApp.use('/api/v1/portal', portalRoutes)
    const warm = await request(warmApp)
      .get('/api/v1/portal/context')
      .set('Host', 'unrelated-warm-host.example.com')
    expect(warm.status).toBe(200)
    expect(warm.body.isRoot).toBe(true)

    // Now the Host maps to the SUSPENDED portal, but its domain-lookup query
    // throws (a transient DB blip) while root is still cached and active.
    const degradedMiddleware = createResolvePortalContext({
      db: domainLookupThrowingDb(),
      isEnabled: async () => true,
    })
    const degradedApp = express()
    degradedApp.use(degradedMiddleware)
    degradedApp.use('/api/v1/portal', portalRoutes)

    const res = await request(degradedApp)
      .get('/api/v1/portal/context')
      .set('Host', 'suspended-degraded.fuzefront.test')

    expect(res.status).toBe(503)
    expect(res.body.error).toBe('PORTAL_RESOLUTION_UNAVAILABLE')
  })

  it('genuine bootstrap (no root portal seeded, no error) still returns 200 bootstrapPortalContext — unaffected by the degraded fix', async () => {
    flagEnabled = true
    // portals table is empty (beforeEach cleared it) — genuine bootstrap, not
    // a lookup error. `app` (top-level) already wires the real
    // resolvePortalContext + portalRoutes and respects the `flagEnabled` spy.

    const res = await request(app)
      .get('/api/v1/portal/context')
      .set('Host', 'nothing-bootstrap.example.com')

    expect(res.status).toBe(200)
    expect(res.body.isRoot).toBe(true)
    expect(res.body.branding?.name).toBe('FuzeFront')
  })
})

describe('authenticateToken — degraded portal resolution returns 503, not 401 (round-8 fix)', () => {
  it('a portal-bound token on a DEGRADED request returns 503 (retryable) — must not mass-logout on a DB hiccup', async () => {
    flagEnabled = true
    await createPortal({ slug: ROOT_PORTAL_SLUG, isRoot: true })
    const { portalId } = await createPortal({
      slug: 'degraded-co',
      domain: 'degraded-co.fuzefront.test',
    })
    const userId = await createUser()
    const token = signToken(userId, portalId)

    // Warm the root cache with a healthy lookup first (production-mirroring,
    // same as the /context degraded test above).
    const warmMiddleware = createResolvePortalContext({ db, isEnabled: async () => true })
    const warmApp = express()
    warmApp.use(warmMiddleware)
    warmApp.get('/probe', (_req, res) => res.json({ ok: true }))
    await request(warmApp).get('/probe').set('Host', 'unrelated-warm-host-2.example.com')

    const degradedMiddleware = createResolvePortalContext({
      db: domainLookupThrowingDb(),
      isEnabled: async () => true,
    })
    const degradedApp = express()
    degradedApp.use(degradedMiddleware)
    degradedApp.use(authenticateToken as any)
    degradedApp.get('/probe', (req: any, res) => res.json({ portalId: req.user?.portalId ?? null }))

    const res = await request(degradedApp)
      .get('/probe')
      .set('Authorization', `Bearer ${token}`)
      .set('Host', 'degraded-co.fuzefront.test')

    expect(res.status).toBe(503)
    expect(res.body.error).toBe('PORTAL_RESOLUTION_UNAVAILABLE')
  })

  it('a genuine cross-portal id mismatch (resolvedPortal present but different) still returns 401', async () => {
    flagEnabled = true
    await createPortal({ slug: ROOT_PORTAL_SLUG, isRoot: true })
    const { portalId: portalA } = await createPortal({
      slug: 'mismatch-a',
      domain: 'mismatch-a.fuzefront.test',
    })
    await createPortal({ slug: 'mismatch-b', domain: 'mismatch-b.fuzefront.test' })
    const userId = await createUser()
    const token = signToken(userId, portalA)

    const testApp = express()
    testApp.use(resolvePortalContext)
    testApp.use(authenticateToken as any)
    testApp.get('/probe', (req: any, res) => res.json({ portalId: req.user?.portalId ?? null }))

    const res = await request(testApp)
      .get('/probe')
      .set('Authorization', `Bearer ${token}`)
      .set('Host', 'mismatch-b.fuzefront.test')

    expect(res.status).toBe(401)
  })

  it('a legacy no-claim token is unaffected — still resolves via the existing fallback logic, not the new degraded check', async () => {
    flagEnabled = true
    const rootOrg = await createPortal({ slug: ROOT_PORTAL_SLUG, isRoot: true })
    const userId = await createUser()
    const token = signToken(userId) // no portalId claim

    const testApp = express()
    testApp.use(resolvePortalContext)
    testApp.use(authenticateToken as any)
    testApp.get('/probe', (req: any, res) => res.json({ portalId: req.user?.portalId ?? null }))

    const res = await request(testApp)
      .get('/probe')
      .set('Authorization', `Bearer ${token}`)
      .set('Host', 'unresolvable-legacy-host.example.com') // falls back to root

    expect(res.status).toBe(200)
    expect(res.body.portalId).toBe(rootOrg.portalId)
  })

  it('round-9 fix — a LEGACY no-claim token on a DEGRADED tenant-host request returns 503, NOT silently bound to root', async () => {
    // The round-8 fix guarded ONLY the portal-bound branch, so a legacy
    // (no portal_id claim) token presented on a tenant Host during a transient
    // domain-lookup error skipped the degraded check, fell to the legacy
    // branch's getRootPortal() fall-through, and was silently BOUND TO ROOT —
    // accepting a legacy token on a tenant Host and bypassing the AC3 non-root
    // rejection. Round-9 hoists the degraded guard above the claim/legacy
    // split so BOTH branches fail closed with a transient 503.
    flagEnabled = true
    await createPortal({ slug: ROOT_PORTAL_SLUG, isRoot: true })
    await createPortal({ slug: 'legacy-degraded-co', domain: 'legacy-degraded-co.fuzefront.test' })
    const userId = await createUser()
    const token = signToken(userId) // legacy: no portalId claim

    // Warm the root cache with a healthy lookup first, so the pre-fix legacy
    // fall-through would have a cached, healthy root to (wrongly) bind to.
    const warmMiddleware = createResolvePortalContext({ db, isEnabled: async () => true })
    const warmApp = express()
    warmApp.use(warmMiddleware)
    warmApp.get('/probe', (_req, res) => res.json({ ok: true }))
    await request(warmApp).get('/probe').set('Host', 'unrelated-warm-host-3.example.com')

    const degradedMiddleware = createResolvePortalContext({
      db: domainLookupThrowingDb(),
      isEnabled: async () => true,
    })
    const degradedApp = express()
    degradedApp.use(degradedMiddleware)
    degradedApp.use(authenticateToken as any)
    degradedApp.get('/probe', (req: any, res) => res.json({ portalId: req.user?.portalId ?? null }))

    const res = await request(degradedApp)
      .get('/probe')
      .set('Authorization', `Bearer ${token}`)
      .set('Host', 'legacy-degraded-co.fuzefront.test')

    // Fail closed: transient 503, never a silent bind-to-root (status 200 with
    // portalId === the root portal — the round-9 fail-open).
    expect(res.status).toBe(503)
    expect(res.body.error).toBe('PORTAL_RESOLUTION_UNAVAILABLE')
  })
})
