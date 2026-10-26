/**
 * findOrCreateUserPk — the single `name` is forwarded 1:1 to the identity
 * store's `name` field (no first+last join). Authentik is stubbed via
 * global.fetch; no network.
 */
jest.mock('../src/providers/authentik/tenants', () => ({
  currentTenant: () => ({ baseUrl: 'http://auth.example.test', issuerUrl: 'http://auth.example.test/application/o/x/', adminToken: 'admin-tok' }),
}))

import { findOrCreateUserPk } from '../src/providers/authentik/accountApi'

function res(status: number, json: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => json, text: async () => JSON.stringify(json) } as unknown as Response
}

describe('findOrCreateUserPk name mapping', () => {
  const realFetch = global.fetch
  let fetchMock: jest.Mock
  beforeEach(() => {
    fetchMock = jest.fn()
    ;(global as any).fetch = fetchMock
  })
  afterEach(() => {
    ;(global as any).fetch = realFetch
  })

  /** lookup misses, create succeeds -> return the JSON body POSTed to create. */
  async function createdBody(name?: string) {
    fetchMock.mockResolvedValueOnce(res(200, { results: [] })).mockResolvedValueOnce(res(201, { pk: 7 }))
    await expect(findOrCreateUserPk('u@example.com', name)).resolves.toBe(7)
    return JSON.parse(fetchMock.mock.calls[1][1].body)
  }

  it.each([['王 小明'], ['Sukarno'], ['محمد علي']])('forwards %s verbatim as `name`', async (name) => {
    expect((await createdBody(name)).name).toBe(name)
  })

  it('trims surrounding whitespace', async () => {
    expect((await createdBody('  Ada Lovelace ')).name).toBe('Ada Lovelace')
  })

  it.each([[undefined], [''], ['  ']])('falls back to the email when name is %j', async (name) => {
    expect((await createdBody(name as string | undefined)).name).toBe('u@example.com')
  })

  it('does not create when the user already exists', async () => {
    fetchMock.mockResolvedValueOnce(res(200, { results: [{ pk: 3, email: 'U@Example.com' }] }))
    await expect(findOrCreateUserPk('u@example.com', 'Whoever')).resolves.toBe(3)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
