import { describe, expect, it } from 'vitest'
import { isPlatformAuthenticatedRequest, isPublicRequest } from './authentication'

describe('FuzeQuality API authentication allowlist', () => {
  it('allows the read-only portfolio used by the Cloudflare-protected web application', () => {
    expect(isPublicRequest('GET', '/api/v1/portfolio')).toBe(true)
  })

  it('does not allow portfolio mutations or privileged catalog operations', () => {
    expect(isPublicRequest('POST', '/api/v1/portfolio')).toBe(false)
    expect(isPublicRequest('GET', '/api/v1/repositories')).toBe(false)
    expect(isPublicRequest('POST', '/api/v1/repositories')).toBe(false)
    expect(isPublicRequest('POST', '/api/v1/repositories/id/scans')).toBe(false)
  })
})

describe('FuzeQuality platform-authenticated request allowlist', () => {
  it('passes repository requests to FuzeFront Security authorization', () => {
    expect(isPlatformAuthenticatedRequest('GET', '/api/v1/repositories')).toBe(true)
    expect(isPlatformAuthenticatedRequest('POST', '/api/v1/repositories/verify')).toBe(true)
    expect(isPlatformAuthenticatedRequest('POST', '/api/v1/repositories/id/scans')).toBe(true)
  })

  it('does not admit internal worker or unrelated unguarded routes', () => {
    expect(isPlatformAuthenticatedRequest('POST', '/api/v1/internal/scans/results')).toBe(false)
    expect(isPlatformAuthenticatedRequest('POST', '/api/v1/suggestions/id/decision')).toBe(false)
  })
})
