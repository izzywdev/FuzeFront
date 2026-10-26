import { beforeEach, describe, expect, it, vi } from 'vitest'

const axiosDouble = vi.hoisted(() => {
  const get = vi.fn()
  const instance = {
    get,
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
  }
  return { get, instance }
})

vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => axiosDouble.instance),
    isAxiosError: vi.fn(() => false),
  },
}))

import { securitySessionAPI } from './api'

describe('securitySessionAPI personal tenant resolution', () => {
  beforeEach(() => axiosDouble.get.mockReset())

  it('proves the discovered personal workspace before returning its tenant', async () => {
    axiosDouble.get
      .mockResolvedValueOnce({
        data: {
          workspaces: [
            { id: 'org_personal', name: 'Personal', type: 'personal' },
            { id: 'org_company', name: 'Company', type: 'organization' },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: { identity: { tenantId: '0195a8f2-1234-7abc-8def-0123456789ab' } },
      })

    await expect(securitySessionAPI.resolvePersonalTenant()).resolves.toBe(
      '0195a8f2-1234-7abc-8def-0123456789ab'
    )
    expect(axiosDouble.get).toHaveBeenNthCalledWith(
      1,
      '/v1/security/session/workspaces'
    )
    expect(axiosDouble.get).toHaveBeenNthCalledWith(
      2,
      '/v1/security/session',
      { params: { tenant: 'org_personal' } }
    )
  })

  it('does not attempt proof when no personal workspace was discovered', async () => {
    axiosDouble.get.mockResolvedValueOnce({
      data: {
        workspaces: [
          { id: 'org_company', name: 'Company', type: 'organization' },
        ],
      },
    })

    await expect(securitySessionAPI.resolvePersonalTenant()).resolves.toBeNull()
    expect(axiosDouble.get).toHaveBeenCalledOnce()
  })

  it('fails closed when Security proof does not return a tenant identity', async () => {
    axiosDouble.get
      .mockResolvedValueOnce({
        data: {
          workspaces: [
            { id: 'org_personal', name: 'Personal', type: 'personal' },
          ],
        },
      })
      .mockResolvedValueOnce({ data: { identity: {} } })

    await expect(securitySessionAPI.resolvePersonalTenant()).rejects.toThrow(
      'Security did not return a tenant-scoped identity'
    )
  })
})
