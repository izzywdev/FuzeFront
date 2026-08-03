import { describe, it, expect, vi, afterEach } from 'vitest'
import { HttpClient, HttpError } from './http'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('HttpClient — fetch binding', () => {
  it('invokes the global fetch with the correct receiver (no "Illegal invocation")', async () => {
    // Reproduce the browser contract: the native `fetch` throws a TypeError
    // when called with a receiver other than the global object. The bug was
    // storing the bare `globalThis.fetch` on the instance and calling it as
    // `this.fetchImpl(...)`, which re-bound `this` to the HttpClient.
    const nativeLike = function (this: unknown, _input: string, _init?: RequestInit) {
      if (this !== globalThis && this !== undefined) {
        throw new TypeError(
          "Failed to execute 'fetch' on 'Window': Illegal invocation"
        )
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => JSON.stringify({ ok: true }),
      } as Response)
    }
    vi.stubGlobal('fetch', nativeLike)

    // No injected fetchImpl → falls back to the (bound) global fetch.
    const client = new HttpClient({ baseUrl: '' })
    await expect(client.get('/api/organizations/org-1/members')).resolves.toEqual({
      ok: true,
    })
  })

  it('surfaces a non-OK response as an HttpError carrying the backend error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      text: async () => JSON.stringify({ error: 'Insufficient permissions' }),
    } as Response)
    const client = new HttpClient({ fetchImpl })
    const err = await client.get('/api/organizations/org-1/members').catch((e) => e)
    expect(err).toBeInstanceOf(HttpError)
    expect(err).toMatchObject({ status: 403, message: 'Insufficient permissions' })
  })

  it('attaches the bearer token and JSON body on writes', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => '',
    } as Response)
    const client = new HttpClient({ fetchImpl, getToken: () => 'tok-123' })
    await client.post('/api/organizations/org-1/invitations', { email: 'a@b.c', role: 'member' })
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/organizations/org-1/invitations',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'a@b.c', role: 'member' }),
        headers: expect.objectContaining({
          Authorization: 'Bearer tok-123',
          'Content-Type': 'application/json',
        }),
      })
    )
  })
})
