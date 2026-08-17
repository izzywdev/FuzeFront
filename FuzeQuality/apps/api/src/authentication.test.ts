import { describe, expect, it } from 'vitest'
import { isPlatformAuthenticatedRequest, isPublicRequest } from './authentication'

describe('FuzeQuality API authentication allowlist', () => {
  it('treats the operational surface as public', () => {
    // /health is matched EXACTLY, not by the '/health/' prefix rule — the two
    // are different strings to Express, and the kubelet, the nginx same-origin
    // proxy and the portal's reachability check all call the bare /health with
    // no token. The OpenAPI document is public for the same reason it is
    // unauthenticated everywhere in the family: it describes the shape of the
    // API, never any data held in it.
    expect(isPublicRequest('GET', '/health')).toBe(true)
    expect(isPublicRequest('GET', '/health/live')).toBe(true)
    expect(isPublicRequest('GET', '/health/ready')).toBe(true)
    expect(isPublicRequest('GET', '/openapi.yaml')).toBe(true)
    expect(isPublicRequest('GET', '/openapi.json')).toBe(true)
  })

  it('does not widen the allowlist beyond the operational surface', () => {
    // Guards against a lazier rule such as startsWith('/health') or
    // startsWith('/openapi'), which would also admit anything sharing the prefix.
    expect(isPublicRequest('GET', '/healthz-internal')).toBe(false)
    expect(isPublicRequest('GET', '/openapi.yaml.bak')).toBe(false)
  })

  it('does not treat the organization portfolio as public', () => {
    expect(isPublicRequest('GET', '/api/v1/portfolio')).toBe(false)
  })

  it('does not allow portfolio mutations or privileged catalog operations', () => {
    expect(isPublicRequest('POST', '/api/v1/portfolio')).toBe(false)
    expect(isPublicRequest('GET', '/api/v1/repositories')).toBe(false)
    expect(isPublicRequest('POST', '/api/v1/repositories')).toBe(false)
    expect(isPublicRequest('POST', '/api/v1/repositories/id/scans')).toBe(false)
  })
})

describe('FuzeQuality platform-authenticated request allowlist', () => {
  it('passes human routes to FuzeFront Security authorization', () => {
    expect(isPlatformAuthenticatedRequest('GET', '/api/v1/portfolio')).toBe(true)
    expect(isPlatformAuthenticatedRequest('GET', '/api/v1/repositories')).toBe(true)
    expect(isPlatformAuthenticatedRequest('POST', '/api/v1/repositories/verify')).toBe(true)
    expect(isPlatformAuthenticatedRequest('POST', '/api/v1/repositories/id/scans')).toBe(true)
    expect(isPlatformAuthenticatedRequest('POST', '/api/v1/test-implementations')).toBe(true)
    expect(isPlatformAuthenticatedRequest('GET', '/api/v1/requirements')).toBe(true)
    expect(isPlatformAuthenticatedRequest('GET', '/api/v1/admin/organizations')).toBe(true)
    expect(isPlatformAuthenticatedRequest('POST', '/api/v1/admin/organizations/tenant-a/context')).toBe(true)
    expect(isPlatformAuthenticatedRequest('POST', '/api/v1/suggestions/id/decision')).toBe(true)
    expect(isPlatformAuthenticatedRequest('GET', '/api/v1/organization/members')).toBe(true)
    expect(isPlatformAuthenticatedRequest('POST', '/api/v1/organization/invitations')).toBe(true)
    expect(isPlatformAuthenticatedRequest('PUT', '/api/v1/organization/members/member-1')).toBe(true)
    expect(isPlatformAuthenticatedRequest('DELETE', '/api/v1/organization/members/member-1')).toBe(true)
    expect(isPlatformAuthenticatedRequest('PATCH', '/api/v1/repositories/repo-1/administration')).toBe(true)
  })

  it('does not admit internal worker or unrelated unguarded routes', () => {
    expect(isPlatformAuthenticatedRequest('POST', '/api/v1/internal/scans/results')).toBe(false)
    expect(isPlatformAuthenticatedRequest('POST', '/api/v1/unscoped-operation')).toBe(false)
  })
})
