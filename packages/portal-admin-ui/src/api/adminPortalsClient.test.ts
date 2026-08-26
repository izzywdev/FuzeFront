import { describe, it, expect } from 'vitest'
import { createAdminPortalsClient, isPortalsForbidden, isSlugConflict } from './adminPortalsClient'
import { HttpError } from './http'

function mockFetch(body: unknown, status = 200, ok = status < 300) {
  return async () =>
    ({
      ok,
      status,
      statusText: ok ? 'OK' : 'Error',
      text: async () => JSON.stringify(body),
    }) as Response
}

const PORTAL = {
  orgId: 'org_acme',
  parentOrgId: 'org_00000000-0000-0000-0000-000000000010',
  name: 'Acme',
  slug: 'acme',
  kind: 'portal' as const,
  status: 'active' as const,
  isPortalRoot: true,
  ownerEmail: 'owner@acme.example',
  customDomain: null,
  branding: { name: 'Acme' },
  billingMode: 'platform' as const,
  appCatalogMode: 'inherit' as const,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

describe('createAdminPortalsClient — listPortals', () => {
  it('hits GET /api/v1/security/portals with the cursor query, mapping the envelope through unchanged', async () => {
    let calledUrl: string | undefined
    const fetchImpl: typeof fetch = async url => {
      calledUrl = String(url)
      return mockFetch({ items: [PORTAL], page: { nextCursor: 'c1', hasMore: true } })()
    }
    const client = createAdminPortalsClient({ fetchImpl })
    const page = await client.listPortals({ limit: 25, cursor: 'c0', status: 'active' })

    expect(calledUrl).toBe('/api/v1/security/portals?limit=25&cursor=c0&status=active')
    expect(page.items).toHaveLength(1)
    expect(page.items[0].orgId).toBe('org_acme')
    expect(page.page).toEqual({ nextCursor: 'c1', hasMore: true })
  })

  it('omits query params that were not provided (first-page default fetch)', async () => {
    let calledUrl: string | undefined
    const fetchImpl: typeof fetch = async url => {
      calledUrl = String(url)
      return mockFetch({ items: [], page: { nextCursor: null, hasMore: false } })()
    }
    const client = createAdminPortalsClient({ fetchImpl })
    await client.listPortals()
    expect(calledUrl).toBe('/api/v1/security/portals')
  })

  it('a non-platform-admin caller gets a 403 the flow can detect via isPortalsForbidden', async () => {
    const client = createAdminPortalsClient({
      fetchImpl: mockFetch({ error: 'Forbidden', code: 'FORBIDDEN' }, 403, false),
    })
    await expect(client.listPortals()).rejects.toSatisfy((err: unknown) => isPortalsForbidden(err))
  })
})

describe('createAdminPortalsClient — createPortal', () => {
  it('POSTs the PortalCreate body to /api/v1/security/portals and resolves the created Portal', async () => {
    let calledUrl: string | undefined
    let calledBody: unknown
    const fetchImpl: typeof fetch = async (url, init) => {
      calledUrl = String(url)
      calledBody = init?.body ? JSON.parse(String(init.body)) : undefined
      return mockFetch(PORTAL, 201)()
    }
    const client = createAdminPortalsClient({ fetchImpl })
    const input = {
      name: 'Acme',
      slug: 'acme',
      ownerEmail: 'owner@acme.example',
      branding: { name: 'Acme' },
      billingMode: 'platform' as const,
      appCatalogMode: 'inherit' as const,
    }
    const portal = await client.createPortal(input)

    expect(calledUrl).toBe('/api/v1/security/portals')
    expect(calledBody).toEqual(input)
    expect(portal.orgId).toBe('org_acme')
  })

  it('a duplicate slug 409 CONFLICT is detectable via isSlugConflict', async () => {
    const client = createAdminPortalsClient({
      fetchImpl: mockFetch({ error: 'A portal with this slug already exists', code: 'CONFLICT' }, 409, false),
    })
    await expect(
      client.createPortal({ name: 'Acme', slug: 'acme', ownerEmail: 'a@b.com', billingMode: 'free', appCatalogMode: 'inherit' })
    ).rejects.toSatisfy((err: unknown) => isSlugConflict(err))
  })

  it('a generic HttpError is NOT reported as a slug conflict', () => {
    expect(isSlugConflict(new HttpError(500, 'boom', undefined))).toBe(false)
    expect(isSlugConflict(new Error('boom'))).toBe(false)
  })
})

describe('createAdminPortalsClient — getPortal / suspendPortal / resumePortal', () => {
  it('gets one portal by portalOrgId', async () => {
    let calledUrl: string | undefined
    const fetchImpl: typeof fetch = async url => {
      calledUrl = String(url)
      return mockFetch(PORTAL)()
    }
    const client = createAdminPortalsClient({ fetchImpl })
    const portal = await client.getPortal('org_acme')
    expect(calledUrl).toBe('/api/v1/security/portals/org_acme')
    expect(portal.orgId).toBe('org_acme')
  })

  it('suspends a portal via POST .../suspend', async () => {
    let calledUrl: string | undefined
    const fetchImpl: typeof fetch = async url => {
      calledUrl = String(url)
      return mockFetch({ ...PORTAL, status: 'suspended' })()
    }
    const client = createAdminPortalsClient({ fetchImpl })
    const suspended = await client.suspendPortal('org_acme')
    expect(calledUrl).toBe('/api/v1/security/portals/org_acme/suspend')
    expect(suspended.status).toBe('suspended')
  })

  it('resumes a portal via POST .../resume', async () => {
    let calledUrl: string | undefined
    const fetchImpl: typeof fetch = async url => {
      calledUrl = String(url)
      return mockFetch({ ...PORTAL, status: 'active' })()
    }
    const client = createAdminPortalsClient({ fetchImpl })
    const resumed = await client.resumePortal('org_acme')
    expect(calledUrl).toBe('/api/v1/security/portals/org_acme/resume')
    expect(resumed.status).toBe('active')
  })
})
