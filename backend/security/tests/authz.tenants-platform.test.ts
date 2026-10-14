/**
 * `GET /tenants` and `POST /tenants` on the Security API (review C-1 residual).
 *
 * Both used to be open to ANY authenticated caller: any account could create a
 * tenant (a new authorization scope) and enumerate every tenant on the platform.
 * The rule now (services/authz-gate.ts `authorizePlatformAdmin`):
 *
 *   POST /tenants      platform act: `Organization:manage` on the platform ROOT
 *                      tenant (FuzeFront staff), or a machine caller with
 *                      `authz:admin`. Everyone else: 403, before the body is read.
 *   GET  /tenants      "tenants visible to the caller": a platform admin / an
 *                      `authz:admin` machine sees all; anyone else sees only the
 *                      tenants they hold a role in. A provider failure while
 *                      deciding is a 502 (never silently widened or narrowed).
 *
 * Part 1 drives the HTTP routes against an in-memory policy double built from the
 * REAL platform schema. Part 2 drives `PermitAuthorizationProvider.listTenants`
 * (member filtering, fail-closed, limit clamp, envelope, cursor walk).
 */
process.env.NODE_ENV = 'test'
process.env.PERMIT_API_KEY = process.env.PERMIT_API_KEY || 'ci-no-real-permit-calls'

import express from 'express'
import request from 'supertest'
import authzRoutes, { AUTHZ_ADMIN_SCOPE } from '../src/routes/authz'
import { permitSchema } from '../src/permit/schema'
import { setIdentityProvider } from '../src/providers/factory'
import { setAuthorizationProvider } from '../src/providers/authzFactory'
import { introspectMachineToken } from '../src/services/machine-identity'
import { ROOT_ORG_ID } from '../src/migrations/014_seed_root_platform_organization'
import { InvalidCursorError } from '../src/providers/AuthorizationProvider'
import { PermitAuthorizationProvider } from '../src/providers/permit/PermitAuthorizationProvider'
import { listTenantsFromPermit } from '../src/utils/permit/tenant-management'
import { listUserTenantKeys } from '../src/utils/permit/role-assignment'

jest.mock('../src/services/machine-identity', () => ({
  introspectMachineToken: jest.fn(),
}))
jest.mock('../src/utils/permit/tenant-management', () => ({
  ...jest.requireActual('../src/utils/permit/tenant-management'),
  listTenantsFromPermit: jest.fn(),
}))
jest.mock('../src/utils/permit/role-assignment', () => ({
  ...jest.requireActual('../src/utils/permit/role-assignment'),
  listUserTenantKeys: jest.fn(),
}))
const mockIntrospect = introspectMachineToken as jest.MockedFunction<typeof introspectMachineToken>
const mockListTenantsFromPermit = listTenantsFromPermit as jest.MockedFunction<typeof listTenantsFromPermit>
const mockListUserTenantKeys = listUserTenantKeys as jest.MockedFunction<typeof listUserTenantKeys>

const buildApp = () => {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/security', authzRoutes)
  return app
}

// ── Policy double: tenant roles from the REAL schema ─────────────────────────
const TENANT_ROLE_PERMS: Record<string, Set<string>> = Object.fromEntries(
  permitSchema.roles.map(r => [r.key, new Set(r.permissions)])
)
const tenantRoles: Record<string, Record<string, string>> = {}
const decide = (q: { subject: string; tenant: string; resource: { type: string }; action: string }) => {
  const role = tenantRoles[q.subject]?.[q.tenant]
  return !!role && !!TENANT_ROLE_PERMS[role]?.has(`${q.resource.type}:${q.action}`)
}

const provider = {
  check: jest.fn(),
  bulkCheck: jest.fn(),
  getPermissions: jest.fn(),
  grant: jest.fn(),
  revoke: jest.fn(),
  listGrants: jest.fn(),
  listTenants: jest.fn(),
  createTenant: jest.fn(),
  getTenant: jest.fn(),
  listMembers: jest.fn(),
  addMember: jest.fn(),
  removeMember: jest.fn(),
  assignRoles: jest.fn(),
  listRoles: jest.fn(),
  setAttributes: jest.fn(),
}

