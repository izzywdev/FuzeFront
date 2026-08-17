import { describe, it, expect, vi } from 'vitest'

const portalHttpMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }
vi.mock('axios', () => ({ default: { create: vi.fn(() => portalHttpMock) } }))

const { createPortalConsoleClient } = await import('./portalConsoleClient')

function mockFetch(status: number, body: unknown): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch
}

describe('createPortalConsoleClient', () => {
  it('getCurrentPortal reads the session-scoped portal via @fuzefront/portal-client', async () => {
    portalHttpMock.get.mockResolvedValue({ data: { id: 'prt_1', organizationId: 'org_1' } })
    const client = createPortalConsoleClient({ getToken: () => 'tok' })
    const portal = await client.getCurrentPortal()
    expect(portal.organizationId).toBe('org_1')
    expect(portalHttpMock.get).toHaveBeenCalledWith('/api/v1/portal/current')
  })

  it('listUsers calls GET /api/users with cursor params', async () => {
    const fetchImpl = mockFetch(200, { items: [{ id: 'u1', email: 'a@b.com' }], page: { nextCursor: null } })
    const client = createPortalConsoleClient({ fetchImpl })
    const page = await client.listUsers({ limit: 25 })
    expect(page.items).toHaveLength(1)
    const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[0]).toBe('/api/users?limit=25')
  })

  it('searchUsers calls GET /api/users/search?q=', async () => {
    const fetchImpl = mockFetch(200, { items: [], page: { nextCursor: null } })
    const client = createPortalConsoleClient({ fetchImpl })
    await client.searchUsers('ada')
    const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[0]).toBe('/api/users/search?q=ada')
  })

  it('listOrgMembers calls the real, portal-scoped organization members endpoint', async () => {
    const fetchImpl = mockFetch(200, {
      items: [{ membershipId: 'm1', role: 'admin', status: 'active', joinedAt: null, user: { id: 'u1', email: 'a@b.com', firstName: null, lastName: null, homePortalId: null } }],
      page: { nextCursor: null },
    })
    const client = createPortalConsoleClient({ fetchImpl })
    const page = await client.listOrgMembers('org_1')
    expect(page.items[0].role).toBe('admin')
    const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[0]).toBe('/api/organizations/org_1/members')
  })

  it('createInvitation POSTs { email, role } to the org invitations route', async () => {
    const fetchImpl = mockFetch(201, { invitation: { id: 'inv1', organizationId: 'org_1', email: 'a@b.com', role: 'member', status: 'pending', expiresAt: null } })
    const client = createPortalConsoleClient({ fetchImpl })
    const invitation = await client.createInvitation('org_1', 'a@b.com', 'member')
    expect(invitation.id).toBe('inv1')
    const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[0]).toBe('/api/organizations/org_1/invitations')
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({ email: 'a@b.com', role: 'member' })
  })

  it('resendInvitation and revokeInvitation call the real resend/revoke routes', async () => {
    const fetchImpl = mockFetch(200, {})
    const client = createPortalConsoleClient({ fetchImpl })
    await client.resendInvitation('org_1', 'inv1')
    let call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[0]).toBe('/api/organizations/org_1/invitations/inv1/resend')
    expect((call[1] as RequestInit).method).toBe('POST')

    await client.revokeInvitation('org_1', 'inv1')
    call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[1]
    expect(call[0]).toBe('/api/organizations/org_1/invitations/inv1')
    expect((call[1] as RequestInit).method).toBe('DELETE')
  })

  it('listRegistryApps reads the host apps table (real id, not the slug-only frozen registry contract)', async () => {
    const fetchImpl = mockFetch(200, [{ id: 'app_1', name: 'CRM', iconUrl: null, isHealthy: true, integrationType: 'module-federation' }])
    const client = createPortalConsoleClient({ fetchImpl })
    const apps = await client.listRegistryApps()
    expect(apps).toEqual([{ id: 'app_1', name: 'CRM', integrationType: 'module-federation', iconUrl: null, isHealthy: true }])
    const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[0]).toBe('/api/apps')
  })

  it('listPortalCatalog/enable/update/disable call the real per-portal catalog admin routes', async () => {
    const fetchImpl = mockFetch(200, { items: [], page: { nextCursor: null } })
    const client = createPortalConsoleClient({ fetchImpl })
    await client.listPortalCatalog('prt_1')
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('/api/v1/app-registry/portals/prt_1/catalog')

    await client.enableCatalogApp('prt_1', 'app_1', 0)
    const enableCall = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[1]
    expect(enableCall[0]).toBe('/api/v1/app-registry/portals/prt_1/catalog')
    expect(JSON.parse((enableCall[1] as RequestInit).body as string)).toEqual({ appId: 'app_1', pinnedOrder: 0 })

    await client.updateCatalogEntry('prt_1', 'app_1', { pinnedOrder: 2 })
    const updateCall = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[2]
    expect(updateCall[0]).toBe('/api/v1/app-registry/portals/prt_1/catalog/app_1')
    expect((updateCall[1] as RequestInit).method).toBe('PATCH')

    await client.disableCatalogApp('prt_1', 'app_1')
    const disableCall = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[3]
    expect(disableCall[0]).toBe('/api/v1/app-registry/portals/prt_1/catalog/app_1')
    expect((disableCall[1] as RequestInit).method).toBe('DELETE')
  })
})
