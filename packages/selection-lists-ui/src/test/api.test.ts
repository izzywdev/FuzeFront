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
afterEach(() => vi.unstubAllGlobals())

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
