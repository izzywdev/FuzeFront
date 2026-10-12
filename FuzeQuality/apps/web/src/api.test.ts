// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, configurePlatformSecurity } from './api'

describe('FuzeQuality portal API identity context', () => {
  afterEach(() => {
    configurePlatformSecurity(undefined)
    delete (window as any).__FUZEFRONT__
    vi.unstubAllGlobals()
  })

  it('forwards the host token and membership-checked selected tenant', async () => {
    ;(window as any).__FUZEFRONT__ = {
      getContext: () => ({ tenantId: 'tenant-1', activeOrganization: null }),
    }
    configurePlatformSecurity(() => 'portal-token')
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      repositories: [], apiOperations: [], frontendSurfaces: [], testCases: [],
      requirements: [], expectations: [], coverage: [], findings: [], suggestions: [],
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await api.portfolio()

    const headers = new Headers(fetchMock.mock.calls[0][1].headers)
    expect(headers.get('authorization')).toBe('Bearer portal-token')
    expect(headers.get('x-fuzefront-tenant-id')).toBe('tenant-1')
  })
})
