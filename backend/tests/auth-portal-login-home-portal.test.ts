import request from 'supertest'
import express from 'express'
import bcrypt from 'bcryptjs'
import { v4 as uuidv4 } from 'uuid'

jest.mock('../src/config/permit', () => ({
  __esModule: true,
  default: { api: {} },
}))

import * as portalFlagModule from '../src/utils/portalFlag'
import * as identityFlagModule from '../src/utils/identityFlag'
import * as permissionCheckModule from '../src/utils/permit/permission-check'
import { db, initializeDatabaseConnection } from '../src/config/database'
import { resolvePortalContext, _clearPortalCacheForTests } from '../src/middleware/portalContext'
import authRoutes, { drainProvisioningQueue } from '../src/routes/auth'
import { ROOT_PORTAL_ID, ROOT_PORTAL_SLUG, generatePortalId } from '../src/repositories/portalRepository'
import { ROOT_ORG_ID } from '../src/migrations/015_seed_root_platform_organization'

/**
 * FF-EPIC-11-S5 — cross-portal login rejection (home_portal_id) +
 * identity_policy master-admin support access, layered onto the FF-EPIC-10-S3
 * / #424 membership-based rejection in `resolvePortalBindingForLogin`
 * (src/routes/auth.ts).
 *
 * Two INDEPENDENT flags are controlled here, same jest.spyOn-on-the-real-
 * module convention as tests/users-portal-scoping.test.ts (a jest.mock(path,
 * factory) wouldn't be observed by modules that already bound the real
 * export before this file's mocks register):
 *   - `multiTenantPortalsEnabled` (utils/portalFlag.ts) — must be ON for
 *     req.portal to resolve at all; every scenario here needs it ON.
 *   - `portalScopedUsersEnabled` (utils/identityFlag.ts,
 *     fuzefront.identity.portal-scoped-users) — THE flag S5's own rejection
 *     is gated by. Both states are exercised (regression guard).
 */
let multiTenantPortalsEnabled = true
let portalScopedUsersEnabled = false
let platformAdminUserIds = new Set<string>()

beforeAll(() => {
  initializeDatabaseConnection()
  jest.spyOn(portalFlagModule, 'isMultiTenantPortalsEnabled').mockImplementation(
    async () => multiTenantPortalsEnabled
  )
  jest.spyOn(identityFlagModule, 'isPortalScopedUsersEnabled').mockImplementation(
    async () => portalScopedUsersEnabled
  )
  jest.spyOn(permissionCheckModule, 'checkOrganizationPermission').mockImplementation(
    async (userId: string, action: string, orgId: string) =>
      orgId === ROOT_ORG_ID && action === 'manage' && platformAdminUserIds.has(userId)
  )
})

afterEach(() => {
  jest.clearAllMocks()
  jest.spyOn(portalFlagModule, 'isMultiTenantPortalsEnabled').mockImplementation(
    async () => multiTenantPortalsEnabled
  )
  jest.spyOn(identityFlagModule, 'isPortalScopedUsersEnabled').mockImplementation(
    async () => portalScopedUsersEnabled
  )
  jest.spyOn(permissionCheckModule, 'checkOrganizationPermission').mockImplementation(
    async (userId: string, action: string, orgId: string) =>
      orgId === ROOT_ORG_ID && action === 'manage' && platformAdminUserIds.has(userId)
  )
})

afterAll(async () => {
  await drainProvisioningQueue(8_000)
})

const app = express()
app.use(express.json())
app.use(resolvePortalContext)
app.use('/api/auth', authRoutes)

const PASSWORD = 'S5-test-passw0rd!'
let PASSWORD_HASH: string

beforeAll(async () => {
  PASSWORD_HASH = await bcrypt.hash(PASSWORD, 4) // low cost factor — speed, not security, in tests
})

async function createUser(opts: {
  homePortalId: string | null
  email?: string
}): Promise<string> {
  const id = uuidv4()
  await db('users').insert({
    id,
    email: opts.email ?? `s5-${id.slice(0, 8)}@test.local`,
    first_name: 'S5',
    last_name: 'Test',
    password_hash: PASSWORD_HASH,
    roles: JSON.stringify(['user']),
    home_portal_id: opts.homePortalId,
    created_at: new Date(),
    updated_at: new Date(),
  })
  return id
}

