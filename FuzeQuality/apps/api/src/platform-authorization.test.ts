import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NextFunction, Request, Response } from 'express'
import { fromUuid } from '@izzywdev/fuzefront-identity'
import { requestIdentity, requirePlatformAdminPermission, requirePlatformPermission } from './platform-authorization'

function responseDouble() {
  const response = {
    status: vi.fn(), json: vi.fn(),
  }
  response.status.mockReturnValue(response)
  response.json.mockReturnValue(response)
  return response as unknown as Response
}

function authenticatedRequest(token = 'caller-token') {
  return {
    header: vi.fn((name: string) => name === 'authorization' ? `Bearer ${token}` : undefined),
  } as unknown as Request
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
    const request = authenticatedRequest()
    const response = responseDouble()
    const next = vi.fn() as NextFunction

    await requirePlatformPermission('fuzequality_Repository', 'onboard')(request, response, next)

    expect(next).toHaveBeenCalledOnce()
    expect(requestIdentity(request)?.tenantId).toBe('tenant-1')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      subject: 'user-1', tenant: 'tenant-1', resource: { type: 'fuzequality_Repository' }, action: 'onboard',
    })
  })

  it('asks FuzeFront to prove the portal-selected tenant before authorizing', async () => {
    process.env.FUZEFRONT_SECURITY_URL = 'https://security.example'
    const tenantId = '0195a8f2-1234-7abc-8def-0123456789ab'
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ identity: { userId: 'user-1', tenantId } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ allow: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const request = {
      header: vi.fn((name: string) => name === 'authorization'
        ? 'Bearer caller-token'
        : name === 'x-fuzefront-tenant-id' ? tenantId : undefined),
    } as unknown as Request
    const response = responseDouble()
    const next = vi.fn() as NextFunction

    await requirePlatformPermission('fuzequality_Repository', 'read')(request, response, next)

    expect(next).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0][0].toString()).toBe(`https://security.example/api/v1/security/session?tenant=${tenantId}`)
    expect(requestIdentity(request)?.tenantId).toBe(tenantId)
  })

  it('accepts a prefixed portal organization when Security returns its canonical UUID', async () => {
    process.env.FUZEFRONT_SECURITY_URL = 'https://security.example'
    const tenantUuid = '0195a8f2-1234-7abc-8def-0123456789ab'
    const tenantWireId = fromUuid('organization', tenantUuid)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ identity: { userId: 'user-1', tenantId: tenantUuid } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ allow: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const request = {
      header: vi.fn((name: string) => name === 'authorization'
        ? 'Bearer caller-token'
        : name === 'x-fuzefront-tenant-id' ? tenantWireId : undefined),
    } as unknown as Request
    const response = responseDouble()
    const next = vi.fn() as NextFunction

    await requirePlatformPermission('fuzequality_Repository', 'read')(request, response, next)

    expect(next).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0][0].toString()).toBe(
      `https://security.example/api/v1/security/session?tenant=${tenantWireId}`,
    )
    expect(requestIdentity(request)?.tenantId).toBe(tenantUuid)
  })

  it('rejects a resolved tenant that does not match the active portal workspace', async () => {
    process.env.FUZEFRONT_SECURITY_URL = 'https://security.example'
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      identity: { userId: 'user-1', tenantId: '0195a8f2-1234-7abc-8def-0123456789ab' },
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const request = {
      header: vi.fn((name: string) => name === 'authorization'
        ? 'Bearer caller-token'
        : name === 'x-fuzefront-tenant-id' ? '0195a8f2-1234-7abc-8def-0123456789ac' : undefined),
    } as unknown as Request
    const response = responseDouble()
    const next = vi.fn() as NextFunction

    await requirePlatformPermission('fuzequality_Repository', 'read')(request, response, next)

    expect(next).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(response.status).toHaveBeenCalledWith(409)
    expect(response.json).toHaveBeenCalledWith({
      error: 'The resolved tenant does not match the active portal workspace',
      code: 'TENANT_CONTEXT_MISMATCH',
    })
  })

  it('fails closed when the security service is unavailable', async () => {
    process.env.FUZEFRONT_SECURITY_URL = 'https://security.example'
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('contains sensitive upstream detail')))
    const request = authenticatedRequest()
    const response = responseDouble()
    const next = vi.fn() as NextFunction

    await requirePlatformPermission('fuzequality_Repository', 'onboard')(request, response, next)

    expect(next).not.toHaveBeenCalled()
    expect(response.status).toHaveBeenCalledWith(503)
    expect(response.json).toHaveBeenCalledWith({ error: 'Platform security is unavailable', code: 'SECURITY_UNAVAILABLE' })
  })

  it('rejects a request that does not carry a bearer session', async () => {
    process.env.FUZEFRONT_SECURITY_URL = 'https://security.example'
    const request = { header: vi.fn().mockReturnValue(undefined) } as unknown as Request
    const response = responseDouble()
    const next = vi.fn() as NextFunction

    await requirePlatformPermission('fuzequality_Repository', 'read')(request, response, next)

    expect(next).not.toHaveBeenCalled()
    expect(response.status).toHaveBeenCalledWith(401)
    expect(response.json).toHaveBeenCalledWith({ error: 'Authentication required', code: 'IDENTITY_MISSING' })
  })

  it('rejects an expired or revoked platform session before requesting an authorization decision', async () => {
    process.env.FUZEFRONT_SECURITY_URL = 'https://security.example'
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)
    const request = authenticatedRequest('revoked-session')
    const response = responseDouble()
    const next = vi.fn() as NextFunction

    await requirePlatformPermission('fuzequality_Repository', 'read')(request, response, next)

    expect(next).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(response.status).toHaveBeenCalledWith(401)
    expect(response.json).toHaveBeenCalledWith({ error: 'Authentication required', code: 'IDENTITY_INVALID' })
  })

  it('preserves a failed selected-tenant membership proof as a forbidden response', async () => {
    process.env.FUZEFRONT_SECURITY_URL = 'https://security.example'
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 403 }))
    vi.stubGlobal('fetch', fetchMock)
    const request = {
      header: vi.fn((name: string) => name === 'authorization'
        ? 'Bearer caller-token'
        : name === 'x-fuzefront-tenant-id' ? 'tenant-without-membership' : undefined),
    } as unknown as Request
    const response = responseDouble()
    const next = vi.fn() as NextFunction

    await requirePlatformPermission('fuzequality_Repository', 'read')(request, response, next)

    expect(next).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(response.status).toHaveBeenCalledWith(403)
    expect(response.json).toHaveBeenCalledWith({
      error: 'Active tenant membership required',
      code: 'TENANT_FORBIDDEN',
    })
  })

  it('reports tenant proof service outages without downgrading them to invalid authentication', async () => {
    process.env.FUZEFRONT_SECURITY_URL = 'https://security.example'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })))
    const request = authenticatedRequest()
    const response = responseDouble()
    const next = vi.fn() as NextFunction

    await requirePlatformPermission('fuzequality_Repository', 'read')(request, response, next)

    expect(next).not.toHaveBeenCalled()
    expect(response.status).toHaveBeenCalledWith(503)
    expect(response.json).toHaveBeenCalledWith({
      error: 'Platform security is unavailable',
      code: 'SECURITY_UNAVAILABLE',
    })
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

    await requirePlatformPermission('fuzequality_Repository', 'read')(request, response, next)

    expect(next).toHaveBeenCalledOnce()
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ tenant: 'tenant-from-session' })
    expect(JSON.stringify(fetchMock.mock.calls[1][1].body)).not.toContain('other-tenant')
  })

  it('denies a session with no resolved tenant before calling the policy decision point', async () => {
    process.env.FUZEFRONT_SECURITY_URL = 'https://security.example'
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ identity: { userId: 'user-without-tenant' } }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const request = authenticatedRequest()
    const response = responseDouble()
    const next = vi.fn() as NextFunction

    await requirePlatformPermission('fuzequality_Repository', 'read')(request, response, next)

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
    const request = authenticatedRequest()
    const response = responseDouble()
    const next = vi.fn() as NextFunction

    await requirePlatformPermission('fuzequality_Repository', 'read')(request, response, next)

    expect(next).not.toHaveBeenCalled()
    expect(response.status).toHaveBeenCalledWith(403)
    expect(response.json).toHaveBeenCalledWith({ error: 'Authorization decision unavailable; denying', code: 'DECISION_UNAVAILABLE' })
  })

  it('allows an authorized FuzeFront platform administrator', async () => {
    process.env.FUZEFRONT_SECURITY_URL = 'https://security.example'
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ identity: { userId: 'admin-1', tenantId: 'tenant-1', roles: ['admin'] } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ allow: true }), { status: 200 })))
    const request = authenticatedRequest()
    const response = responseDouble()
    const next = vi.fn() as NextFunction

    await requirePlatformAdminPermission('fuzequality_PlatformAdministration', 'read')(request, response, next)

    expect(next).toHaveBeenCalledOnce()
    expect(requestIdentity(request)?.roles).toContain('admin')
  })

  it('denies a tenant administrator without the platform admin role', async () => {
    process.env.FUZEFRONT_SECURITY_URL = 'https://security.example'
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ identity: { userId: 'tenant-admin', tenantId: 'tenant-1', roles: ['owner'] } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ allow: true }), { status: 200 })))
    const request = authenticatedRequest()
    const response = responseDouble()
    const next = vi.fn() as NextFunction

    await requirePlatformAdminPermission('fuzequality_PlatformAdministration', 'read')(request, response, next)

    expect(next).not.toHaveBeenCalled()
    expect(response.status).toHaveBeenCalledWith(403)
    expect(response.json).toHaveBeenCalledWith({
      error: 'Platform administrator access required',
      code: 'PLATFORM_ADMIN_REQUIRED',
    })
  })
  it.each(['admin', 'not-admin', { admin: true }, [42], ['admin', null]])(
    'denies malformed platform roles %j before calling authorization',
    async roles => {
      process.env.FUZEFRONT_SECURITY_URL = 'https://security.example'
      const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
        identity: { userId: 'user-1', tenantId: 'tenant-1', roles },
      }), { status: 200 }))
      vi.stubGlobal('fetch', fetchMock)
      const request = { header: vi.fn().mockReturnValue('Bearer caller-token') } as unknown as Request
      const response = responseDouble()
      const next = vi.fn() as NextFunction

      await requirePlatformAdminPermission('quality_PlatformAdministration', 'read')(request, response, next)

      expect(next).not.toHaveBeenCalled()
      expect(fetchMock).toHaveBeenCalledOnce()
      expect(requestIdentity(request)).toBeUndefined()
      expect(response.status).toHaveBeenCalledWith(403)
      expect(response.json).toHaveBeenCalledWith({
        error: 'A valid platform identity is required', code: 'IDENTITY_MALFORMED',
      })
    },
  )

  it.each([
    { userId: 42, tenantId: 'tenant-1' },
    { userId: 'user-1', tenantId: { id: 'tenant-1' } },
    { userId: ' ', tenantId: 'tenant-1' },
    { userId: 'user-1', tenantId: ' ' },
  ])('denies malformed principal identifiers %j before calling authorization', async identity => {
    process.env.FUZEFRONT_SECURITY_URL = 'https://security.example'
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ identity }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const request = { header: vi.fn().mockReturnValue('Bearer caller-token') } as unknown as Request
    const response = responseDouble()
    const next = vi.fn() as NextFunction

    await requirePlatformPermission('quality_Repository', 'read')(request, response, next)

    expect(next).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(requestIdentity(request)).toBeUndefined()
    expect(response.status).toHaveBeenCalledWith(403)
    expect(response.json).toHaveBeenCalledWith({
      error: 'A tenant-scoped identity is required', code: 'TENANT_UNRESOLVED',
    })
  })

})
