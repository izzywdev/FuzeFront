import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// authAPI.handleAuthCallback calls `api.post` where `api` is the module-level
// axios instance — the same object reference as the default export of ../services/api.
// We use vi.spyOn on the imported default to intercept calls made by the
// closed-over internal `api` variable (same object reference).
//
// Note: vi.mock('../services/api') with a factory that replaces `default` would
// NOT work here because the factory creates a new object, breaking the shared
// reference between the exported `api` and the closed-over `api` in authAPI methods.
// vi.spyOn modifies the property in-place, so both the export and the closure see
// the same spy.

import api, { authAPI } from '../services/api'

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, val: string) => { store[key] = val },
    removeItem: (key: string) => { delete store[key] },
    clear: () => { store = {} },
  }
})()
Object.defineProperty(global, 'localStorage', { value: localStorageMock })

// Mock window.location and history
const mockReplaceState = vi.fn()
Object.defineProperty(global, 'history', { value: { replaceState: mockReplaceState }, writable: true })

function setSearch(search: string) {
  Object.defineProperty(global, 'location', {
    value: { search, pathname: '/' },
    writable: true,
    configurable: true,
  })
}

describe('authAPI.handleAuthCallback', () => {
  beforeEach(() => {
    localStorageMock.clear()
    vi.clearAllMocks()
    // Spy on the shared axios instance's post method in-place.
    // vi.spyOn replaces api.post with a spy; since api is the same object
    // as the module-internal `api` const, this intercepts all calls.
    vi.spyOn(api, 'post')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('exchanges code for token and stores in localStorage', async () => {
    setSearch('?code=abc123')
    vi.mocked(api.post).mockResolvedValueOnce({
      data: { status: 'authenticated', token: 'jwt-token', sessionId: 'sess-1', user: {} }
    })

    const result = await authAPI.handleAuthCallback()

    expect(api.post).toHaveBeenCalledWith('/v1/security/session/exchange', { code: 'abc123' })
    expect(localStorageMock.getItem('authToken')).toBe('jwt-token')
    expect(localStorageMock.getItem('sessionId')).toBe('sess-1')
    expect(result).toEqual({
      result: { status: 'authenticated', token: 'jwt-token', sessionId: 'sess-1', user: {} }
    })
    expect(mockReplaceState).toHaveBeenCalled()
  })

  it('returns error from URL when error param present', async () => {
    setSearch('?error=oidc_error&message=access_denied')

    const result = await authAPI.handleAuthCallback()

    expect(result).toEqual({ error: 'access_denied' })
    expect(api.post).not.toHaveBeenCalled()
  })

  it('returns empty object when no params in URL', async () => {
    setSearch('')

    const result = await authAPI.handleAuthCallback()

    expect(result).toEqual({})
    expect(api.post).not.toHaveBeenCalled()
  })

  it('does not read token directly from URL', async () => {
    setSearch('?token=some-jwt&sessionId=sess')

    const result = await authAPI.handleAuthCallback()

    expect(result).toEqual({})
    expect(api.post).not.toHaveBeenCalled()
    expect(localStorageMock.getItem('authToken')).toBeNull()
  })
})