async function createPortal(opts: {
  slug: string
  isRoot?: boolean
  domain?: string
  identityPolicy?: Record<string, unknown>
  /**
   * Skips setting `identity_policy` on insert entirely, so the column's own
   * schema DEFAULT (`'{}'`, migration 012) applies — the realistic
   * "missing" identity_policy state (jsonb is NOT NULL, so a true SQL NULL
   * is not a reachable state; an empty-object default is).
   */
  omitIdentityPolicy?: boolean
}): Promise<{ portalId: string; organizationId: string }> {
  const ownerId = await createUser({ homePortalId: null })
  const existingRoot = opts.isRoot ? await db('organizations').where({ id: ROOT_ORG_ID }).first() : null
  const orgId = opts.isRoot ? ROOT_ORG_ID : uuidv4()
  if (!existingRoot) {
    await db('organizations').insert({
      id: orgId,
      name: opts.slug,
      slug: `${opts.slug}-${orgId.slice(0, 6)}`,
      owner_id: ownerId,
      type: opts.isRoot ? 'platform' : 'organization',
      settings: JSON.stringify({}),
      metadata: JSON.stringify({}),
      is_active: true,
      provisioning_state: 'active',
    })
  }
  const portalId = opts.isRoot ? ROOT_PORTAL_ID : generatePortalId()
  const insertRow: Record<string, unknown> = {
    id: portalId,
    organization_id: orgId,
    slug: opts.slug,
    name: opts.slug,
    status: 'active',
    billing_mode: 'free',
    branding: JSON.stringify({ name: opts.slug }),
    is_root: !!opts.isRoot,
  }
  if (!opts.omitIdentityPolicy) {
    insertRow.identity_policy = JSON.stringify(
      opts.identityPolicy ?? { allowPasswordLogin: true, allowSelfSignup: false }
    )
  }
  await db('portals').insert(insertRow)
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

async function addActiveMembership(userId: string, organizationId: string): Promise<void> {
  await db('organization_memberships').insert({
    id: uuidv4(),
    user_id: userId,
    organization_id: organizationId,
    role: 'member',
    status: 'active',
    joined_at: new Date(),
    permissions: JSON.stringify({}),
    metadata: JSON.stringify({}),
  })
}

async function login(email: string, host: string) {
  return request(app)
    .post('/api/auth/login')
    .set('Host', host)
    .send({ email, password: PASSWORD })
}

beforeEach(async () => {
  multiTenantPortalsEnabled = true
  portalScopedUsersEnabled = false
  platformAdminUserIds = new Set()
  _clearPortalCacheForTests()
  await db('sessions').del()
  await db('organization_memberships').where('organization_id', '<>', ROOT_ORG_ID).del()
  await db('portal_domains').del()
  await db('portals').del()
})

describe('FF-EPIC-11-S5 — home_portal_id cross-portal login rejection', () => {
  it('flag ON: a home-portal-B user logging in on portal A is DENIED (403 FORBIDDEN_PORTAL, reason=HOME_PORTAL_MISMATCH), even though they hold an active membership on A\'s org', async () => {
    portalScopedUsersEnabled = true
    await createPortal({ slug: ROOT_PORTAL_SLUG, isRoot: true })
    const { organizationId: orgA } = await createPortal({
      slug: 's5-portal-a',
      domain: 's5-portal-a.fuzefront.test',
    })
    const { portalId: portalB } = await createPortal({ slug: 's5-portal-b' })

    const userId = await createUser({ homePortalId: portalB })
    // Deliberately give them an ACTIVE membership on A's org too — the OLD
    // (pre-S5) membership-only check would have let this login through;
    // home_portal_id is now the authoritative, additional guard.
    await addActiveMembership(userId, orgA)

    const sessionsBefore = await db('sessions').count<{ c: string }[]>('* as c')

    const res = await login(
      (await db('users').where({ id: userId }).first()).email,
      's5-portal-a.fuzefront.test'
    )

    expect(res.status).toBe(403)
    expect(res.body.error).toBe('FORBIDDEN_PORTAL')
    expect(res.body.reason).toBe('HOME_PORTAL_MISMATCH')
    expect(res.body.message).toMatch(/not valid for/i)
    expect(res.body.token).toBeUndefined()

    const sessionsAfter = await db('sessions').count<{ c: string }[]>('* as c')
    expect(Number(sessionsAfter[0].c)).toBe(Number(sessionsBefore[0].c))
  })

  it('flag OFF: the SAME home-portal-B-on-portal-A user (with membership) logs in successfully — unchanged pre-S5 behavior (regression guard)', async () => {
    portalScopedUsersEnabled = false
    await createPortal({ slug: ROOT_PORTAL_SLUG, isRoot: true })
    const { organizationId: orgA } = await createPortal({
      slug: 's5-portal-a-off',
      domain: 's5-portal-a-off.fuzefront.test',
    })
    const { portalId: portalB } = await createPortal({ slug: 's5-portal-b-off' })

    const userId = await createUser({ homePortalId: portalB })
    await addActiveMembership(userId, orgA)

    const res = await login(
      (await db('users').where({ id: userId }).first()).email,
      's5-portal-a-off.fuzefront.test'
    )

    expect(res.status).toBe(200)
    expect(res.body.token).toBeTruthy()
  })

  it('flag ON: a root account (home_portal_id NULL) logging into a tenant portal is DENIED — NO implicit root bypass, even with an active membership', async () => {
    portalScopedUsersEnabled = true
    await createPortal({ slug: ROOT_PORTAL_SLUG, isRoot: true })
    const { organizationId: orgA } = await createPortal({
      slug: 's5-portal-a-root',
      domain: 's5-portal-a-root.fuzefront.test',
    })

    const userId = await createUser({ homePortalId: null })
    await addActiveMembership(userId, orgA)

    const res = await login(
      (await db('users').where({ id: userId }).first()).email,
      's5-portal-a-root.fuzefront.test'
    )

    expect(res.status).toBe(403)
    expect(res.body.error).toBe('FORBIDDEN_PORTAL')
    expect(res.body.reason).toBe('HOME_PORTAL_MISMATCH')
  })

  it('flag ON: a home-matching user (home_portal_id === resolved portal) logs in normally — unaffected', async () => {
    portalScopedUsersEnabled = true
    await createPortal({ slug: ROOT_PORTAL_SLUG, isRoot: true })
    const { portalId: portalA, organizationId: orgA } = await createPortal({
      slug: 's5-portal-a-match',
      domain: 's5-portal-a-match.fuzefront.test',
    })

    const userId = await createUser({ homePortalId: portalA })
    await addActiveMembership(userId, orgA)

    const res = await login(
      (await db('users').where({ id: userId }).first()).email,
      's5-portal-a-match.fuzefront.test'
    )

    expect(res.status).toBe(200)
    const session = await db('sessions').where({ id: res.body.sessionId }).first()
    expect(session.active_organization_id).toBe(orgA)
  })

  it('main-domain (root portal) login is completely unaffected by S5, flag ON', async () => {
    portalScopedUsersEnabled = true
    await createPortal({ slug: ROOT_PORTAL_SLUG, isRoot: true })
    const userId = await createUser({ homePortalId: null })

    const res = await login(
      (await db('users').where({ id: userId }).first()).email,
      'app.fuzefront.test'
    )

    expect(res.status).toBe(200)
    expect(res.body.token).toBeTruthy()
  })
})

describe('FF-EPIC-11-S5 — identity_policy master-admin support access', () => {
  it('flag ON + platform admin + allowPlatformAdminSupportAccess=true -> login PERMITTED and AUDIT-LOGGED, distinguishable from a normal tenant login', async () => {
    portalScopedUsersEnabled = true
    await createPortal({ slug: ROOT_PORTAL_SLUG, isRoot: true })
    const { portalId: portalA, organizationId: orgA } = await createPortal({
      slug: 's5-support-allow',
      domain: 's5-support-allow.fuzefront.test',
      identityPolicy: {
        allowPasswordLogin: true,
        allowSelfSignup: false,
        allowPlatformAdminSupportAccess: true,
      },
    })

    const adminUserId = await createUser({ homePortalId: null })
    platformAdminUserIds.add(adminUserId)

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)
    try {
      const res = await login(
        (await db('users').where({ id: adminUserId }).first()).email,
        's5-support-allow.fuzefront.test'
      )

      expect(res.status).toBe(200)
      expect(res.body.token).toBeTruthy()
      const session = await db('sessions').where({ id: res.body.sessionId }).first()
      expect(session.active_organization_id).toBe(orgA)

      // AUDIT-LOGGED — a distinct, findable log line for this exact support
      // access event, distinguishing it from every other/normal login.
      const auditCall = logSpy.mock.calls.find(
        call => typeof call[0] === 'string' && call[0].includes('SUPPORT-ACCESS')
      )
      expect(auditCall).toBeDefined()
      expect(auditCall!.join(' ')).toContain(adminUserId)
      expect(auditCall!.join(' ')).toContain(portalA)
    } finally {
      logSpy.mockRestore()
    }
  })

  it('flag ON + platform admin + allowPlatformAdminSupportAccess ABSENT -> DENIED (403, reason=SUPPORT_ACCESS_NOT_ALLOWED)', async () => {
    portalScopedUsersEnabled = true
    await createPortal({ slug: ROOT_PORTAL_SLUG, isRoot: true })
    await createPortal({
      slug: 's5-support-absent',
      domain: 's5-support-absent.fuzefront.test',
      identityPolicy: { allowPasswordLogin: true, allowSelfSignup: false },
    })

    const adminUserId = await createUser({ homePortalId: null })
    platformAdminUserIds.add(adminUserId)

    const res = await login(
      (await db('users').where({ id: adminUserId }).first()).email,
      's5-support-absent.fuzefront.test'
    )

    expect(res.status).toBe(403)
    expect(res.body.error).toBe('FORBIDDEN_PORTAL')
    expect(res.body.reason).toBe('SUPPORT_ACCESS_NOT_ALLOWED')
    expect(res.body.token).toBeUndefined()
  })

  it('flag ON + platform admin + allowPlatformAdminSupportAccess=false (explicit OFF) -> DENIED', async () => {
    portalScopedUsersEnabled = true
    await createPortal({ slug: ROOT_PORTAL_SLUG, isRoot: true })
    await createPortal({
      slug: 's5-support-false',
      domain: 's5-support-false.fuzefront.test',
      identityPolicy: {
        allowPasswordLogin: true,
        allowSelfSignup: false,
        allowPlatformAdminSupportAccess: false,
      },
    })

    const adminUserId = await createUser({ homePortalId: null })
    platformAdminUserIds.add(adminUserId)

    const res = await login(
      (await db('users').where({ id: adminUserId }).first()).email,
      's5-support-false.fuzefront.test'
    )

    expect(res.status).toBe(403)
    expect(res.body.reason).toBe('SUPPORT_ACCESS_NOT_ALLOWED')
  })

  it('flag ON + NON-admin user (even with home_portal_id mismatch) never gets the support-access path -> HOME_PORTAL_MISMATCH, not SUPPORT_ACCESS_NOT_ALLOWED', async () => {
    portalScopedUsersEnabled = true
    await createPortal({ slug: ROOT_PORTAL_SLUG, isRoot: true })
    await createPortal({
      slug: 's5-support-nonadmin',
      domain: 's5-support-nonadmin.fuzefront.test',
      identityPolicy: {
        allowPasswordLogin: true,
        allowSelfSignup: false,
        allowPlatformAdminSupportAccess: true,
      },
    })

    const userId = await createUser({ homePortalId: null }) // not added to platformAdminUserIds

    const res = await login(
      (await db('users').where({ id: userId }).first()).email,
      's5-support-nonadmin.fuzefront.test'
    )

    expect(res.status).toBe(403)
    expect(res.body.reason).toBe('HOME_PORTAL_MISMATCH')
  })

  it('FAIL CLOSED: malformed (wrong-shape, non-object) identity_policy on the portal row -> platform admin support access is DENIED, never default-permissive', async () => {
    portalScopedUsersEnabled = true
    await createPortal({ slug: ROOT_PORTAL_SLUG, isRoot: true })
    const { portalId } = await createPortal({
      slug: 's5-support-malformed',
      domain: 's5-support-malformed.fuzefront.test',
    })
    // `identity_policy` is a NOT NULL jsonb column (migration 012) — Postgres
    // itself rejects invalid JSON *syntax* at write time, so the reachable
    // "malformed" state is a validly-*encoded* but wrong-*shaped* value (here,
    // a JSON array instead of an object) rather than a syntax error or NULL.
    // getPortalIdentityPolicy/parseJsonColumnWithDefaults must still never
    // read `allowPlatformAdminSupportAccess` as true out of this.
    await db('portals')
      .where({ id: portalId })
      .update({ identity_policy: db.raw("'[]'::jsonb") })

    const adminUserId = await createUser({ homePortalId: null })
    platformAdminUserIds.add(adminUserId)

    const res = await login(
      (await db('users').where({ id: adminUserId }).first()).email,
      's5-support-malformed.fuzefront.test'
    )

    expect(res.status).toBe(403)
    expect(res.body.reason).toBe('SUPPORT_ACCESS_NOT_ALLOWED')
    expect(res.body.token).toBeUndefined()
  })

  it('FAIL CLOSED: MISSING identity_policy (column left at its schema default, {}) on the portal row -> platform admin support access is DENIED', async () => {
    portalScopedUsersEnabled = true
    await createPortal({ slug: ROOT_PORTAL_SLUG, isRoot: true })
    await createPortal({
      slug: 's5-support-missing',
      domain: 's5-support-missing.fuzefront.test',
      omitIdentityPolicy: true,
    })

    const adminUserId = await createUser({ homePortalId: null })
    platformAdminUserIds.add(adminUserId)

    const res = await login(
      (await db('users').where({ id: adminUserId }).first()).email,
      's5-support-missing.fuzefront.test'
    )

    expect(res.status).toBe(403)
    expect(res.body.reason).toBe('SUPPORT_ACCESS_NOT_ALLOWED')
  })
})