const SESSIONS: Record<string, string> = {
  'tok-outsider': 'outsider', // authenticated, no role anywhere
  'tok-member': 'member-1', // viewer in t1
  'tok-t1-admin': 'admin-t1', // admin of the CUSTOMER tenant t1 only
  'tok-platform': 'staff-1', // admin of the platform ROOT tenant
}
const SCOPELESS = 'machine-no-scope'
const OPERATOR = 'machine-operator'
const T1 = 't1'
const PAGE = { items: [{ id: 't1', name: 'T1' }], page: { nextCursor: null, hasMore: false } }

beforeEach(() => {
  jest.resetAllMocks()
  for (const k of Object.keys(tenantRoles)) delete tenantRoles[k]
  tenantRoles['member-1'] = { [T1]: 'viewer' }
  tenantRoles['admin-t1'] = { [T1]: 'admin' }
  tenantRoles['staff-1'] = { [ROOT_ORG_ID]: 'admin' }

  setIdentityProvider({
    getUserInfo: jest.fn(async (token: string) => {
      const id = SESSIONS[token]
      if (!id) throw new Error('not a session token')
      return { user: { id } }
    }),
  } as any)
  setAuthorizationProvider(provider as any)
  provider.check.mockImplementation(async (q: any) => decide(q))
  provider.listTenants.mockResolvedValue(PAGE)
  provider.createTenant.mockResolvedValue({ id: 'new-tenant', name: 'New' })
  mockIntrospect.mockImplementation(async (token: string) => {
    if (token === SCOPELESS) return { active: true, client_id: 'svc-a', scope: 's2s:other' }
    if (token === OPERATOR) return { active: true, client_id: 'operator', scope: `s2s:platform ${AUTHZ_ADMIN_SCOPE}` }
    return { active: false }
  })
})

afterEach(() => {
  setIdentityProvider(null)
  setAuthorizationProvider(null)
})

const POST = (token: string | null, body: unknown) => {
  const r = request(buildApp()).post('/api/v1/security/tenants')
  return (token ? r.set('Authorization', `Bearer ${token}`) : r).send(body as object)
}
const GET = (token: string | null, qs = '') => {
  const r = request(buildApp()).get(`/api/v1/security/tenants${qs}`)
  return token ? r.set('Authorization', `Bearer ${token}`) : r
}

