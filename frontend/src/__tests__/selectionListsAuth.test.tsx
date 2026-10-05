/**
 * selectionListsAuth — the shell's org-session-token exchange for
 * `@fuzeone/selection-lists-ui` (authorization review I-1b).
 *
 * `fetch` is the injected network boundary. The cases pin: same-origin relative
 * URL with the SESSION token as the credential, caching + refresh, single-flight,
 * no cross-account / cross-org reuse, fail-quiet, and that the hook installs the
 * provider before any child effect runs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { useEffect } from 'react'

const configure = vi.fn()
vi.mock('@fuzeone/selection-lists-ui', () => ({
  configureSelectionListsAuth: (...a: unknown[]) => configure(...a),
}))

let activeOrg: string | null = 'org-a'
vi.mock('../lib/shared', () => ({
  useOrganizations: () => ({ activeOrganizationId: activeOrg }),
}))
vi.mock('../lib/accounts', () => ({ getActiveAuthToken: () => 'session.tok' }))

import {
  createOrgSessionTokenProvider,
  FAILURE_BACKOFF_MS,
  useSelectionListsAuth,
} from '../lib/selectionListsAuth'

function ok(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response
}

function setup(over: Partial<Parameters<typeof createOrgSessionTokenProvider>[0]> = {}) {
  let t = 1_000_000
  const fetchImpl = vi.fn().mockResolvedValue(ok({ token: 'org.tok.1', expiresIn: 900 }))
  const getToken = createOrgSessionTokenProvider({
    getSessionToken: () => 'session.tok',
    getOrgId: () => 'org-a',
    fetchImpl: fetchImpl as unknown as typeof fetch,
    now: () => t,
    ...over,
  })
  return { fetchImpl, getToken, advance: (ms: number) => (t += ms) }
}

describe('createOrgSessionTokenProvider', () => {
  it('exchanges the session token at a same-origin relative URL, as a Bearer credential', async () => {
    const { fetchImpl, getToken } = setup()
    expect(await getToken()).toBe('org.tok.1')
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/organizations/org-a/session-token')
    expect(url).not.toMatch(/^https?:/)
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer session.tok')
  })

  it('URL-encodes the org id', async () => {
    const { fetchImpl, getToken } = setup({ getOrgId: () => 'a/b c' })
    await getToken()
    expect((fetchImpl.mock.calls[0] as [string])[0]).toBe('/api/organizations/a%2Fb%20c/session-token')
  })

  it('caches until one minute before expiry, then re-exchanges', async () => {
    const { fetchImpl, getToken, advance } = setup()
    await getToken()
    advance(800_000) // 800s < 900s - 60s
    await getToken()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    advance(60_000) // 860s >= refresh point (840s)
    fetchImpl.mockResolvedValueOnce(ok({ token: 'org.tok.2', expiresIn: 900 }))
    expect(await getToken()).toBe('org.tok.2')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('shares one in-flight exchange between concurrent callers', async () => {
    const { fetchImpl, getToken } = setup()
    const [a, b, c] = await Promise.all([getToken(), getToken(), getToken()])
    expect([a, b, c]).toEqual(['org.tok.1', 'org.tok.1', 'org.tok.1'])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('never reuses an org token across orgs or across accounts (session tokens)', async () => {
    let org = 'org-a'
    let session = 'session.A'
    const { fetchImpl, getToken } = setup({ getOrgId: () => org, getSessionToken: () => session })
    fetchImpl.mockResolvedValueOnce(ok({ token: 'for-A-org-a', expiresIn: 900 }))
    expect(await getToken()).toBe('for-A-org-a')
    org = 'org-b'
    fetchImpl.mockResolvedValueOnce(ok({ token: 'for-A-org-b', expiresIn: 900 }))
    expect(await getToken()).toBe('for-A-org-b')
    org = 'org-a'
    session = 'session.B'
    fetchImpl.mockResolvedValueOnce(ok({ token: 'for-B-org-a', expiresIn: 900 }))
    expect(await getToken()).toBe('for-B-org-a')
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('returns null without calling the network when there is no active org or no session', async () => {
    const noOrg = setup({ getOrgId: () => null })
    expect(await noOrg.getToken()).toBeNull()
    const noSession = setup({ getSessionToken: () => null })
    expect(await noSession.getToken()).toBeNull()
    expect(noOrg.fetchImpl).not.toHaveBeenCalled()
    expect(noSession.fetchImpl).not.toHaveBeenCalled()
  })

  it('fails quiet and does not cache a network error or a body with no token', async () => {
    const { fetchImpl, getToken } = setup()
    fetchImpl.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    expect(await getToken()).toBeNull()
    fetchImpl.mockResolvedValueOnce(ok({}))
    expect(await getToken()).toBeNull()
    // neither failure was remembered: the next call retries and succeeds
    fetchImpl.mockResolvedValueOnce(ok({ token: 'recovered', expiresIn: 900 }))
    expect(await getToken()).toBe('recovered')
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('backs off after a refusal instead of re-asking on every call (rate-limiter self-lockout)', async () => {
    // tokenAuthRateLimiter counts every non-2xx on /api/organizations/* per IP
    // (10/min). A page of selection-list calls with a stale active org must not
    // spend that budget: one refusal, then silence for FAILURE_BACKOFF_MS.
    const { fetchImpl, getToken, advance } = setup()
    fetchImpl.mockResolvedValue({ ok: false, status: 403, json: async () => ({}) } as Response)
    for (let i = 0; i < 20; i++) expect(await getToken()).toBeNull()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    advance(FAILURE_BACKOFF_MS - 1)
    expect(await getToken()).toBeNull()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    advance(1)
    fetchImpl.mockResolvedValueOnce(ok({ token: 'member-now', expiresIn: 900 }))
    expect(await getToken()).toBe('member-now')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('a refusal for one org does not block another org', async () => {
    let org = 'org-a'
    const { fetchImpl, getToken } = setup({ getOrgId: () => org })
    fetchImpl.mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({}) } as Response)
    expect(await getToken()).toBeNull()
    org = 'org-b'
    fetchImpl.mockResolvedValueOnce(ok({ token: 'for-org-b', expiresIn: 900 }))
    expect(await getToken()).toBe('for-org-b')
  })

  it('drops cached org tokens when the session changes (logout / account switch)', async () => {
    let session: string | null = 'session.A'
    const { fetchImpl, getToken } = setup({ getSessionToken: () => session })
    fetchImpl.mockResolvedValueOnce(ok({ token: 'for-A', expiresIn: 900 }))
    expect(await getToken()).toBe('for-A')
    session = null // logged out
    expect(await getToken()).toBeNull()
    session = 'session.A' // same session token again must NOT resurrect the old entry
    fetchImpl.mockResolvedValueOnce(ok({ token: 'for-A-again', expiresIn: 900 }))
    expect(await getToken()).toBe('for-A-again')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('does not cache a token with no usable lifetime (hands it to that caller only)', async () => {
    const { fetchImpl, getToken } = setup()
    fetchImpl.mockResolvedValue(ok({ token: 'short', expiresIn: 30 }))
    expect(await getToken()).toBe('short')
    expect(await getToken()).toBe('short')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})

describe('useSelectionListsAuth', () => {
  beforeEach(() => {
    configure.mockReset()
    activeOrg = 'org-a'
    cleanup()
  })

  it('installs the auth provider during render, i.e. BEFORE a child effect runs', () => {
    const order: string[] = []
    configure.mockImplementation((v: unknown) => order.push(v ? 'configured' : 'cleared'))
    function Child() {
      useEffect(() => {
        order.push('child-effect')
      }, [])
      return null
    }
    function Gate() {
      useSelectionListsAuth()
      return <Child />
    }
    render(<Gate />)
    expect(order.indexOf('configured')).toBeGreaterThanOrEqual(0)
    expect(order.indexOf('configured')).toBeLessThan(order.indexOf('child-effect'))
  })

  it('exposes an org-token getter and the session-token getter', async () => {
    function Gate() {
      useSelectionListsAuth()
      return null
    }
    render(<Gate />)
    const arg = configure.mock.calls.find(c => c[0])?.[0] as {
      getOrgToken: () => Promise<string | null>
      getSessionToken: () => string | null
    }
    expect(typeof arg.getOrgToken).toBe('function')
    expect(arg.getSessionToken()).toBe('session.tok')
  })

  it('clears the configuration on unmount', () => {
    function Gate() {
      useSelectionListsAuth()
      return null
    }
    const { unmount } = render(<Gate />)
    configure.mockClear()
    unmount()
    expect(configure).toHaveBeenCalledWith(undefined)
  })
})
