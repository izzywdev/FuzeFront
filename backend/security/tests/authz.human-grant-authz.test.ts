/**
 * Human-caller authorization for grant / revoke / cross-subject reads and
 * tenant member-role management on the Security API's `/authz/*` + `/tenants/*`
 * surface.
 *
 * Authentication proves WHO the caller is; these tests prove that a HUMAN
 * session caller may only administer a tenant (or resource instance) they are
 * actually authorized for, evaluated through `AuthorizationProvider.check()`
 * against the TARGET tenant. The provider here is an in-memory policy double
 * built from the REAL platform schema (`src/permit/schema.ts`) so "who holds
 * `Organization:manage`" is the production answer, not a hand-rolled one.
 *
 * Machine (client_credentials) behavior is asserted UNCHANGED: scope-gated by
 * `authz:admin`, with no provider check involved.
 */
process.env.NODE_ENV = 'test'
process.env.PERMIT_API_KEY = process.env.PERMIT_API_KEY || 'ci-no-real-permit-calls'

import express from 'express'
import request from 'supertest'
import authzRoutes, { AUTHZ_ADMIN_SCOPE } from '../src/routes/authz'
import { permitSchema } from '../src/permit/schema'
import { setIdentityProvider } from '../src/providers/factory'
import { setAuthorizationProvider } from '../src/providers/authzFactory'
import { findMembershipByUserAndOrg } from '../src/repositories/organizationRepository'
import { introspectMachineToken } from '../src/services/machine-identity'

jest.mock('../src/repositories/organizationRepository', () => ({
  findMembershipByUserAndOrg: jest.fn(async () => ({ status: 'active' })),
}))

jest.mock('../src/services/machine-identity', () => ({
  introspectMachineToken: jest.fn(),
}))
const mockIntrospect = introspectMachineToken as jest.MockedFunction<typeof introspectMachineToken>

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/security', authzRoutes)
  return app
}

// ── In-memory policy double ──────────────────────────────────────────────────
//
// tenantRoles:   user -> tenant -> platform role key (admin/editor/viewer/...)
// instanceRoles: user -> `${tenant}|${Type}:${key}` -> instance role key
// Tenant roles AND instance roles both resolve from the real `permitSchema`
// (instance roles from `resources[SelectionList].roles`).

const TENANT_ROLE_PERMS: Record<string, Set<string>> = Object.fromEntries(
  permitSchema.roles.map(r => [r.key, new Set(r.permissions)])
)
// Instance roles resolve from the REAL `SelectionList` resource in the schema
// (not a hand-written copy), so the role -> action matrix asserted here is the
// one Permit is actually synced with.
const SELECTION_LIST_RESOURCE = permitSchema.resources.find(r => r.key === 'SelectionList')!
const INSTANCE_ROLE_ACTIONS: Record<string, string[]> = Object.fromEntries(
  Object.entries(SELECTION_LIST_RESOURCE.roles ?? {}).map(([k, v]) => [k, v.permissions])
)

const tenantRoles: Record<string, Record<string, string>> = {}
const instanceRoles: Record<string, Record<string, string>> = {}

function policyDecision(q: {
  subject: string
  tenant: string
  resource: { type: string; key?: string }
  action: string
}): boolean {
  const tenantRole = tenantRoles[q.subject]?.[q.tenant]
  if (tenantRole && TENANT_ROLE_PERMS[tenantRole]?.has(`${q.resource.type}:${q.action}`)) return true
  if (q.resource.key) {
    const inst = instanceRoles[q.subject]?.[`${q.tenant}|${q.resource.type}:${q.resource.key}`]
    if (inst && INSTANCE_ROLE_ACTIONS[inst]?.includes(q.action)) return true
  }
  return false
}

