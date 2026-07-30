import { describe, expect, it } from 'vitest'
import { isPlatformAuthenticatedRequest, isPublicRequest } from './authentication'

describe('FuzeQuality API authentication allowlist', () => {
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
  })

  it('does not admit internal worker or unrelated unguarded routes', () => {
    expect(isPlatformAuthenticatedRequest('POST', '/api/v1/internal/scans/results')).toBe(false)
    expect(isPlatformAuthenticatedRequest('POST', '/api/v1/suggestions/id/decision')).toBe(false)
  })
})