// ═════════════════════════════════════════════════════════════════════════════
describe('POST /tenants — creating a tenant is a platform act', () => {
  it('401 without a token', async () => {
    await POST(null, { name: 'x' }).expect(401)
    expect(provider.createTenant).not.toHaveBeenCalled()
  })

  it.each([
    ['an authenticated user with no standing', 'tok-outsider'],
    ['a viewer of a customer tenant', 'tok-member'],
    ['the ADMIN of a customer tenant (they administer their tenant, not the platform)', 'tok-t1-admin'],
  ])('%s is FORBIDDEN and nothing is created', async (_n, token) => {
    const res = await POST(token, { name: 'Evil Co' }).expect(403)
    expect(res.body.code).toBe('FORBIDDEN')
    expect(provider.createTenant).not.toHaveBeenCalled()
  })

  it('the decision is evaluated against the PLATFORM ROOT tenant, not anything the body names', async () => {
    await POST('tok-outsider', { name: 'x', slug: T1, tenant: T1 }).expect(403)
    expect(provider.check).toHaveBeenCalledWith({
      subject: 'outsider',
      tenant: ROOT_ORG_ID,
      resource: { type: 'Organization' },
      action: 'manage',
    })
  })

  it('a platform administrator (Organization:manage on the root tenant) may create a tenant', async () => {
    const res = await POST('tok-platform', { name: 'Acme', slug: 'acme' }).expect(201)
    expect(res.body).toEqual({ id: 'new-tenant', name: 'New' })
    expect(provider.createTenant).toHaveBeenCalledWith({ name: 'Acme', slug: 'acme' })
  })

  it('authorization comes BEFORE validation: a non-admin gets 403 even for a malformed body; an admin gets 400', async () => {
    await POST('tok-outsider', {}).expect(403)
    await POST('tok-platform', {}).expect(400)
    expect(provider.createTenant).not.toHaveBeenCalled()
  })

  it('machine caller: scopeless is FORBIDDEN (no provider call); authz:admin may create without a provider check', async () => {
    await POST(SCOPELESS, { name: 'x' }).expect(403)
    expect(provider.createTenant).not.toHaveBeenCalled()
    await POST(OPERATOR, { name: 'x' }).expect(201)
    expect(provider.createTenant).toHaveBeenCalledTimes(1)
    expect(provider.check).not.toHaveBeenCalled()
  })

  it('fail closed: the policy engine down is 502 and nothing is created (never an allow)', async () => {
    provider.check.mockRejectedValue(new Error('pdp down'))
    const res = await POST('tok-platform', { name: 'x' }).expect(502)
    expect(res.body.code).toBe('PROVIDER_UNAVAILABLE')
    expect(provider.createTenant).not.toHaveBeenCalled()
  })

  it('fail closed: a non-boolean-true decision is a deny', async () => {
    provider.check.mockResolvedValue('yes' as any)
    await POST('tok-platform', { name: 'x' }).expect(403)
  })

  it('a creation failure after authorization is a 502 PROVIDER_ERROR', async () => {
    provider.createTenant.mockRejectedValue(new Error('permit 500'))
    const res = await POST('tok-platform', { name: 'x' }).expect(502)
    expect(res.body.code).toBe('PROVIDER_ERROR')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
describe('GET /tenants — tenants VISIBLE to the caller', () => {
  it('401 without a token', async () => {
    await GET(null).expect(401)
    expect(provider.listTenants).not.toHaveBeenCalled()
  })

  it.each([
    ['an authenticated user with no standing', 'tok-outsider', 'outsider'],
    ['a member of a customer tenant', 'tok-member', 'member-1'],
    ['the admin of a customer tenant', 'tok-t1-admin', 'admin-t1'],
  ])('%s gets the MEMBER view only', async (_n, token, who) => {
    await GET(token).expect(200)
    expect(provider.listTenants).toHaveBeenCalledWith(who, { limit: undefined, cursor: undefined }, 'member')
  })

  it('a platform administrator gets every tenant', async () => {
    await GET('tok-platform').expect(200)
    expect(provider.listTenants).toHaveBeenCalledWith('staff-1', { limit: undefined, cursor: undefined }, 'all')
  })

  it('machine caller: authz:admin sees all (no provider check); scopeless gets the member view as its own subject', async () => {
    await GET(OPERATOR).expect(200)
    expect(provider.listTenants).toHaveBeenLastCalledWith('svc:operator', expect.anything(), 'all')
    expect(provider.check).not.toHaveBeenCalled()
    await GET(SCOPELESS).expect(200)
    expect(provider.listTenants).toHaveBeenLastCalledWith('svc:svc-a', expect.anything(), 'member')
  })

  it('forwards limit and cursor to the provider', async () => {
    await GET('tok-member', '?limit=25&cursor=abc').expect(200)
    expect(provider.listTenants).toHaveBeenCalledWith('member-1', { limit: 25, cursor: 'abc' }, 'member')
  })

  it('fail closed: if the platform check cannot be answered the response is 502 and NOTHING is listed (not widened, not silently narrowed)', async () => {
    provider.check.mockRejectedValue(new Error('pdp down'))
    const res = await GET('tok-platform').expect(502)
    expect(res.body.code).toBe('PROVIDER_UNAVAILABLE')
    expect(provider.listTenants).not.toHaveBeenCalled()
  })

  it('a bad cursor is a 400 MALFORMED (not a 502, not a 500)', async () => {
    provider.listTenants.mockRejectedValue(new InvalidCursorError())
    const res = await GET('tok-member', '?cursor=garbage').expect(400)
    expect(res.body.code).toBe('MALFORMED')
  })

  it('a listing failure is a 502 PROVIDER_ERROR, not an unhandled 500', async () => {
    provider.listTenants.mockRejectedValue(new Error('permit 500'))
    const res = await GET('tok-member').expect(502)
    expect(res.body.code).toBe('PROVIDER_ERROR')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
describe('PermitAuthorizationProvider.listTenants', () => {
  const real = new PermitAuthorizationProvider()
  const tenantRow = (id: string) => ({ key: id, name: `Tenant ${id}`, attributes: { slug: `slug-${id}` } })
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `t${String(i).padStart(4, '0')}`)

  beforeEach(() => {
    mockListTenantsFromPermit.mockResolvedValue(ids(7).map(tenantRow) as any)
    mockListUserTenantKeys.mockResolvedValue(new Set(['t0001', 't0003', 'not-a-tenant']))
  })

  it("defaults to the MEMBER view: only tenants the caller holds a role in (the caller used to be ignored)", async () => {
    const page = await real.listTenants('u1', {})
    expect(page.items.map(t => t.id)).toEqual(['t0001', 't0003'])
    expect(mockListUserTenantKeys).toHaveBeenCalledWith('u1')
    expect(page.items[0]).toEqual({ id: 't0001', name: 'Tenant t0001', slug: 'slug-t0001' })
  })

  it("scope 'all' returns every tenant and never consults the caller's memberships", async () => {
    const page = await real.listTenants('staff', {}, 'all')
    expect(page.items).toHaveLength(7)
    expect(mockListUserTenantKeys).not.toHaveBeenCalled()
  })

  it('anything other than an explicit all is the member view', async () => {
    const page = await real.listTenants('u1', {}, undefined as any)
    expect(page.items).toHaveLength(2)
  })

  it('fail closed: a failed membership lookup yields NO tenants, never the full list', async () => {
    mockListUserTenantKeys.mockResolvedValue(new Set())
    const page = await real.listTenants('u1', {})
    expect(page.items).toEqual([])
    expect(page.page).toMatchObject({ nextCursor: null, hasMore: false })
  })

  describe('pagination (limit clamp, envelope, cursor walk)', () => {
    beforeEach(() => mockListTenantsFromPermit.mockResolvedValue(ids(450).map(tenantRow) as any))

    it('returns the { items, page } envelope with a default page of 50', async () => {
      const page = await real.listTenants('staff', {}, 'all')
      expect(page.items).toHaveLength(50)
      expect(page.page).toEqual({ nextCursor: expect.any(String), hasMore: true, total: 450 })
    })

    it('clamps limit to the maximum of 200 and to at least 1', async () => {
      expect((await real.listTenants('staff', { limit: 100000 }, 'all')).items).toHaveLength(200)
      expect((await real.listTenants('staff', { limit: 0 }, 'all')).items).toHaveLength(50) // 0 is "unset"
      expect((await real.listTenants('staff', { limit: -5 }, 'all')).items).toHaveLength(1)
      expect((await real.listTenants('staff', { limit: 7 }, 'all')).items).toHaveLength(7)
    })

    it('walks the whole set exactly once (no gaps, no duplicates) and terminates', async () => {
      const seen: string[] = []
      let cursor: string | undefined
      let pages = 0
      do {
        const page = await real.listTenants('staff', { limit: 200, cursor }, 'all')
        seen.push(...page.items.map(t => t.id))
        cursor = page.page.nextCursor ?? undefined
        pages++
        expect(pages).toBeLessThan(10)
      } while (cursor)
      expect(pages).toBe(3)
      expect(seen).toEqual(ids(450))
      expect(new Set(seen).size).toBe(450)
    })

    it('is a keyset (position in id order): tenants added or removed between pages cause no gap or repeat of the rest', async () => {
      const first = await real.listTenants('staff', { limit: 100 }, 'all')
      const last = first.items[first.items.length - 1].id
      // a tenant sorting BEFORE the cursor is created, one after it is removed
      mockListTenantsFromPermit.mockResolvedValue([...ids(450).filter(i => i !== 't0200'), 't0000a'].map(tenantRow) as any)
      const second = await real.listTenants('staff', { limit: 100, cursor: first.page.nextCursor! }, 'all')
      expect(second.items[0].id > last).toBe(true)
      expect(second.items.map(t => t.id)).not.toContain('t0200')
      expect(second.items.every(t => t.id > last)).toBe(true)
    })

    it('a cursor this provider did not issue is rejected, never guessed at', async () => {
      await expect(real.listTenants('staff', { cursor: '%%%not-base64%%%' }, 'all')).rejects.toBeInstanceOf(InvalidCursorError)
      await expect(real.listTenants('staff', { cursor: 'dGVzdB' }, 'all')).rejects.toBeInstanceOf(InvalidCursorError)
    })

    it('the last page has no cursor', async () => {
      const page = await real.listTenants('staff', { limit: 200 }, 'all')
      const second = await real.listTenants('staff', { limit: 200, cursor: page.page.nextCursor! }, 'all')
      const third = await real.listTenants('staff', { limit: 200, cursor: second.page.nextCursor! }, 'all')
      expect(third.items).toHaveLength(50)
      expect(third.page).toMatchObject({ nextCursor: null, hasMore: false })
    })
  })
})
