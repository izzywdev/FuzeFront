/**
 * POST /api/organizations/:id/session-token  +  services/orgSessionToken.ts
 *
 * The exchange that gives org-scoped services (selection-list-service) a
 * VERIFIED `orgId` claim. The invariants under test:
 *   - the org in the minted token is the output of an ACTIVE-membership check;
 *   - only a plain, live session token can be exchanged (no chaining, no
 *     revoked/expired session, no foreign-tenant token, no alg confusion);
 *   - the minted token is short-lived, never outlives its session, and carries
 *     `kind: 'fuze-org-session'`, `tid` and `sessionId` unchanged;
 *   - a non-member and a nonexistent org get the same answer (no oracle).
 *
 * DB, auth middleware and tenant context are mocked; no Postgres required.
 */
import crypto from 'crypto'
import express from 'express'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import { fromUuid } from '@izzywdev/fuzefront-identity'

jest.mock('../src/config/database', () => ({
  db: Object.assign(jest.fn(), { transaction: jest.fn() }),
}))
jest.mock('../src/services/eventPublisher', () => ({
  defaultEventPublisher: {
    publishNotifyEmailRequested: jest.fn().mockResolvedValue(undefined),
    publishIdentityUserCreated: jest.fn().mockResolvedValue(undefined),
  },
}))
jest.mock('../src/middleware/auth', () => ({
  // The real middleware verifies the signature + session row; here it only
  // needs to hand the route a req.user (the token is re-verified by the service).
  authenticateToken: (req: any, _res: any, next: any) => {
    req.user = { id: '0b3a2f64-7d1e-4c1a-9f0e-2b5f6a7c8d90', email: 'u@example.com', roles: ['user'] }
    next()
  },
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}))
jest.mock('../src/middleware/permissions', () => ({
  PermissionMiddleware: {
    canReadOrganization: (_req: any, _res: any, next: any) => next(),
    canUpdateOrganization: (_req: any, _res: any, next: any) => next(),
    canDeleteOrganization: (_req: any, _res: any, next: any) => next(),
    canInviteUsers: (_req: any, _res: any, next: any) => next(),
    canViewMembers: (_req: any, _res: any, next: any) => next(),
  },
  requireOwnership: () => (_req: any, _res: any, next: any) => next(),
}))
jest.mock('../src/services/organizationProvisioning', () => ({
  reconcileOrganizationProvisioning: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('../src/utils/permit/role-assignment', () => ({
  assignOrganizationRole: jest.fn(),
  assignRoleInPermit: jest.fn(),
  unassignRoleInPermit: jest.fn(),
  getUserRoleAssignments: jest.fn(),
  getTenantRoleAssignments: jest.fn(),
  userHasRole: jest.fn(),
  updateOrganizationRole: jest.fn(),
}))
jest.mock('../src/utils/employeeFlag', () => ({
  EMPLOYEE_CONSOLE_FLAG: 'x',
  isEmployeeConsoleEnabled: jest.fn().mockResolvedValue(false),
}))
jest.mock('../src/utils/memberDirectoryFlag', () => ({
  MEMBER_DIRECTORY_FLAG: 'x',
  isMemberDirectoryEnabled: jest.fn().mockResolvedValue(false),
}))
jest.mock('../src/middleware/tenant-context', () => ({
  sessionTenantId: () => 'fuzefront',
  assertTenantMatches: (_req: any, tid: string | undefined) =>
    !tid || tid === 'fuzefront' ? { ok: true } : { ok: false, reason: 'tenant mismatch' },
}))

import { db } from '../src/config/database'
import organizationsRouter from '../src/routes/organizations'
import {
  mintOrgSessionToken,
  normaliseOrganizationId,
  ORG_SESSION_KIND,
  ORG_SESSION_MAX_TTL_SECONDS,
} from '../src/services/orgSessionToken'

// The host's identity tenant (the mocked tenant-context above accepts only this `tid`).
const TENANT_ID = 'fuzefront'
const dbMock = db as unknown as jest.Mock

// Random per run: nothing depends on the value, and no literal reads as a secret.
const SECRET = crypto.randomBytes(32).toString('hex')
const USER_ID = '0b3a2f64-7d1e-4c1a-9f0e-2b5f6a7c8d90'
const ORG_UUID = '5c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f'
const SESSION_ID = '11111111-2222-4333-8444-555555555555'

interface Fixture {
  session?: { expires_at: Date | null } | undefined
  membership?: { org_is_active: boolean } | undefined
}

/** db(table) -> chain whose terminal `.first()` resolves the fixture row. */
function installDb(f: Fixture): { calls: Record<string, any[][]> } {
  const calls: Record<string, any[][]> = {}
  dbMock.mockImplementation((table: string) => {
    const row = table === 'sessions' ? f.session : f.membership
    const chain: any = {}
    for (const m of ['where', 'join']) {
      chain[m] = jest.fn((...args: any[]) => {
        ;(calls[`${table}.${m}`] ||= []).push(args)
        return chain
      })
    }
    chain.first = jest.fn().mockResolvedValue(row)
    return chain
  })
  return { calls }
}

function sessionToken(claims: Record<string, unknown> = {}, opts: jwt.SignOptions = {}): string {
  return jwt.sign(
    { userId: USER_ID, sessionId: SESSION_ID, tid: TENANT_ID, ...claims },
    SECRET,
    { expiresIn: '24h', ...opts }
  )
}

const FUTURE = () => new Date(Date.now() + 24 * 3600 * 1000)

function app() {
  const a = express()
  a.use(express.json())
  a.use('/api/organizations', organizationsRouter)
  return a
}

let savedSecret: string | undefined
beforeEach(() => {
  savedSecret = process.env.JWT_SECRET
  process.env.JWT_SECRET = SECRET
  dbMock.mockReset()
})
afterEach(() => {
  if (savedSecret === undefined) delete process.env.JWT_SECRET
  else process.env.JWT_SECRET = savedSecret
})

describe('POST /api/organizations/:id/session-token', () => {
  it('mints an org-scoped token for an active member', async () => {
    installDb({ session: { expires_at: FUTURE() }, membership: { org_is_active: true } })
    const t = sessionToken()
    const res = await request(app())
      .post(`/api/organizations/${ORG_UUID}/session-token`)
      .set('Authorization', `Bearer ${t}`)
    expect(res.status).toBe(200)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.body.tokenType).toBe('Bearer')
    expect(res.body.organizationId).toBe(ORG_UUID)
    expect(res.body.expiresIn).toBe(ORG_SESSION_MAX_TTL_SECONDS)

    const claims = jwt.verify(res.body.token, SECRET, { algorithms: ['HS256'] }) as any
    expect(claims).toMatchObject({
      userId: USER_ID,
      sessionId: SESSION_ID,
      tid: TENANT_ID,
      orgId: ORG_UUID,
      kind: ORG_SESSION_KIND,
    })
    expect(claims.exp - claims.iat).toBe(ORG_SESSION_MAX_TTL_SECONDS)
  })

  it('accepts the org_ TypeID form and binds the token to the bare UUID', async () => {
    installDb({ session: { expires_at: FUTURE() }, membership: { org_is_active: true } })
    const typeId = fromUuid('organization', ORG_UUID)
    const res = await request(app())
      .post(`/api/organizations/${typeId}/session-token`)
      .set('Authorization', `Bearer ${sessionToken()}`)
    expect(res.status).toBe(200)
    expect(res.body.organizationId).toBe(ORG_UUID)
    expect((jwt.decode(res.body.token) as any).orgId).toBe(ORG_UUID)
  })

  it('queries membership for the CALLER (req.user), the requested org, status active', async () => {
    const { calls } = installDb({ session: { expires_at: FUTURE() }, membership: { org_is_active: true } })
    await request(app())
      .post(`/api/organizations/${ORG_UUID}/session-token`)
      .set('Authorization', `Bearer ${sessionToken()}`)
    expect(calls['organization_memberships as m.where'][0][0]).toEqual({
      'm.user_id': USER_ID,
      'm.organization_id': ORG_UUID,
      'm.status': 'active',
    })
  })

  it('403 for a non-member, and the body does not distinguish nonexistent from forbidden', async () => {
    installDb({ session: { expires_at: FUTURE() }, membership: undefined })
    const res = await request(app())
      .post(`/api/organizations/${ORG_UUID}/session-token`)
      .set('Authorization', `Bearer ${sessionToken()}`)
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('NOT_A_MEMBER')
    expect(res.body.token).toBeUndefined()
  })

  it('403 when the org is deactivated even if a membership row is active', async () => {
    installDb({ session: { expires_at: FUTURE() }, membership: { org_is_active: false } })
    const res = await request(app())
      .post(`/api/organizations/${ORG_UUID}/session-token`)
      .set('Authorization', `Bearer ${sessionToken()}`)
    expect(res.status).toBe(403)
  })

  it('400 on a malformed org id, before any DB access', async () => {
    installDb({})
    const res = await request(app())
      .post('/api/organizations/not-an-org/session-token')
      .set('Authorization', `Bearer ${sessionToken()}`)
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('INVALID_ORGANIZATION_ID')
    expect(dbMock).not.toHaveBeenCalled()
  })

  it('400 on an id of the wrong entity type', async () => {
    installDb({})
    const userTypeId = fromUuid('user', ORG_UUID)
    const res = await request(app())
      .post(`/api/organizations/${userTypeId}/session-token`)
      .set('Authorization', `Bearer ${sessionToken()}`)
    expect(res.status).toBe(400)
  })
})

describe('session-token exchange — refusals (fail closed)', () => {
  const base = {
    userId: USER_ID,
    organizationId: ORG_UUID,
    tenantAccepts: (tid: string | undefined) => !tid || tid === TENANT_ID,
    tenantId: TENANT_ID,
  }

  it('refuses a token that already carries a kind (no chaining org -> org)', async () => {
    installDb({ session: { expires_at: FUTURE() }, membership: { org_is_active: true } })
    await expect(
      mintOrgSessionToken({ ...base, sessionToken: sessionToken({ kind: ORG_SESSION_KIND, orgId: ORG_UUID }) })
    ).rejects.toMatchObject({ status: 401 })
    await expect(
      mintOrgSessionToken({ ...base, sessionToken: sessionToken({ kind: 'fuze-delegation' }) })
    ).rejects.toMatchObject({ status: 401 })
  })

  it('refuses a token whose userId is not the authenticated user', async () => {
    installDb({ session: { expires_at: FUTURE() }, membership: { org_is_active: true } })
    await expect(
      mintOrgSessionToken({ ...base, sessionToken: sessionToken({ userId: 'someone-else' }) })
    ).rejects.toMatchObject({ status: 401 })
  })

  it('refuses a pre-rollout token with no sessionId (revocation unprovable)', async () => {
    installDb({ session: { expires_at: FUTURE() }, membership: { org_is_active: true } })
    const t = jwt.sign({ userId: USER_ID, tid: TENANT_ID }, SECRET, { expiresIn: '1h' })
    await expect(mintOrgSessionToken({ ...base, sessionToken: t })).rejects.toMatchObject({ status: 401 })
  })

  it('refuses a revoked session (no sessions row)', async () => {
    installDb({ session: undefined, membership: { org_is_active: true } })
    await expect(mintOrgSessionToken({ ...base, sessionToken: sessionToken() })).rejects.toMatchObject({
      status: 401,
      message: 'Session revoked',
    })
  })

  it('refuses an already-expired session row', async () => {
    installDb({ session: { expires_at: new Date(Date.now() - 1000) }, membership: { org_is_active: true } })
    await expect(mintOrgSessionToken({ ...base, sessionToken: sessionToken() })).rejects.toMatchObject({
      status: 401,
    })
  })

  it('refuses a token from another identity tenant', async () => {
    installDb({ session: { expires_at: FUTURE() }, membership: { org_is_active: true } })
    await expect(
      mintOrgSessionToken({ ...base, sessionToken: sessionToken({ tid: 'other-directory' }) })
    ).rejects.toMatchObject({ status: 401 })
  })

  it('refuses a token signed with a different secret', async () => {
    installDb({ session: { expires_at: FUTURE() }, membership: { org_is_active: true } })
    const t = jwt.sign({ userId: USER_ID, sessionId: SESSION_ID }, crypto.randomBytes(32).toString('hex'))
    await expect(mintOrgSessionToken({ ...base, sessionToken: t })).rejects.toMatchObject({ status: 401 })
  })

  it('refuses an alg=none token (algorithm is pinned to HS256)', async () => {
    installDb({ session: { expires_at: FUTURE() }, membership: { org_is_active: true } })
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
    const forged = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ userId: USER_ID, sessionId: SESSION_ID })}.`
    await expect(mintOrgSessionToken({ ...base, sessionToken: forged })).rejects.toMatchObject({ status: 401 })
  })

  it('refuses a non-HS256 HMAC token (HS512) signed with the right secret', async () => {
    installDb({ session: { expires_at: FUTURE() }, membership: { org_is_active: true } })
    const t = jwt.sign({ userId: USER_ID, sessionId: SESSION_ID }, SECRET, { algorithm: 'HS512' })
    await expect(mintOrgSessionToken({ ...base, sessionToken: t })).rejects.toMatchObject({ status: 401 })
  })

  it('never mints for an org the caller is not a member of, whatever the token says', async () => {
    // A token that already names an orgId is a kind-less forgery attempt only
    // if signed by us; even then the exchange ignores it and checks membership.
    installDb({ session: { expires_at: FUTURE() }, membership: undefined })
    await expect(
      mintOrgSessionToken({ ...base, sessionToken: sessionToken({ orgId: ORG_UUID }) })
    ).rejects.toMatchObject({ status: 403 })
  })
})

describe('session-token exchange — lifetime', () => {
  const base = {
    userId: USER_ID,
    organizationId: ORG_UUID,
    tenantAccepts: () => true,
    tenantId: TENANT_ID,
  }

  it('caps the TTL at 15 minutes', async () => {
    installDb({ session: { expires_at: FUTURE() }, membership: { org_is_active: true } })
    const r = await mintOrgSessionToken({ ...base, sessionToken: sessionToken() })
    expect(r.expiresIn).toBe(900)
  })

  it('never outlives the session: TTL is the session time left when that is shorter', async () => {
    const now = Date.now()
    installDb({ session: { expires_at: new Date(now + 120_000) }, membership: { org_is_active: true } })
    const r = await mintOrgSessionToken({ ...base, sessionToken: sessionToken(), now: () => now })
    expect(r.expiresIn).toBe(120)
    const claims = jwt.decode(r.token) as any
    expect(claims.exp - claims.iat).toBe(120)
  })
})

describe('normaliseOrganizationId', () => {
  it('lower-cases a bare UUID, converts an org_ TypeID, and rejects everything else', () => {
    expect(normaliseOrganizationId(ORG_UUID.toUpperCase())).toBe(ORG_UUID)
    expect(normaliseOrganizationId(fromUuid('organization', ORG_UUID))).toBe(ORG_UUID)
    for (const bad of [undefined, null, 42, '', 'org_', "x' OR 1=1 --", fromUuid('user', ORG_UUID)]) {
      expect(() => normaliseOrganizationId(bad)).toThrow(/Invalid organization id/)
    }
  })
})
