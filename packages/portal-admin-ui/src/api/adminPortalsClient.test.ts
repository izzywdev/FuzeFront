import { describe, it, expect, vi, beforeEach } from 'vitest'

const httpMock = {
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}

vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => httpMock),
  },
}))

// Imported AFTER the mock so `PortalClient`'s internal `axios.create(...)` picks it up.
const { createAdminPortalsClient } = await import('./adminPortalsClient')

describe('createAdminPortalsClient', () => {
  beforeEach(() => {
    httpMock.get.mockReset()
    httpMock.post.mockReset()
    httpMock.patch.mockReset()
  })

  it('lists portals against GET /api/v1/admin/portals, mapping the cursor envelope', async () => {
    httpMock.get.mockResolvedValue({
      data: { items: [{ id: 'prt_1', slug: 'acme' }], page: { nextCursor: 'c1' } },
    })
    const client = createAdminPortalsClient({ getToken: () => 'tok' })
    const page = await client.listPortals({ limit: 10 })

    expect(httpMock.get).toHaveBeenCalledWith('/api/v1/admin/portals', { params: { status: undefined, q: undefined, limit: 10, cursor: undefined } })
    expect(page.items).toHaveLength(1)
    expect(page.page.hasMore).toBe(true)
  })

  it('reports hasMore false on the last page (nextCursor null)', async () => {
    httpMock.get.mockResolvedValue({ data: { items: [], page: { nextCursor: null } } })
    const client = createAdminPortalsClient()
    const page = await client.listPortals()
    expect(page.page.hasMore).toBe(false)
  })

  it('creates a portal via POST /api/v1/admin/portals', async () => {
    httpMock.post.mockResolvedValue({ data: { id: 'prt_new', slug: 'new-tenant' } })
    const client = createAdminPortalsClient({ getToken: () => 'tok' })
    const portal = await client.createPortal({ name: 'New', slug: 'new-tenant', ownerEmail: 'a@b.com', billingMode: 'free' })
    expect(portal.slug).toBe('new-tenant')
    expect(httpMock.post).toHaveBeenCalledWith('/api/v1/admin/portals', {
      name: 'New',
      slug: 'new-tenant',
      ownerEmail: 'a@b.com',
      billingMode: 'free',
    })
  })

  it('gets a single portal by id', async () => {
    httpMock.get.mockResolvedValue({ data: { id: 'prt_1', slug: 'acme' } })
    const client = createAdminPortalsClient()
    const portal = await client.getPortal('prt_1')
    expect(portal.id).toBe('prt_1')
    expect(httpMock.get).toHaveBeenCalledWith('/api/v1/admin/portals/prt_1')
  })

  it('suspends a portal via the semantic suspend action', async () => {
    httpMock.post.mockResolvedValue({ data: { id: 'prt_1', status: 'suspended' } })
    const client = createAdminPortalsClient()
    const suspended = await client.suspendPortal('prt_1')
    expect(suspended.status).toBe('suspended')
    expect(httpMock.post).toHaveBeenCalledWith('/api/v1/admin/portals/prt_1/suspend')
  })

  it('resumes a portal via the semantic resume action', async () => {
    httpMock.post.mockResolvedValue({ data: { id: 'prt_1', status: 'active' } })
    const client = createAdminPortalsClient()
    const resumed = await client.resumePortal('prt_1')
    expect(resumed.status).toBe('active')
    expect(httpMock.post).toHaveBeenCalledWith('/api/v1/admin/portals/prt_1/resume')
  })
})
