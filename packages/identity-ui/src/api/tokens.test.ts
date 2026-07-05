import { describe, it, expect, vi } from 'vitest'
import { createTokensClient } from './tokens'

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'mock',
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  } as Response)
}

describe('tokens client', () => {
  it('listTokens GETs /api/tokens and unwraps { tokens }', async () => {
    const fetchImpl = mockFetch(200, { tokens: [{ id: 't1', name: 'a' }] })
    const client = createTokensClient({ fetchImpl, getToken: () => 'jwt' })
    const result = await client.listTokens()
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/tokens',
      expect.objectContaining({ method: 'GET' })
    )
    const [, init] = fetchImpl.mock.calls[0]
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer jwt' })
    expect(result).toEqual([{ id: 't1', name: 'a' }])
  })

  it('listOrgTokens GETs /api/organizations/:orgId/tokens and unwraps { tokens }', async () => {
    const fetchImpl = mockFetch(200, { tokens: [{ id: 't2' }] })
    const client = createTokensClient({ fetchImpl })
    const result = await client.listOrgTokens('org-1')
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/organizations/org-1/tokens',
      expect.objectContaining({ method: 'GET' })
    )
    expect(result).toEqual([{ id: 't2' }])
  })

  it('createToken POSTs /api/tokens with the body and returns the created token', async () => {
    const created = { id: 't3', token: 'ff_live_abc.def', token_prefix: 'abc', name: 'CI', scopes: ['App:read'], expires_at: null }
    const fetchImpl = mockFetch(201, created)
    const client = createTokensClient({ fetchImpl })
    const input = { name: 'CI', owner_type: 'user' as const, owner_id: 'u1', scopes: ['App:read'], expires_at: null }
    const result = await client.createToken(input)
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/tokens',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(input) })
    )
    expect(result).toEqual(created)
  })

  it('revokeToken DELETEs /api/tokens/:id', async () => {
    const fetchImpl = mockFetch(200, { message: 'Token revoked' })
    const client = createTokensClient({ fetchImpl })
    await client.revokeToken('t9')
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/tokens/t9',
      expect.objectContaining({ method: 'DELETE' })
    )
  })

  it('throws HttpError with the server error message on non-2xx', async () => {
    const fetchImpl = mockFetch(403, { error: 'Access denied' })
    const client = createTokensClient({ fetchImpl })
    await expect(client.revokeToken('t9')).rejects.toThrow('Access denied')
  })
})
