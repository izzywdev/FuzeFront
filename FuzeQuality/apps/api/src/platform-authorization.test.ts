import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NextFunction, Request, Response } from 'express'
import { requestIdentity, requirePlatformAdminPermission, requirePlatformPermission } from './platform-authorization'

function responseDouble() {
  const response = {
    status: vi.fn(), json: vi.fn(),
  }
  response.status.mockReturnValue(response)
  response.json.mockReturnValue(response)
  return response as unknown as Response
}

describe('FQ-69 platform authorization', () => {
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

    await requirePlatformPermission('quality_Repository', 'onboard')(request, response, next)

    expect(next).toHaveBeenCalledOnce()
    expect(requestIdentity(request)?.tenantId).toBe('tenant-1')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      subject: 'user-1', tenant: 'tenant-1', resource: { type: 'quality_Repository' }, action: 'onboard',
    })
  })

  it('fails closed when the security service is unavailable', async () => {
    process.env.FUZEFRONT_SECURITY_URL = 'https://security.example'
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('contains sensitive upstream detail')))
    const request = { header: vi.fn().mockReturnValue('Bearer caller-token') } as unknown as Request
    const response = responseDouble()
    const next = vi.fn() as NextFunction

    await requirePlatformPermission('quality_Repository', 'onboard')(request, response, next)

    expect(next).not.toHaveBeenCalled()
    expect(response.status).toHaveBeenCalledWith(503)
    expect(response.json).toHaveBeenCalledWith({ error: 'Platform security is unavailable', code: 'SECURITY_UNAVAILABLE' })
  })

  it('rejects a request that does not carry a bearer session', async () => {
    process.env.FUZEFRONT_SECURITY_URL = 'https://security.example'
    const request = { header: vi.fn().mockReturnValue(undefined) } as unknown as Request
    const response = responseDouble()
    const next = vi.fn() as NextFunction

    await requirePlatformPermission('quality_Repository', 'read')(request, response, next)

    expect(next).not.toHaveBeenCalled()
    expect(response.status).toHaveBeenCalledWith(401)
    expect(response.json).toHaveBeenCalledWith({ error: 'Authentication required', code: 'IDENTITY_MISSING' })
  })

  it('rejects an expired or revoked platform session before requesting an authorization decision', async () => {
    process.env.FUZEFRONT_SECURITY_URL = 'https://security.example'
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)
    const request = { header: vi.fn().mockReturnValue('Bearer revoked-session') } as unknown as Request
    const response = responseDouble()
    const next = vi.fn() as NextFunction

    await requirePlatformPermission('quality_Repository', 'read')(request, response, next)

    expect(next).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(response.status).toHaveBeenCalledWith(401)
    expect(response.json).toHaveBeenCalledWith({ error: 'Authentication required', code: 'IDENTITY_INVALID' })
  })

  it('uses the tenant resolved by FuzeFront and never a caller-supplied tenant header', async () => {
    process.env.FUZEFRONT_SECURITY_URL = 'https://security.example'
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ identity: { userId: 'user-1', tenantId: 'tenant-from-session' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ allow: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const request = {
      header: vi.fn((name: string) => name === 'authorization' ? 'Bearer caller-token' : undefined),
      get: vi.fn((name: string) => name === 'x-tenant-id' ? 'other-tenant' : undefined),
    } as unknown as Request
    const response = responseDouble()
    const next = vi.fn() as NextFunction

    await requirePlatformPermission('quality_Repository', 'read')(request, response, next)

    expect(next).toHaveBeenCalledOnce()
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ tenant: 'tenant-from-session' })
    expect(JSON.stringify(fetchMock.mock.calls[1][1].body)).not.toContain('other-tenant')
  })

  it('denies a session with no resolved tenant before calling the policy decision point', async () => {
    process.env.FUZEFRONT_SECURITY_URL = 'https://security.example'
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ identity: { userId: 'user-without-tenant' } }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const request = { header: vi.fn().mockReturnValue('Bearer caller-token') } as unknown as Request
    const response = responseDouble()
    const next = vi.fn() as NextFunction

    await requirePlatformPermission('quality_Repository', 'read')(request, response, next)

    expect(next).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(response.status).toHaveBeenCalledWith(403)
    expect(response.json).toHaveBeenCalledWith({ error: 'A tenant-scoped identity is required', code: 'TENANT_UNRESOLVED' })
  })

  it('fails closed when FuzeFront cannot provide a policy decision', async () => {
    process.env.FUZEFRONT_SECURITY_URL = 'https://security.example'
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ identity: { userId: 'user-1', tenantId: 'tenant-1' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 })))
    const request = { header: vi.fn().mockReturnValue('Bearer caller-token') } as unknown as Request
    const response = responseDouble()
    const next = vi.fn() as NextFunction

    await requirePlatformPermission('quality_Repository', 'read')(request, response, next)

    expect(next).not.toHaveBeenCalled()
    expect(response.status).toHaveBeenCalledWith(403)
    expect(response.json).toHaveBeenCalledWith({ error: 'Authorization decision unavailable; denying', code: 'DECISION_UNAVAILABLE' })
  })

  it('allows an authorized FuzeFront platform administrator', async () => {
    process.env.FUZEFRONT_SECURITY_URL = 'https://security.example'
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ identity: { userId: 'admin-1', tenantId: 'tenant-1', roles: ['admin'] } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ allow: true }), { status: 200 })))
    const request = { header: vi.fn().mockReturnValue('Bearer caller-token') } as unknown as Request
    const response = responseDouble()
    const next = vi.fn() as NextFunction

    await requirePlatformAdminPermission('quality_PlatformAdministration', 'read')(request, response, next)

    expect(next).toHaveBeenCalledOnce()
    expect(requestIdentity(request)?.roles).toContain('admin')
  })

  it('denies a tenant administrator without the platform admin role', async () => {
    process.env.FUZEFRONT_SECURITY_URL = 'https://security.example'
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ identity: { userId: 'tenant-admin', tenantId: 'tenant-1', roles: ['owner'] } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ allow: true }), { status: 200 })))
    const request = { header: vi.fn().mockReturnValue('Bearer caller-token') } as unknown as Request
    const response = responseDouble()
    const next = vi.fn() as NextFunction

    await requirePlatformAdminPermission('quality_PlatformAdministration', 'read')(request, response, next)

    expect(next).not.toHaveBeenCalled()
    expect(response.status).toHaveBeenCalledWith(403)
    expect(response.json).toHaveBeenCalledWith({
      error: 'Platform administrator access required',
      code: 'PLATFORM_ADMIN_REQUIRED',
    })
  })
})