const authorizationProvider = {
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

// Human session tokens -> user ids
const SESSIONS: Record<string, string> = {
  'tok-outsider': 'outsider', // no standing in any tenant
  'tok-viewer': 'viewer-1', // viewer in t1
  'tok-editor': 'editor-1', // editor in t1
  'tok-admin': 'admin-1', // admin in t1 ONLY
  'tok-owner': 'owner-1', // list-owner of t1|SelectionList:L1 (no tenant role beyond viewer)
}
const CALLER_TOKEN = 'machine-no-scope'
const OPERATOR_TOKEN = 'machine-operator'

const T1 = 't1'
const T2 = 't2'
const GRANT_OK = { id: 't1:target:editor', subject: 'target', tenant: T1, role: 'editor' }

beforeEach(() => {
  jest.resetAllMocks()
  jest.mocked(findMembershipByUserAndOrg).mockResolvedValue({ status: 'active' } as any)
  for (const k of Object.keys(tenantRoles)) delete tenantRoles[k]
  for (const k of Object.keys(instanceRoles)) delete instanceRoles[k]
  tenantRoles['viewer-1'] = { [T1]: 'viewer' }
  tenantRoles['editor-1'] = { [T1]: 'editor' }
  tenantRoles['admin-1'] = { [T1]: 'admin' }
  tenantRoles['owner-1'] = { [T1]: 'viewer' }
  instanceRoles['owner-1'] = { [`${T1}|SelectionList:L1`]: 'list-owner' }

  setIdentityProvider({
    getUserInfo: jest.fn(async (token: string) => {
      const id = SESSIONS[token]
      if (!id) throw new Error('not a session token')
      return { user: { id } }
    }),
  } as any)
  setAuthorizationProvider(authorizationProvider as any)

  authorizationProvider.check.mockImplementation(async (q: any) => policyDecision(q))
  authorizationProvider.grant.mockResolvedValue(GRANT_OK)
  authorizationProvider.revoke.mockResolvedValue(undefined)
  authorizationProvider.listGrants.mockResolvedValue({ items: [], page: { nextCursor: null, hasMore: false } })
  authorizationProvider.getPermissions.mockResolvedValue(['App:read'])
  authorizationProvider.getTenant.mockResolvedValue({ id: T1, name: 'T1' })
  authorizationProvider.listMembers.mockResolvedValue({ items: [], page: { nextCursor: null, hasMore: false } })
  authorizationProvider.listRoles.mockResolvedValue([])
  authorizationProvider.addMember.mockResolvedValue({ userId: 'target', roles: ['viewer'] })
  authorizationProvider.assignRoles.mockResolvedValue({ userId: 'target', roles: ['editor'] })
  authorizationProvider.removeMember.mockResolvedValue(undefined)

  mockIntrospect.mockImplementation(async (token: string) => {
    if (token === CALLER_TOKEN) return { active: true, client_id: 'svc-a', scope: 's2s:other' }
    if (token === OPERATOR_TOKEN) return { active: true, client_id: 'operator', scope: `s2s:platform ${AUTHZ_ADMIN_SCOPE}` }
    return { active: false }
  })
})

afterEach(() => {
  setIdentityProvider(null)
  setAuthorizationProvider(null)
})

const POST = (token: string, body: unknown) =>
  request(buildApp()).post('/api/v1/security/authz/grants').set('Authorization', `Bearer ${token}`).send(body as object)
const DEL = (token: string, body: unknown) =>
  request(buildApp()).delete('/api/v1/security/authz/grants').set('Authorization', `Bearer ${token}`).send(body as object)
const GET = (token: string, path: string) =>
  request(buildApp()).get(path).set('Authorization', `Bearer ${token}`)

const tenantGrant = (tenant: string, role: string, extra: object = {}) => ({
  subject: 'target',
  tenant,
  role,
  ...extra,
})
const listGrant = (key: string, role: string, tenant = T1) => ({
  subject: 'target',
  tenant,
  role,
  resource: { type: 'SelectionList', key },
})

// ═════════════════════════════════════════════════════════════════════════════
describe('POST /authz/grants — human callers', () => {
  it('non-member (no standing in the tenant) is FORBIDDEN and nothing is granted', async () => {
    const res = await POST('tok-outsider', tenantGrant(T1, 'viewer')).expect(403)
    expect(res.body.code).toBe('FORBIDDEN')
    expect(authorizationProvider.grant).not.toHaveBeenCalled()
  })

  it('member who is not an admin (viewer) is FORBIDDEN', async () => {
    await POST('tok-viewer', tenantGrant(T1, 'viewer')).expect(403)
    expect(authorizationProvider.grant).not.toHaveBeenCalled()
  })

  it('member who is not an admin (editor) is FORBIDDEN', async () => {
    await POST('tok-editor', tenantGrant(T1, 'editor')).expect(403)
    expect(authorizationProvider.grant).not.toHaveBeenCalled()
  })

  it('tenant admin may grant a role in their own tenant', async () => {
    const res = await POST('tok-admin', tenantGrant(T1, 'editor')).expect(201)
    expect(res.body).toEqual(GRANT_OK)
    expect(authorizationProvider.grant).toHaveBeenCalledWith(
      expect.objectContaining({ subject: 'target', tenant: T1, role: 'editor' })
    )
    // The authorization decision was evaluated against the TARGET tenant for the CALLER.
    expect(authorizationProvider.check).toHaveBeenCalledWith(
      expect.objectContaining({ subject: 'admin-1', tenant: T1, action: 'manage' })
    )
  })

  it('anti-escalation: a non-admin cannot mint tenant admin (self or other)', async () => {
    await POST('tok-editor', { subject: 'editor-1', tenant: T1, role: 'admin' }).expect(403)
    await POST('tok-viewer', tenantGrant(T1, 'admin')).expect(403)
    await POST('tok-outsider', { subject: 'outsider', tenant: T1, role: 'admin' }).expect(403)
    expect(authorizationProvider.grant).not.toHaveBeenCalled()
  })

  it('cross-tenant: an admin of t1 cannot grant in t2 (the check is evaluated against t2)', async () => {
    await POST('tok-admin', tenantGrant(T2, 'admin')).expect(403)
    expect(authorizationProvider.grant).not.toHaveBeenCalled()
    expect(authorizationProvider.check).toHaveBeenCalledWith(
      expect.objectContaining({ subject: 'admin-1', tenant: T2, action: 'manage' })
    )
  })

  it('a resource with no key is a tenant-wide grant and is gated as one (cannot dress admin up as instance-scoped)', async () => {
    await POST('tok-owner', { subject: 'owner-1', tenant: T1, role: 'admin', resource: { type: 'SelectionList' } }).expect(403)
    expect(authorizationProvider.grant).not.toHaveBeenCalled()
  })

  it('malformed resource is rejected 400 before any provider call', async () => {
    await POST('tok-admin', tenantGrant(T1, 'editor', { resource: 'SelectionList:L1' })).expect(400)
    await POST('tok-admin', tenantGrant(T1, 'editor', { resource: { key: 'L1' } })).expect(400)
    expect(authorizationProvider.grant).not.toHaveBeenCalled()
    expect(authorizationProvider.check).not.toHaveBeenCalled()
  })

  describe('resource-instance grants (ReBAC)', () => {
    it('a holder of manage_access on THAT instance may grant a non-tenant role on it', async () => {
      authorizationProvider.grant.mockResolvedValue({ ...GRANT_OK, role: 'list-viewer' })
      await POST('tok-owner', listGrant('L1', 'list-viewer')).expect(201)
      expect(authorizationProvider.grant).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'list-viewer', resource: { type: 'SelectionList', key: 'L1' } })
      )
    })

    it('...but not on a different instance', async () => {
      await POST('tok-owner', listGrant('L2', 'list-viewer')).expect(403)
      expect(authorizationProvider.grant).not.toHaveBeenCalled()
    })

    it('...and not in a different tenant', async () => {
      await POST('tok-owner', listGrant('L1', 'list-viewer', T2)).expect(403)
      expect(authorizationProvider.grant).not.toHaveBeenCalled()
    })

    it('anti-escalation: instance access never confers a tenant-level role', async () => {
      await POST('tok-owner', listGrant('L1', 'admin')).expect(403)
      await POST('tok-owner', listGrant('L1', 'org-admin')).expect(403)
      await POST('tok-owner', tenantGrant(T1, 'list-viewer')).expect(403) // tenant-wide, no resource
      await POST('tok-owner', {
        subject: 'target',
        tenant: T1,
        role: 'org-admin',
        resource: { type: 'Organization', key: T1 },
      }).expect(403)
      expect(authorizationProvider.grant).not.toHaveBeenCalled()
    })

    it('a plain member with no manage_access on the instance is FORBIDDEN', async () => {
      await POST('tok-editor', listGrant('L1', 'list-viewer')).expect(403)
      expect(authorizationProvider.grant).not.toHaveBeenCalled()
    })

    it('the schema declares the five selection-list instance roles the double resolves', () => {
      expect(Object.keys(INSTANCE_ROLE_ACTIONS).sort()).toEqual([
        'list-contributor', 'list-editor', 'list-owner', 'list-translator', 'list-viewer',
      ])
      expect(INSTANCE_ROLE_ACTIONS['list-owner']).toContain('manage_access')
      // only the owner can administer access
      for (const [role, actions] of Object.entries(INSTANCE_ROLE_ACTIONS)) {
        if (role !== 'list-owner') expect(actions).not.toContain('manage_access')
      }
    })

    it('owner-1 (manage_access on t1|SelectionList:L1) may grant list-owner on L1', async () => {
      authorizationProvider.grant.mockResolvedValue({ ...GRANT_OK, role: 'list-owner' })
      await POST('tok-owner', listGrant('L1', 'list-owner')).expect(201)
      expect(authorizationProvider.grant).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'list-owner', resource: { type: 'SelectionList', key: 'L1' } })
      )
      expect(authorizationProvider.check).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: 'owner-1',
          tenant: T1,
          resource: { type: 'SelectionList', key: 'L1' },
          action: 'manage_access',
        })
      )
    })

    it('owner-1 may NOT grant list-owner on a different list (L2) or tenant', async () => {
      await POST('tok-owner', listGrant('L2', 'list-owner')).expect(403)
      await POST('tok-owner', listGrant('L1', 'list-owner', T2)).expect(403)
      expect(authorizationProvider.grant).not.toHaveBeenCalled()
    })

    it('owner-1 may NOT grant a tenant-level role name on L1 (admin/editor/viewer/developer/org-admin)', async () => {
      for (const role of ['admin', 'editor', 'viewer', 'developer', 'org-admin']) {
        await POST('tok-owner', listGrant('L1', role)).expect(403)
      }
      expect(authorizationProvider.grant).not.toHaveBeenCalled()
    })

    it('non-owner list roles hold no manage_access, so they cannot grant (list-editor on L1)', async () => {
      instanceRoles['editor-1'] = { [`${T1}|SelectionList:L1`]: 'list-editor' }
      await POST('tok-editor', listGrant('L1', 'list-viewer')).expect(403)
      expect(authorizationProvider.grant).not.toHaveBeenCalled()
    })

    it('tenant roles hold no SelectionList:* action, so a tenant editor/viewer has no list access without a grant', async () => {
      for (const role of permitSchema.roles) {
        expect(role.permissions.filter(p => p.startsWith('SelectionList:'))).toEqual([])
      }
      expect(policyDecision({ subject: 'editor-1', tenant: T1, resource: { type: 'SelectionList', key: 'L1' }, action: 'read' })).toBe(false)
    })

    it('a tenant admin may grant instance-scoped roles in their tenant', async () => {
      authorizationProvider.grant.mockResolvedValue({ ...GRANT_OK, role: 'list-owner' })
      await POST('tok-admin', listGrant('L9', 'list-owner')).expect(201)
    })
  })

  describe('fail-closed on provider trouble', () => {
    it('provider check throws ⇒ 502, never allow, nothing granted', async () => {
      authorizationProvider.check.mockRejectedValue(new Error('pdp down'))
      const res = await POST('tok-admin', tenantGrant(T1, 'editor')).expect(502)
      expect(res.body.code).toBe('PROVIDER_UNAVAILABLE')
      expect(authorizationProvider.grant).not.toHaveBeenCalled()
    })

    it('provider check returns false (what the Permit provider does on error) ⇒ 403', async () => {
      authorizationProvider.check.mockResolvedValue(false)
      await POST('tok-admin', tenantGrant(T1, 'editor')).expect(403)
      expect(authorizationProvider.grant).not.toHaveBeenCalled()
    })

    it('only a literal `true` decision allows (a truthy non-boolean is a deny)', async () => {
      authorizationProvider.check.mockResolvedValue('yes')
      await POST('tok-admin', tenantGrant(T1, 'editor')).expect(403)
      expect(authorizationProvider.grant).not.toHaveBeenCalled()
    })

    it('a tenant-admin check that errors does not fall through to the instance check', async () => {
      authorizationProvider.check.mockRejectedValue(new Error('pdp down'))
      await POST('tok-owner', listGrant('L1', 'list-viewer')).expect(502)
      expect(authorizationProvider.grant).not.toHaveBeenCalled()
    })

    it('an authorized grant whose provider write fails is still a 502 PROVIDER_ERROR', async () => {
      authorizationProvider.grant.mockRejectedValue(new Error('boom'))
      const res = await POST('tok-admin', tenantGrant(T1, 'editor')).expect(502)
      expect(res.body.code).toBe('PROVIDER_ERROR')
    })
  })

  it('unauthenticated is still 401', async () => {
    await request(buildApp()).post('/api/v1/security/authz/grants').send(tenantGrant(T1, 'viewer')).expect(401)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
describe('DELETE /authz/grants — human callers (same matrix)', () => {
  const revokeBody = (tenant: string, role: string, extra: object = {}) => ({
    subject: 'target',
    tenant,
    role,
    ...extra,
  })

  it('non-member is FORBIDDEN', async () => {
    await DEL('tok-outsider', revokeBody(T1, 'admin')).expect(403)
    expect(authorizationProvider.revoke).not.toHaveBeenCalled()
  })

  it('member who is not an admin is FORBIDDEN (cannot strip another user’s grant)', async () => {
    await DEL('tok-viewer', revokeBody(T1, 'admin')).expect(403)
    await DEL('tok-editor', revokeBody(T1, 'admin')).expect(403)
    expect(authorizationProvider.revoke).not.toHaveBeenCalled()
  })

  it('tenant admin may revoke in their own tenant', async () => {
    await DEL('tok-admin', revokeBody(T1, 'editor')).expect(204)
    expect(authorizationProvider.revoke).toHaveBeenCalledWith(
      expect.objectContaining({ subject: 'target', tenant: T1, role: 'editor' })
    )
  })

  it('cross-tenant: an admin of t1 cannot revoke in t2', async () => {
    await DEL('tok-admin', revokeBody(T2, 'admin')).expect(403)
    expect(authorizationProvider.revoke).not.toHaveBeenCalled()
  })

  it('a grantId is resolved to its effective tuple and authorized against ITS tenant', async () => {
    await DEL('tok-admin', { grantId: `${T2}:target:admin` }).expect(403)
    expect(authorizationProvider.revoke).not.toHaveBeenCalled()
    await DEL('tok-admin', { grantId: `${T1}:target:editor` }).expect(204)
    expect(authorizationProvider.revoke).toHaveBeenCalledWith(
      expect.objectContaining({ subject: 'target', tenant: T1, role: 'editor' })
    )
  })

  it('an explicit tenant cannot be paired with another tenant’s grantId to smuggle a revoke', async () => {
    // Body says t1 (authorized), grantId says t2. The provider resolves explicit
    // fields first, so the effective — and executed — tenant is t1, never t2.
    await DEL('tok-admin', { grantId: `${T2}:target:admin`, tenant: T1 }).expect(204)
    expect(authorizationProvider.revoke).toHaveBeenCalledWith(
      expect.objectContaining({ tenant: T1 })
    )
    expect(authorizationProvider.revoke).not.toHaveBeenCalledWith(expect.objectContaining({ tenant: T2 }))
  })

  it('an unparseable grantId fails closed (400), never reaching the provider', async () => {
    await DEL('tok-admin', { grantId: 'opaque' }).expect(400)
    expect(authorizationProvider.revoke).not.toHaveBeenCalled()
  })

  it('instance-scoped revoke: manage_access holder may; others may not; tenant-level role never', async () => {
    await DEL('tok-owner', listGrant('L1', 'list-viewer')).expect(204)
    expect(authorizationProvider.revoke).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'list-viewer', resource: { type: 'SelectionList', key: 'L1' } })
    )
    authorizationProvider.revoke.mockClear()
    await DEL('tok-owner', listGrant('L2', 'list-viewer')).expect(403)
    await DEL('tok-owner', listGrant('L1', 'admin')).expect(403)
    await DEL('tok-editor', listGrant('L1', 'list-viewer')).expect(403)
    expect(authorizationProvider.revoke).not.toHaveBeenCalled()
  })

  it('provider check throws ⇒ 502 and nothing is revoked', async () => {
    authorizationProvider.check.mockRejectedValue(new Error('pdp down'))
    const res = await DEL('tok-admin', revokeBody(T1, 'editor')).expect(502)
    expect(res.body.code).toBe('PROVIDER_UNAVAILABLE')
    expect(authorizationProvider.revoke).not.toHaveBeenCalled()
  })
})

