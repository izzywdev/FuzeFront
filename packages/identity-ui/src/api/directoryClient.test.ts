import { describe, it, expect, vi } from 'vitest'
import { createDirectoryClient, isDirectoryForbidden } from './directoryClient'
import { HttpError } from './http'

function mockFetch(body: unknown, status = 200, ok = status < 300) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    text: async () => JSON.stringify(body),
  } as Response)
}

describe('createDirectoryClient', () => {
  it('builds the offset-paginated, server-side-search query string', async () => {
    const fetchImpl = mockFetch({ items: [], page: 1, pageSize: 25, total: 0 })
    const client = createDirectoryClient({ fetchImpl })
    await client.listDirectory('org_root', { query: 'ada', limit: 25, offset: 50 })
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/organizations/org_root/directory?query=ada&limit=25&offset=50',
      expect.anything()
    )
  })

  it('omits query params that were not provided (first-page default fetch)', async () => {
    const fetchImpl = mockFetch({ items: [], page: 1, pageSize: 25, total: 0 })
    const client = createDirectoryClient({ fetchImpl })
    await client.listDirectory('org_root')
    expect(fetchImpl).toHaveBeenCalledWith('/api/organizations/org_root/directory', expect.anything())
  })

  it('encodes the organization id', async () => {
    const fetchImpl = mockFetch({ items: [], page: 1, pageSize: 25, total: 0 })
    const client = createDirectoryClient({ fetchImpl })
    await client.listDirectory('org/with slash')
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/organizations/org%2Fwith%20slash/directory',
      expect.anything()
    )
  })

  it('resolves the DirectoryPage envelope from the contract', async () => {
    const page = {
      items: [{ userId: 'usr_1', displayName: 'Ada Rowe', role: 'owner' as const, isSelf: true }],
      page: 1,
      pageSize: 25,
      total: 1,
    }
    const fetchImpl = mockFetch(page)
    const client = createDirectoryClient({ fetchImpl })
    await expect(client.listDirectory('org_root')).resolves.toEqual(page)
  })

  it('surfaces a non-2xx as an HttpError', async () => {
    const fetchImpl = mockFetch({ error: 'nope', code: 'FORBIDDEN' }, 403, false)
    const client = createDirectoryClient({ fetchImpl })
    const err = await client.listDirectory('org_root').catch((e) => e)
    expect(err).toBeInstanceOf(HttpError)
    expect(err).toMatchObject({ status: 403 })
  })
})

describe('isDirectoryForbidden', () => {
  it('is true only for a 403 HttpError', () => {
    expect(isDirectoryForbidden(new HttpError(403, 'nope', { code: 'FORBIDDEN' }))).toBe(true)
    expect(isDirectoryForbidden(new HttpError(500, 'boom', {}))).toBe(false)
    expect(isDirectoryForbidden(new Error('network'))).toBe(false)
    expect(isDirectoryForbidden(null)).toBe(false)
  })
})
