/**
 * api.ts — the same-origin REST client every flow sits on. `fetch` is stubbed
 * (this is the real network boundary); nothing here talks to a server.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { TranslationLocaleStatus } from '@fuzeone/selection-list-client'
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

  describe('legacy setSelectionListAuthTokenProvider (still exported)', () => {
    afterEach(() => api.setSelectionListAuthTokenProvider(() => null))

    it('is the fallback bearer while no org-aware hook is configured', async () => {
      api.setSelectionListAuthTokenProvider(() => 'legacy.tok')
      fetchMock.mockResolvedValue(json({}))
      await api.getQuota()
      expect(headersOf(lastCall())['Authorization']).toBe('Bearer legacy.tok')
    })

    it('never overrides a configured org hook, even when that hook yields nothing', async () => {
      // A host on the org-aware flow must not silently degrade to a session token
      // that names no organization.
      api.setSelectionListAuthTokenProvider(() => 'legacy.tok')
      api.configureSelectionListsAuth({ getOrgToken: async () => null })
      fetchMock.mockResolvedValue(json({}))
      await api.getQuota()
      expect(headersOf(lastCall())['Authorization']).toBeUndefined()
    })
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


/**
 * The translation workbench reads against the REAL service shapes (contract
 * 4.2.0, services/selection-list-service/src/routes/translations.ts + items.ts):
 *  - `GET …/translations` answers a top-level `TranslationLocaleStatus[]`
 *    (source locale excluded; locales with no list translation absent);
 *  - there is NO `GET …/translations/{locale}` — a locale's text is read with
 *    `GET …/items?locale=` (rows the locale has no text for fall back, reported
 *    by `resolved_locale`).
 */
// openapi `Locale` enum (contract 4.2.0). A runtime import of the client would need its dist built.
const LOCALES = ['en', 'es', 'fr', 'de', 'pt', 'ru', 'zh', 'ja', 'hi', 'ar', 'he']