// ═════════════════════════════════════════════════════════════════════════════
describe('GET /authz/grants and /authz/permissions — enumeration', () => {
  const grantsPath = (q: string) => `/api/v1/security/authz/grants?${q}`
  const permsPath = (q: string) => `/api/v1/security/authz/permissions?${q}`

  it('a caller may list their OWN grants (default subject) without any admin check', async () => {
    await GET('tok-outsider', grantsPath(`tenant=${T1}`)).expect(200)
    expect(authorizationProvider.listGrants).toHaveBeenCalledWith(
      expect.objectContaining({ subject: 'outsider', tenant: T1 })
    )
    expect(authorizationProvider.check).not.toHaveBeenCalled()
  })

  it('...including when they name themselves explicitly', async () => {
    await GET('tok-viewer', grantsPath(`tenant=${T1}&subject=viewer-1`)).expect(200)
  })

  it('listing ANOTHER subject requires tenant admin: non-member and member are FORBIDDEN', async () => {
    await GET('tok-outsider', grantsPath(`tenant=${T1}&subject=admin-1`)).expect(403)
    await GET('tok-viewer', grantsPath(`tenant=${T1}&subject=admin-1`)).expect(403)
    expect(authorizationProvider.listGrants).not.toHaveBeenCalled()
  })

  it('...tenant admin may', async () => {
    await GET('tok-admin', grantsPath(`tenant=${T1}&subject=viewer-1`)).expect(200)
    expect(authorizationProvider.listGrants).toHaveBeenCalledWith(
      expect.objectContaining({ subject: 'viewer-1', tenant: T1 })
    )
  })

  it('...but only for their own tenant (cross-tenant is FORBIDDEN)', async () => {
    await GET('tok-admin', grantsPath(`tenant=${T2}&subject=viewer-1`)).expect(403)
    expect(authorizationProvider.listGrants).not.toHaveBeenCalled()
  })

  it('provider down while authorizing a cross-subject list ⇒ 502', async () => {
    authorizationProvider.check.mockRejectedValue(new Error('pdp down'))
    await GET('tok-admin', grantsPath(`tenant=${T1}&subject=viewer-1`)).expect(502)
    expect(authorizationProvider.listGrants).not.toHaveBeenCalled()
  })

  it('GET /authz/permissions: own is open, another subject needs tenant admin', async () => {
    await GET('tok-viewer', permsPath(`tenant=${T1}`)).expect(200)
    await GET('tok-viewer', permsPath(`tenant=${T1}&subject=admin-1`)).expect(403)
    await GET('tok-admin', permsPath(`tenant=${T1}&subject=viewer-1`)).expect(200)
    await GET('tok-admin', permsPath(`tenant=${T2}&subject=viewer-1`)).expect(403)
  })

  it('machine callers: scopeless is denied cross-subject reads, authz:admin is allowed, own is open', async () => {
    await GET(CALLER_TOKEN, grantsPath(`tenant=${T1}&subject=viewer-1`)).expect(403)
    await GET(OPERATOR_TOKEN, grantsPath(`tenant=${T1}&subject=viewer-1`)).expect(200)
    await GET(CALLER_TOKEN, grantsPath(`tenant=${T1}`)).expect(200)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
describe('/tenants/:id member + role management — human callers', () => {
  const put = (token: string, tenant: string, body: unknown) =>
    request(buildApp())
      .put(`/api/v1/security/tenants/${tenant}/members/target/roles`)
      .set('Authorization', `Bearer ${token}`)
      .send(body as object)
  const addMember = (token: string, tenant: string, body: unknown) =>
    request(buildApp())
      .post(`/api/v1/security/tenants/${tenant}/members`)
      .set('Authorization', `Bearer ${token}`)
      .send(body as object)
  const removeMember = (token: string, tenant: string) =>
    request(buildApp())
      .delete(`/api/v1/security/tenants/${tenant}/members/target`)
      .set('Authorization', `Bearer ${token}`)

  it('non-admin cannot assign roles (incl. admin) — 403, nothing assigned', async () => {
    await put('tok-outsider', T1, { roles: ['admin'] }).expect(403)
    await put('tok-editor', T1, { roles: ['admin'] }).expect(403)
    expect(authorizationProvider.assignRoles).not.toHaveBeenCalled()
  })

  it('non-admin cannot add a member with admin, or remove a member', async () => {
    await addMember('tok-editor', T1, { userId: 'target', roles: ['admin'] }).expect(403)
    await removeMember('tok-viewer', T1).expect(403)
    expect(authorizationProvider.addMember).not.toHaveBeenCalled()
    expect(authorizationProvider.removeMember).not.toHaveBeenCalled()
  })

  it('tenant admin may manage members and roles of their own tenant', async () => {
    await put('tok-admin', T1, { roles: ['editor'] }).expect(200)
    await addMember('tok-admin', T1, { userId: 'target', roles: ['viewer'] }).expect(201)
    await removeMember('tok-admin', T1).expect(204)
  })

  it('cross-tenant: an admin of t1 cannot manage t2, and gets 403 (not 404) so existence is not revealed', async () => {
    authorizationProvider.getTenant.mockResolvedValue(null)
    await put('tok-admin', T2, { roles: ['admin'] }).expect(403)
    await addMember('tok-admin', T2, { userId: 'target', roles: ['admin'] }).expect(403)
    await removeMember('tok-admin', T2).expect(403)
    expect(authorizationProvider.getTenant).not.toHaveBeenCalled()
  })

  it('reads: member list needs view_members, roles/tenant need Organization:read on THAT tenant', async () => {
    await GET('tok-viewer', `/api/v1/security/tenants/${T1}/members`).expect(200)
    await GET('tok-viewer', `/api/v1/security/tenants/${T1}/roles`).expect(200)
    await GET('tok-viewer', `/api/v1/security/tenants/${T1}`).expect(200)
    await GET('tok-outsider', `/api/v1/security/tenants/${T1}/members`).expect(403)
    await GET('tok-outsider', `/api/v1/security/tenants/${T1}/roles`).expect(403)
    await GET('tok-outsider', `/api/v1/security/tenants/${T1}`).expect(403)
    await GET('tok-admin', `/api/v1/security/tenants/${T2}/members`).expect(403)
  })

  it('provider down ⇒ 502 on a mutation, nothing assigned', async () => {
    authorizationProvider.check.mockRejectedValue(new Error('pdp down'))
    await put('tok-admin', T1, { roles: ['editor'] }).expect(502)
    expect(authorizationProvider.assignRoles).not.toHaveBeenCalled()
  })

  it('machine: scopeless is denied mutations; authz:admin is allowed without a provider check', async () => {
    await put(CALLER_TOKEN, T1, { roles: ['editor'] }).expect(403)
    await put(OPERATOR_TOKEN, T1, { roles: ['editor'] }).expect(200)
    expect(authorizationProvider.check).not.toHaveBeenCalled()
  })
})

// ═════════════════════════════════════════════════════════════════════════════
describe('machine callers — grant/revoke contract UNCHANGED (AUTHZ_ADMIN_SCOPE only)', () => {
  const body = { subject: 'svc:x', tenant: T1, role: 's2s-caller', resource: { type: 'ServiceEndpoint', key: 'ep1' } }

  it('without the scope: 403 FORBIDDEN on grant and revoke', async () => {
    const g = await POST(CALLER_TOKEN, body).expect(403)
    expect(g.body.code).toBe('FORBIDDEN')
    await DEL(CALLER_TOKEN, body).expect(403)
    expect(authorizationProvider.grant).not.toHaveBeenCalled()
    expect(authorizationProvider.revoke).not.toHaveBeenCalled()
  })

  it('with authz:admin: grant 201 and revoke 204, with NO provider authorization check (the scope is the authority)', async () => {
    await POST(OPERATOR_TOKEN, body).expect(201)
    await DEL(OPERATOR_TOKEN, body).expect(204)
    expect(authorizationProvider.check).not.toHaveBeenCalled()
  })

  it('with authz:admin: may grant any tenant (cross-tenant is the operator’s purpose) and tenant-wide roles', async () => {
    await POST(OPERATOR_TOKEN, tenantGrant(T2, 'admin')).expect(201)
  })
})
