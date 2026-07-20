import { describe, it, expect, vi } from 'vitest'
import { createAccountSecurityClient } from './securityClient'
import { HttpError } from './http'

function mockFetch(status: number, body: unknown): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  ) as unknown as typeof fetch
}

describe('createAccountSecurityClient', () => {
  it('reads connections from the contract path with a bearer token', async () => {
    const fetchImpl = mockFetch(200, { providers: [{ provider: 'google' }], hasPassword: true })
    const client = createAccountSecurityClient({ fetchImpl, getToken: () => 'tok' })
    const res = await client.getConnections()
    expect(res.hasPassword).toBe(true)
    const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[0]).toBe('/api/v1/security/identity/connections')
    expect((call[1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer tok' })
  })

  it('counts active sessions from the items envelope', async () => {
    const fetchImpl = mockFetch(200, { items: [{ id: 'a', current: true }, { id: 'b', current: false }] })
    const client = createAccountSecurityClient({ fetchImpl })
    expect(await client.getActiveSessionCount!()).toBe(2)
  })

  it('surfaces a 409 as an HttpError with the fail-closed code', async () => {
    const fetchImpl = mockFetch(409, { error: 'last method', code: 'CONFLICT' })
    const client = createAccountSecurityClient({ fetchImpl })
    await expect(client.getMethods()).rejects.toMatchObject({
      constructor: HttpError,
      status: 409,
      code: 'CONFLICT',
    })
  })
})