describe('translation workbench reads — real service shapes', () => {
  const LIST = { id: 'sl_1', key: 'k', name: 'K', is_machine: false, status: 'active', item_count: 3, source_locale: 'en' }
  const row = (id: string, label: string, over: Record<string, unknown> = {}) => ({
    id, list_id: 'sl_1', code: id.toUpperCase(), label, is_machine: false, status: 'active', sort_order: 1, resolved_locale: 'fr', source_hash: 'h', ...over,
  })

  function service(
    statuses: TranslationLocaleStatus[],
    itemPages: Array<Record<string, unknown>[]> = [[]],
    quota: { status: number; limit?: number } = { status: 200, limit: 11 }
  ) {
    let page = 0
    fetchMock.mockImplementation(async (url: string) => {
      const path = url.split('?')[0]
      if (path === '/api/v1/selection-lists/quota') {
        return quota.status === 200
          ? json({ organization_id: 'org', quotas: [{ scope: 'list_locales', applies_to: 'list', current: null, limit: quota.limit }] })
          : json({ code: 'FORBIDDEN', message: 'no' }, quota.status)
      }
      if (path === '/api/v1/selection-lists/sl_1') return json(LIST)
      if (path === '/api/v1/selection-lists/sl_1/translations') return json(statuses)
      if (path === '/api/v1/selection-lists/sl_1/items') {
        const items = itemPages[Math.min(page, itemPages.length - 1)]
        const hasMore = page < itemPages.length - 1
        page += 1
        return json({ items, page: { nextCursor: hasMore ? `c${page}` : null, hasMore } })
      }
      return json({ code: 'NOT_FOUND', message: 'no such route' }, 404)
    })
  }
  const urls = () => fetchMock.mock.calls.map(c => (c[0] as string).split('?')[0])

  it('getLocaleIndex reads the top-level array, adds the source row and every supported locale it lacks', async () => {
    service([
      { locale: 'fr', completeness_pct: 50, machine_translated: true, source_changed: false },
      { locale: 'de', completeness_pct: 100, machine_translated: false, source_changed: true },
    ])
    const { locales } = await api.getLocaleIndex('sl_1')
    // total translatable strings = the list + its 3 active items
    expect(locales[0]).toMatchObject({ locale: 'en', is_source: true, translated: 4, total: 4 })
    expect((await api.getLocaleIndex('sl_1')).quota_exceeded).toBe(false)
    const by = Object.fromEntries(locales.map(l => [l.locale, l]))
    expect(by.fr).toMatchObject({ is_source: false, total: 4, translated: 2, machine_count: 1, stale_count: 0 })
    expect(by.de).toMatchObject({ translated: 4, machine_count: 0, stale_count: 1 })
    // a locale the service does not list has no translation yet: an untranslated row (Start / Autofill)
    expect(by.ja).toMatchObject({ is_source: false, translated: 0, total: 4, machine_count: 0, stale_count: 0 })
    expect(locales.map(l => l.locale).sort()).toEqual([...LOCALES].sort())
    expect(locales.filter(l => l.is_source)).toHaveLength(1)
    expect(urls()).not.toContain('/api/v1/selection-lists/sl_1/translations/fr')
  })

  it('getLocaleIndex derives quota_exceeded from the list_locales ceiling: locales with a list translation (source included) >= limit', async () => {
    const two: TranslationLocaleStatus[] = [
      { locale: 'fr', completeness_pct: 10, machine_translated: false, source_changed: false },
      { locale: 'de', completeness_pct: 10, machine_translated: false, source_changed: false },
    ]
    service(two, [[]], { status: 200, limit: 3 })
    expect((await api.getLocaleIndex('sl_1')).quota_exceeded).toBe(true)
    service(two, [[]], { status: 200, limit: 4 })
    expect((await api.getLocaleIndex('sl_1')).quota_exceeded).toBe(false)
  })

  it('getLocaleIndex: an unreadable quota never blocks the index and never claims the ceiling is hit (the service still enforces it)', async () => {
    service([], [[]], { status: 403 })
    const res = await api.getLocaleIndex('sl_1')
    expect(res.quota_exceeded).toBe(false)
    expect(res.locales.length).toBeGreaterThan(1)
  })

  it('getLocaleIndex of a list with no translations still lists the supported locales (nothing to crash on)', async () => {
    service([])
    const { locales } = await api.getLocaleIndex('sl_1')
    expect(locales.filter(l => !l.is_source).every(l => l.translated === 0)).toBe(true)
    expect(locales).toHaveLength(LOCALES.length)
  })

  it('getLocaleIndex rejects a body that is not an array (fail closed — never "No locales")', async () => {
    service({ locales: [] } as never)
    await expect(api.getLocaleIndex('sl_1')).rejects.toThrow(/array/)
  })

  it('getLocaleIndex propagates a refusal from either read', async () => {
    fetchMock.mockResolvedValue(json({ code: 'FORBIDDEN', message: 'no' }, 403))
    await expect(api.getLocaleIndex('sl_1')).rejects.toMatchObject({ status: 403 })
  })

  it('getLocaleEditor reads GET items?locale= (never …/translations/{locale}), following the cursor', async () => {
    service([], [[row('sli_1', 'Allemagne')], [row('sli_2', 'France')]])
    const { locale, translations } = await api.getLocaleEditor('sl_1', 'fr')
    expect(locale).toBe('fr')
    expect(translations.map(t => [t.item_id, t.label])).toEqual([['sli_1', 'Allemagne'], ['sli_2', 'France']])
    expect(urls().every(u => u === '/api/v1/selection-lists/sl_1/items')).toBe(true)
    const first = new URL(fetchMock.mock.calls[0][0] as string, 'http://x')
    expect(first.searchParams.get('locale')).toBe('fr')
    expect(first.searchParams.get('status')).toBe('active')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('getLocaleEditor: a row the locale has no text for (fell back) is MISSING, not a translation', async () => {
    service([], [[
      row('sli_1', 'Allemagne', { is_machine: true }),
      row('sli_2', 'France', { resolved_locale: 'en', is_machine: false }),
    ]])
    const { translations } = await api.getLocaleEditor('sl_1', 'fr')
    expect(translations[0]).toMatchObject({ item_id: 'sli_1', locale: 'fr', label: 'Allemagne', is_machine: true })
    expect(translations[1]).toMatchObject({ item_id: 'sli_2', locale: 'fr', label: '', is_machine: false })
  })

  it('getLocaleEditor of an empty list is an empty editor', async () => {
    service([], [[]])
    expect((await api.getLocaleEditor('sl_1', 'fr')).translations).toEqual([])
  })

  it('getLocaleEditor propagates a refusal', async () => {
    fetchMock.mockResolvedValue(json({ code: 'NOT_FOUND', message: 'no' }, 404))
    await expect(api.getLocaleEditor('sl_1', 'fr')).rejects.toMatchObject({ status: 404 })
  })
})
