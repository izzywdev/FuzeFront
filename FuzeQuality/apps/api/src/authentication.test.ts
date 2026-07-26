import { describe, expect, it } from 'vitest'
import { isPublicRequest } from './authentication'

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
