/**
 * api.ts — the same-origin REST client every flow sits on. `fetch` is stubbed
 * (this is the real network boundary); nothing here talks to a server.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as api from '../api'

const fetchMock = vi.fn()

function json(body: unknown, status = 200, statusText = 'OK') {
  return { ok: status >= 200 && status < 300, status, statusText, json: async () => body } as Response
}
const lastCall = () => fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [string, RequestInit | undefined]

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('same-origin base + request shaping', () => {
  it('never uses an absolute host', async () => {
    fetchMock.mockResolvedValue(json({ data: [] }))
    await api.listSelectionLists()
    expect(lastCall()[0]).toBe('/api/v1/selection-lists')
    expect(lastCall()[0]).not.toMatch(/^https?:/)
  })

  it('sends cursor and status as query params when given', async () => {
    fetchMock.mockResolvedValue(json({ data: [] }))
    await api.listSelectionLists({ cursor: 'c1', status: 'archived' })
    expect(lastCall()[0]).toBe('/api/v1/selection-lists?cursor=c1&status=archived')
  })

  it('sends the contract `key` filter (exact-match lookup by list key)', async () => {
    fetchMock.mockResolvedValue(json({ items: [], page: { hasMore: false } }))
    await api.listSelectionLists({ key: 'sales-regions' })
    expect(lastCall()[0]).toBe('/api/v1/selection-lists?key=sales-regions')
  })

  it('combines key with cursor/status and URL-encodes it', async () => {
    fetchMock.mockResolvedValue(json({ items: [] }))
    await api.listSelectionLists({ key: 'a b', status: 'all' })
    expect(lastCall()[0]).toBe('/api/v1/selection-lists?status=all&key=a+b')
  })

  it('omits an empty key', async () => {
    fetchMock.mockResolvedValue(json({ items: [] }))
    await api.listSelectionLists({ key: '' })
    expect(lastCall()[0]).toBe('/api/v1/selection-lists')
  })

  it('omits empty/null cursor', async () => {
    fetchMock.mockResolvedValue(json({ data: [] }))
    await api.listSelectionLists({ cursor: null })
    expect(lastCall()[0]).toBe('/api/v1/selection-lists')
  })

  it('create posts only the supplied body (no id) as JSON', async () => {
    fetchMock.mockResolvedValue(json({ id: 'sl_1' }, 201))
    await api.createSelectionList({ key: 'k', source_locale: 'en' })
    const [url, init] = lastCall()
    expect(url).toBe('/api/v1/selection-lists')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({ key: 'k', source_locale: 'en' })
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json')
  })

  it.each([
    ['getSelectionList', () => api.getSelectionList('sl_1'), '/api/v1/selection-lists/sl_1', undefined],
    ['listItems', () => api.listItems('sl_1', { cursor: 'x' }), '/api/v1/selection-lists/sl_1/items?cursor=x', undefined],
    ['createItem', () => api.createItem('sl_1', { code: 'A', label: 'a' }), '/api/v1/selection-lists/sl_1/items', 'POST'],
    ['updateItem', () => api.updateItem('sl_1', 'sli_1', { label: 'b' }), '/api/v1/selection-lists/sl_1/items/sli_1', 'PATCH'],
    ['archiveItem', () => api.archiveItem('sl_1', 'sli_1'), '/api/v1/selection-lists/sl_1/items/sli_1/archive', 'POST'],
    ['purgeItem', () => api.purgeItem('sl_1', 'sli_1'), '/api/v1/selection-lists/sl_1/items/sli_1', 'DELETE'],
    ['reorderItems', () => api.reorderItems('sl_1', ['a', 'b']), '/api/v1/selection-lists/sl_1/items/reorder', 'PUT'],
    ['getQuota', () => api.getQuota(), '/api/v1/selection-lists/quota', undefined],
    ['getLocaleIndex', () => api.getLocaleIndex('sl_1'), '/api/v1/selection-lists/sl_1/translations', undefined],
    ['getLocaleEditor', () => api.getLocaleEditor('sl_1', 'fr'), '/api/v1/selection-lists/sl_1/translations/fr', undefined],
    ['saveTranslation', () => api.saveTranslation('sl_1', 'sli_1', 'fr', { label: 'x' }), '/api/v1/selection-lists/sl_1/items/sli_1/translations/fr', 'PUT'],
    ['autofillTranslations', () => api.autofillTranslations('sl_1', 'fr', { overwrite_machine: false }), '/api/v1/selection-lists/sl_1/translations/fr/autofill', 'POST'],
    ['getAccessGrants', () => api.getAccessGrants('sl_1'), '/api/v1/selection-lists/sl_1/access', undefined],
    ['updateAccessGrant', () => api.updateAccessGrant('sl_1', 'u1', { role: 'list-viewer' }), '/api/v1/selection-lists/sl_1/access/u1', 'PUT'],
    ['revokeAccessGrant', () => api.revokeAccessGrant('sl_1', 'u1'), '/api/v1/selection-lists/sl_1/access/u1', 'DELETE'],
    ['resolveItems', () => api.resolveItems(['a']), '/api/v1/resolve', 'POST'],
  ])('%s hits the contract endpoint', async (_n, call, url, method) => {
    fetchMock.mockResolvedValue(json({}))
    await call()
    expect(lastCall()[0]).toBe(url)
    expect(lastCall()[1]?.method).toBe(method)
  })

  it('reorder sends the full permutation as item_ids; resolve sends ids', async () => {
    fetchMock.mockResolvedValue(json({}))
    await api.reorderItems('sl_1', ['b', 'a', 'c'])
    expect(JSON.parse(lastCall()[1]?.body as string)).toEqual({ item_ids: ['b', 'a', 'c'] })
    await api.resolveItems(['x', 'y'])
    expect(JSON.parse(lastCall()[1]?.body as string)).toEqual({ ids: ['x', 'y'] })
  })

  it('treats 204 No Content as success without parsing a body', async () => {
    const res = { ok: true, status: 204, statusText: 'No Content', json: vi.fn() } as unknown as Response
    fetchMock.mockResolvedValue(res)
    await expect(api.archiveItem('sl_1', 'sli_1')).resolves.toBeUndefined()
    expect(res.json).not.toHaveBeenCalled()
  })
})

describe('authentication (authz review I-1b)', () => {
  const headersOf = (call: [string, RequestInit | undefined]) =>
    (call[1]?.headers ?? {}) as Record<string, string>

  afterEach(() => api.configureSelectionListsAuth(undefined))

  it('sends no Authorization header until the host configures auth', async () => {
    fetchMock.mockResolvedValue(json({}))
    await api.getQuota()
    expect(headersOf(lastCall())['Authorization']).toBeUndefined()
  })

  it('attaches the ORG-scoped token to selection-list and resolve calls', async () => {
    api.configureSelectionListsAuth({ getOrgToken: async () => 'org.tok', getSessionToken: () => 'sess.tok' })
    fetchMock.mockResolvedValue(json({}))
    await api.listSelectionLists()
    expect(headersOf(lastCall())['Authorization']).toBe('Bearer org.tok')
    await api.createSelectionList({ key: 'k', source_locale: 'en' })
    expect(headersOf(lastCall())['Authorization']).toBe('Bearer org.tok')
    expect(headersOf(lastCall())['Content-Type']).toBe('application/json')
    await api.resolveItems(['a'])
    expect(headersOf(lastCall())['Authorization']).toBe('Bearer org.tok')
  })

  it('sends the plain SESSION token (not the org token) to the host-backend user search', async () => {
    api.configureSelectionListsAuth({ getOrgToken: async () => 'org.tok', getSessionToken: () => 'sess.tok' })
    fetchMock.mockResolvedValue(json([]))
    await api.searchUsers('ann')
    expect(lastCall()[0]).toBe('/api/v1/users?search=ann')
    expect(headersOf(lastCall())['Authorization']).toBe('Bearer sess.tok')
  })

  it('attaches the org token to the HEAD reorder probe too', async () => {
    api.configureSelectionListsAuth({ getOrgToken: () => 'org.tok' })
    fetchMock.mockResolvedValue({ status: 204 } as Response)
    await api.probeReorderPermission('sl_1')
    expect(lastCall()[1]?.method).toBe('HEAD')
    expect(headersOf(lastCall())['Authorization']).toBe('Bearer org.tok')
  })

  it('asks for the token on EVERY request (the active org can change between calls)', async () => {
    const getOrgToken = vi.fn().mockResolvedValueOnce('org.a').mockResolvedValueOnce('org.b')
    api.configureSelectionListsAuth({ getOrgToken })
    fetchMock.mockResolvedValue(json({}))
    await api.getQuota()
    expect(headersOf(lastCall())['Authorization']).toBe('Bearer org.a')
    await api.getQuota()
    expect(headersOf(lastCall())['Authorization']).toBe('Bearer org.b')
  })

  it('sends no credential when there is no active org (null token) or resolution throws', async () => {
    fetchMock.mockResolvedValue(json({}))
    api.configureSelectionListsAuth({ getOrgToken: async () => null })
    await api.getQuota()
    expect(headersOf(lastCall())['Authorization']).toBeUndefined()
    api.configureSelectionListsAuth({
      getOrgToken: async () => {
        throw new Error('exchange failed')
      },
    })
    await api.getQuota()
    expect(headersOf(lastCall())['Authorization']).toBeUndefined()
  })

  it('stays same-origin: configuring auth never changes the request URL', async () => {
    api.configureSelectionListsAuth({ getOrgToken: async () => 'org.tok' })
    fetchMock.mockResolvedValue(json({}))
    await api.getQuota()
    expect(lastCall()[0]).toBe('/api/v1/selection-lists/quota')
  })
})

describe('error shaping', () => {
  it('throws an Error carrying the service code/message/scope and HTTP status', async () => {
    fetchMock.mockResolvedValue(
      json({ code: 'QUOTA_EXCEEDED', message: 'full', scope: 'org_lists', current: 5, limit: 5 }, 403, 'Forbidden'),
    )
    const err = await api.createSelectionList({ key: 'k', source_locale: 'en' }).catch(e => e)
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe('full')
    expect(err).toMatchObject({ code: 'QUOTA_EXCEEDED', scope: 'org_lists', current: 5, limit: 5, status: 403 })
  })

  it('falls back to UNKNOWN + statusText when the error body is not JSON', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      json: async () => {
        throw new SyntaxError('not json')
      },
    } as unknown as Response)
    const err = await api.getQuota().catch(e => e)
    expect(err.message).toBe('Bad Gateway')
    expect(err).toMatchObject({ code: 'UNKNOWN', status: 502 })
  })

  it('propagates a network failure untouched', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(api.getQuota()).rejects.toThrow('Failed to fetch')
  })
})

describe('searchUsers', () => {
  const U = { id: 'u1', name: 'Una', email: 'u@x.io' }

  it('url-encodes the query and accepts a bare array', async () => {
    fetchMock.mockResolvedValue(json([U]))
    await expect(api.searchUsers('a b&c')).resolves.toEqual([U])
    expect(lastCall()[0]).toBe('/api/v1/users?search=a+b%26c')
  })

  it('accepts a { users } envelope, and tolerates a missing users key', async () => {
    fetchMock.mockResolvedValue(json({ users: [U] }))
    await expect(api.searchUsers('u')).resolves.toEqual([U])
    fetchMock.mockResolvedValue(json({}))
    await expect(api.searchUsers('u')).resolves.toEqual([])
  })
})

describe('probeReorderPermission (HEAD)', () => {
  it('is false only on 403', async () => {
    fetchMock.mockResolvedValue({ status: 403 } as Response)
    await expect(api.probeReorderPermission('sl_1')).resolves.toBe(false)
    expect(lastCall()[0]).toBe('/api/v1/selection-lists/sl_1/items/reorder')
    expect(lastCall()[1]?.method).toBe('HEAD')
  })

  it.each([200, 204, 404, 405])('is true on %i', async status => {
    fetchMock.mockResolvedValue({ status } as Response)
    await expect(api.probeReorderPermission('sl_1')).resolves.toBe(true)
  })

  it('fails open on a network error', async () => {
    fetchMock.mockRejectedValue(new TypeError('offline'))
    await expect(api.probeReorderPermission('sl_1')).resolves.toBe(true)
  })
})

describe('paged-envelope helpers', () => {
  it('unwrapItems prefers data, then items, then []', () => {
    expect(api.unwrapItems({ data: [1], items: [2] })).toEqual([1])
    expect(api.unwrapItems({ items: [2] })).toEqual([2])
    expect(api.unwrapItems({})).toEqual([])
  })

  it('unwrapCursor reads next_cursor, then page.nextCursor, then null', () => {
    expect(api.unwrapCursor({ next_cursor: 'a', page: { nextCursor: 'b' } })).toBe('a')
    expect(api.unwrapCursor({ page: { nextCursor: 'b' } })).toBe('b')
    expect(api.unwrapCursor({ page: { hasMore: false } })).toBeNull()
    expect(api.unwrapCursor({})).toBeNull()
  })
})

describe('resolveItems — POST /v1/resolve (contract: ids in, results map + missing out)', () => {
  const RESOLVED = (label: string, status: 'active' | 'archived' = 'active') => ({
    label,
    locale: 'en',
    is_machine: false,
    status,
  })
  const bodyOf = (callIndex: number) =>
    JSON.parse((fetchMock.mock.calls[callIndex][1] as RequestInit).body as string) as { ids: string[] }

  it('normalises the contract `results` map to resolved[] carrying each id, plus missing', async () => {
    fetchMock.mockResolvedValue(
      json({ results: { sli_a: RESOLVED('Mango'), sli_old: RESOLVED('Old', 'archived') }, missing: ['sli_gone'] }),
    )
    const res = await api.resolveItems(['sli_a', 'sli_old', 'sli_gone'])
    expect(res.resolved).toEqual([
      { id: 'sli_a', ...RESOLVED('Mango') },
      { id: 'sli_old', ...RESOLVED('Old', 'archived') },
    ])
    expect(res.missing).toEqual(['sli_gone'])
  })

  it('still accepts a legacy resolved[] body', async () => {
    fetchMock.mockResolvedValue(json({ resolved: [{ id: 'sli_a', ...RESOLVED('Mango') }], missing: [] }))
    const res = await api.resolveItems(['sli_a'])
    expect(res.resolved).toEqual([{ id: 'sli_a', ...RESOLVED('Mango') }])
  })

  it('sends a whole batch in ONE call, de-duplicated (ids are uniqueItems)', async () => {
    fetchMock.mockResolvedValue(json({ results: {}, missing: [] }))
    await api.resolveItems(['a', 'b', 'a', 'c'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(bodyOf(0)).toEqual({ ids: ['a', 'b', 'c'] })
  })

  it('makes no call for an empty batch (the contract requires >= 1 id)', async () => {
    await expect(api.resolveItems([])).resolves.toEqual({ resolved: [], missing: [] })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('exactly the contract cap (500) is still ONE call', async () => {
    fetchMock.mockResolvedValue(json({ results: {}, missing: [] }))
    const ids = Array.from({ length: api.RESOLVE_MAX_IDS }, (_, i) => `sli_${i}`)
    await api.resolveItems(ids)
    expect(api.RESOLVE_MAX_IDS).toBe(500)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(bodyOf(0).ids).toHaveLength(500)
  })

  it('splits only a batch over the 500-id cap, and merges the answers', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ results: { sli_0: RESOLVED('Zero') }, missing: [] }))
      .mockResolvedValueOnce(json({ results: {}, missing: ['sli_500'] }))
    const ids = Array.from({ length: 501 }, (_, i) => `sli_${i}`)
    const res = await api.resolveItems(ids)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(bodyOf(0).ids).toHaveLength(500)
    expect(bodyOf(1).ids).toEqual(['sli_500'])
    expect(res.resolved).toEqual([{ id: 'sli_0', ...RESOLVED('Zero') }])
    expect(res.missing).toEqual(['sli_500'])
  })

  it('tolerates a body with neither results nor missing', async () => {
    fetchMock.mockResolvedValue(json({}))
    await expect(api.resolveItems(['a'])).resolves.toEqual({ resolved: [], missing: [] })
  })

  it('surfaces a 401 (no token / no org claim) as an error carrying the status', async () => {
    fetchMock.mockResolvedValue(json({ code: 'UNAUTHORIZED', message: 'no token' }, 401, 'Unauthorized'))
    await expect(api.resolveItems(['a'])).rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED' })
  })
})
