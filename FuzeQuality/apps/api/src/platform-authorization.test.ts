import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NextFunction, Request, Response } from 'express'
import { requestIdentity, requirePlatformPermission } from './platform-authorization'

function responseDouble() {
  const response = {
    status: vi.fn(), json: vi.fn(),
  }
  response.status.mockReturnValue(response)
  response.json.mockReturnValue(response)
  return response as unknown as Response
}

describe('FQ-18 platform authorization', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.FUZEFRONT_SECURITY_URL
  })

  it('derives tenant scope from the FuzeFront session and checks product permission', async () => {
    process.env.FUZEFRONT_SECURITY_URL = 'https://security.example'
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ identity: { userId: 'user-1', tenantId: 'tenant-1' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ allow: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const request = { header: vi.fn().mockReturnValue('Bearer caller-token') } as unknown as Request
    const response = responseDouble()
    const next = vi.fn() as NextFunction

    await requirePlatformPermission('fuzequality.repository', 'create')(request, response, next)

    expect(next).toHaveBeenCalledOnce()
    expect(requestIdentity(request)?.tenantId).toBe('tenant-1')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      subject: 'user-1', tenant: 'tenant-1', resource: { type: 'fuzequality.repository' }, action: 'create',
    })
  })

  it('fails closed when the security service is unavailable', async () => {
    process.env.FUZEFRONT_SECURITY_URL = 'https://security.example'
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('contains sensitive upstream detail')))
    const request = { header: vi.fn().mockReturnValue('Bearer caller-token') } as unknown as Request
    const response = responseDouble()
    const next = vi.fn() as NextFunction

    await requirePlatformPermission('fuzequality.repository', 'create')(request, response, next)

    expect(next).not.toHaveBeenCalled()
    expect(response.status).toHaveBeenCalledWith(503)
    expect(response.json).toHaveBeenCalledWith({ error: 'Platform security is unavailable', code: 'SECURITY_UNAVAILABLE' })
  })
})
