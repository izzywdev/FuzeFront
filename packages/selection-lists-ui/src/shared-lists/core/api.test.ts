/**
 * Shared-lists API wrappers. `fetch` is the real network boundary and is stubbed;
 * everything above it (auth wiring, `request()`, error decoration) runs for real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configureSelectionListsAuth } from '../../api'
import {
  changeVisibility,
  forkList,
  MAX_EFFECTIVE_LOOKUP_PAGES,
  getEffectiveList,
  getListByKey,
  getSharedList,
  listSharedLists,
  resolveStoredValues,
  restoreList,
} from './api'
import {
  COMMON_ID,
  FORK_ID,
  callsOf,
  htmlResponse,
  lastCallOf,
  jsonResponse,
  makeCommonList,
  makeForkList,
  makeSharedList,
  page,
  queryOf,
  stubFetch,
} from '../../test/sharedListsFixtures'

let fetchMock: ReturnType<typeof stubFetch>

beforeEach(() => {
  fetchMock = stubFetch()
})
afterEach(() => {
  configureSelectionListsAuth(undefined)
  vi.unstubAllGlobals()
})

const lastUrl = () => lastCallOf(fetchMock)[0]
const lastInit = () => lastCallOf(fetchMock)[1]!

describe('same-origin base and auth', () => {
  it('never uses an absolute host', async () => {
    fetchMock.mockResolvedValue(jsonResponse(page([])))
    await listSharedLists()
    await getSharedList(COMMON_ID)
    await forkList(COMMON_ID)
    await changeVisibility(FORK_ID, 'org')
    await restoreList(FORK_ID)
    await resolveStoredValues(['front_sli_a'], { sharedLists: true })
    for (const [url] of callsOf(fetchMock)) {
      expect(url).toMatch(/^\/api\/v1\//)
      expect(url).not.toMatch(/^[a-z]+:\/\//i)
    }
  })

  it("rides the package's org-scoped bearer", async () => {
    configureSelectionListsAuth({ getOrgToken: () => 'org-token' })
    fetchMock.mockResolvedValue(jsonResponse(page([])))
    await listSharedLists()
    expect((lastInit().headers as Record<string, string>).Authorization).toBe(
      'Bearer org-token'
    )
  })
})

describe('listSharedLists', () => {
  it('sends no query when there are no params (the 4.0.0 request)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(page([makeSharedList()])))
    const result = await listSharedLists()
    expect(lastUrl()).toBe('/api/v1/selection-lists')
    expect(result.items).toHaveLength(1)
    expect(result.page).toEqual({ nextCursor: null, hasMore: false })
  })

  it('sends include_shared and visibility together with status and cursor', async () => {
    fetchMock.mockResolvedValue(jsonResponse(page([], 'next-1')))
    const result = await listSharedLists({
      status: 'active',
      cursor: 'c1',
      include_shared: true,
      visibility: 'platform',
    })
    expect(queryOf(lastUrl())).toEqual({
      cursor: 'c1',
      status: 'active',
      include_shared: 'true',
      visibility: 'platform',
    })
    expect(result.page).toEqual({ nextCursor: 'next-1', hasMore: true })
  })

  it('URL-encodes the key', async () => {
    fetchMock.mockResolvedValue(jsonResponse(page([])))
    await listSharedLists({ key: 'a b&c' })
    expect(queryOf(lastUrl())).toEqual({ key: 'a b&c' })
  })

  it('walks the cursor envelope: hasMore follows nextCursor unless the page says otherwise', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ items: [], page: { nextCursor: 'x' } })
    )
    expect((await listSharedLists()).page).toEqual({
      nextCursor: 'x',
      hasMore: true,
    })
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ items: [], page: { nextCursor: null, hasMore: false } })
    )
    expect((await listSharedLists()).page).toEqual({
      nextCursor: null,
      hasMore: false,
    })
  })

  it('tolerates the legacy data/next_cursor envelope the 4.0.0 helpers accept', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ data: [makeSharedList()], next_cursor: 'n' })
    )
    const result = await listSharedLists()
    expect(result.items).toHaveLength(1)
    expect(result.page).toEqual({ nextCursor: 'n', hasMore: true })
  })

  it('treats a body with no rows as an empty page', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}))
    expect(await listSharedLists()).toEqual({
      items: [],
      page: { nextCursor: null, hasMore: false },
    })
  })

  it('rejects with the decorated service error, status included', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ code: 'FORBIDDEN', message: 'no' }, 403, 'Forbidden')
    )
    await expect(listSharedLists()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    })
  })

  it('passes the abort signal to fetch', async () => {
    fetchMock.mockResolvedValue(jsonResponse(page([])))
    const controller = new AbortController()
    await listSharedLists({}, controller.signal)
    expect(lastInit().signal).toBe(controller.signal)
  })
})

describe('getEffectiveList (frame 09)', () => {
  it('asks ?key=…&include_shared=true&limit=1 — one call when the first page has the list', async () => {
    fetchMock.mockResolvedValue(jsonResponse(page([makeForkList()])))
    const list = await getEffectiveList('priority')
    expect(callsOf(fetchMock)).toHaveLength(1)
    expect(queryOf(lastUrl())).toEqual({
      limit: '1',
      key: 'priority',
      include_shared: 'true',
    })
    expect(list?.id).toBe(FORK_ID)
  })

  it('passes the locale', async () => {
    fetchMock.mockResolvedValue(jsonResponse(page([makeCommonList()])))
    await getEffectiveList('priority', { locale: 'he' })
    expect(queryOf(lastUrl()).locale).toBe('he')
  })

  it('resolves null on an empty page (no effective list), not an error', async () => {
    fetchMock.mockResolvedValue(jsonResponse(page([])))
    expect(await getEffectiveList('priority')).toBeNull()
  })

  it('never renders a differently-keyed row', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(page([makeSharedList({ key: 'other' })]))
    )
    expect(await getEffectiveList('priority')).toBeNull()
  })

  it('rejects on 403 — a load failure, not "no list"', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ code: 'FORBIDDEN', message: 'no' }, 403)
    )
    await expect(getEffectiveList('priority')).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    })
  })
})

describe('getEffectiveList — pages the service filtered down to nothing', () => {
  // The service paginates BEFORE it drops rows the caller cannot read, so an
  // unreadable newer private list with the same key can yield an EMPTY page
  // that still has a next cursor leading to the readable common list.
  it('an empty NON-terminal page is followed through the same endpoint to the hit', async () => {
    const common = makeCommonList()
    fetchMock.mockResolvedValueOnce(jsonResponse(page([], 'cur-1')))
    fetchMock.mockResolvedValueOnce(jsonResponse(page([common])))
    const list = await getEffectiveList('priority', { locale: 'fr' })
    expect(list?.id).toBe(common.id)
    expect(callsOf(fetchMock)).toHaveLength(2)
    expect(queryOf(callsOf(fetchMock)[0][0])).toEqual({
      limit: '1',
      key: 'priority',
      include_shared: 'true',
      locale: 'fr',
    })
    expect(queryOf(callsOf(fetchMock)[1][0])).toEqual({
      limit: '1',
      cursor: 'cur-1',
      key: 'priority',
      include_shared: 'true',
      locale: 'fr',
    })
    for (const [url] of callsOf(fetchMock))
      expect(url).toMatch(/^\/api\/v1\/selection-lists\?/)
  })

  it('several empty pages in a row, then a hit', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(page([], 'c1')))
    fetchMock.mockResolvedValueOnce(jsonResponse(page([], 'c2')))
    fetchMock.mockResolvedValueOnce(jsonResponse(page([], 'c3')))
    fetchMock.mockResolvedValueOnce(jsonResponse(page([makeCommonList()])))
    expect((await getEffectiveList('priority'))?.id).toBe(makeCommonList().id)
    expect(callsOf(fetchMock).map(([u]) => queryOf(u).cursor)).toEqual([
      undefined,
      'c1',
      'c2',
      'c3',
    ])
  })

  it('a TERMINAL empty page is "no effective list": null, no further call', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(page([], null)))
    expect(await getEffectiveList('priority')).toBeNull()
    expect(callsOf(fetchMock)).toHaveLength(1)
  })

  it('an empty non-terminal page followed by a terminal empty page is null', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(page([], 'c1')))
    fetchMock.mockResolvedValueOnce(jsonResponse(page([], null)))
    expect(await getEffectiveList('priority')).toBeNull()
    expect(callsOf(fetchMock)).toHaveLength(2)
  })

  it('a cursor with hasMore:false is terminal', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ items: [], page: { nextCursor: 'c1', hasMore: false } })
    )
    expect(await getEffectiveList('priority')).toBeNull()
    expect(callsOf(fetchMock)).toHaveLength(1)
  })

  it('a page with only differently-keyed rows keeps walking, and never renders one', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(page([makeSharedList({ key: 'other' })], 'c1'))
    )
    fetchMock.mockResolvedValueOnce(jsonResponse(page([makeCommonList()])))
    expect((await getEffectiveList('priority'))?.key).toBe('priority')
    expect(callsOf(fetchMock)).toHaveLength(2)
  })

  it('guard exhaustion is NOT "none": it rejects as an incomplete lookup after the bound', async () => {
    let n = 0
    fetchMock.mockImplementation(async () => jsonResponse(page([], `c${++n}`)))
    await expect(getEffectiveList('priority')).rejects.toMatchObject({
      name: 'EffectiveLookupIncompleteError',
      incomplete: true,
      pages: MAX_EFFECTIVE_LOOKUP_PAGES,
    })
    expect(callsOf(fetchMock)).toHaveLength(MAX_EFFECTIVE_LOOKUP_PAGES)
  })

  it('a hit on the last allowed page still resolves', async () => {
    for (let i = 1; i < MAX_EFFECTIVE_LOOKUP_PAGES; i++) {
      fetchMock.mockResolvedValueOnce(jsonResponse(page([], `c${i}`)))
    }
    fetchMock.mockResolvedValueOnce(jsonResponse(page([makeCommonList()])))
    expect((await getEffectiveList('priority'))?.id).toBe(makeCommonList().id)
    expect(callsOf(fetchMock)).toHaveLength(MAX_EFFECTIVE_LOOKUP_PAGES)
  })

  it('a failed page fetch mid-walk rejects; it never falls back to another list', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(page([], 'c1')))
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 'UNKNOWN' }, 503))
    await expect(getEffectiveList('priority')).rejects.toMatchObject({
      status: 503,
    })
    expect(callsOf(fetchMock)).toHaveLength(2)
  })

  it('a 403 on a later page is still a rejection (a load failure)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(page([], 'c1')))
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ code: 'FORBIDDEN', message: 'no' }, 403)
    )
    await expect(getEffectiveList('priority')).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    })
  })

  it('the abort signal reaches every page, and aborting mid-walk stops the walk', async () => {
    const controller = new AbortController()
    fetchMock.mockImplementationOnce(async () => {
      controller.abort()
      return jsonResponse(page([], 'c1'))
    })
    await expect(
      getEffectiveList('priority', { signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(callsOf(fetchMock)).toHaveLength(1)
    expect(callsOf(fetchMock)[0][1]!.signal).toBe(controller.signal)
  })

  it('passes the same signal to later pages', async () => {
    const controller = new AbortController()
    fetchMock.mockResolvedValueOnce(jsonResponse(page([], 'c1')))
    fetchMock.mockResolvedValueOnce(jsonResponse(page([makeCommonList()])))
    await getEffectiveList('priority', { signal: controller.signal })
    expect(callsOf(fetchMock)[1][1]!.signal).toBe(controller.signal)
  })
})

describe('getListByKey does NOT paginate (the 4.0.0 lookup, flag OFF)', () => {
  it('an empty page with a cursor is just "none": one call', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(page([], 'c1')))
    expect(await getListByKey('priority')).toBeNull()
    expect(callsOf(fetchMock)).toHaveLength(1)
  })
})

describe('getListByKey (the 4.0.0 lookup, flag OFF)', () => {
  it('sends the key and nothing shared', async () => {
    fetchMock.mockResolvedValue(jsonResponse(page([makeSharedList()])))
    const list = await getListByKey('priority')
    expect(lastUrl()).toBe('/api/v1/selection-lists?key=priority')
    expect(queryOf(lastUrl())).not.toHaveProperty('include_shared')
    expect(list?.key).toBe('priority')
  })

  it('resolves null when the key names no readable list', async () => {
    fetchMock.mockResolvedValue(jsonResponse(page([])))
    expect(await getListByKey('priority', { locale: 'fr' })).toBeNull()
    expect(queryOf(lastUrl())).toEqual({ key: 'priority', locale: 'fr' })
  })
})

describe('getSharedList', () => {
  it('reads one list by id (encoded), with its 4.1.0 fields', async () => {
    fetchMock.mockResolvedValue(jsonResponse(makeCommonList()))
    const list = await getSharedList(COMMON_ID)
    expect(lastUrl()).toBe(`/api/v1/selection-lists/${COMMON_ID}`)
    expect(list.visibility).toBe('platform')
    expect(list.editable).toBe(false)
  })

  it('passes the locale and encodes odd ids', async () => {
    fetchMock.mockResolvedValue(jsonResponse(makeCommonList()))
    await getSharedList('a/b', { locale: 'ar' })
    expect(lastUrl()).toBe('/api/v1/selection-lists/a%2Fb?locale=ar')
  })
})

describe('forkList (frames 05, 06)', () => {
  it('POSTs to …/fork with a visibility body and nothing else — no id, no key, no name', async () => {
    fetchMock.mockResolvedValue(jsonResponse(makeForkList(), 201))
    await forkList(COMMON_ID, 'org')
    expect(lastUrl()).toBe(`/api/v1/selection-lists/${COMMON_ID}/fork`)
    expect(lastInit().method).toBe('POST')
    expect(JSON.parse(lastInit().body as string)).toEqual({ visibility: 'org' })
  })

  it('sends an empty body when no visibility is chosen (the service defaults to org)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(makeForkList(), 201))
    await forkList(COMMON_ID)
    expect(JSON.parse(lastInit().body as string)).toEqual({})
  })

  it('a private draft goes out as private', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(makeForkList({ visibility: 'private' }), 201)
    )
    await forkList(COMMON_ID, 'private')
    expect(JSON.parse(lastInit().body as string)).toEqual({
      visibility: 'private',
    })
  })

  it('201 → created', async () => {
    const list = makeForkList()
    fetchMock.mockResolvedValue(jsonResponse(list, 201))
    expect(await forkList(COMMON_ID, 'org')).toEqual({ kind: 'created', list })
  })

  it('200 → existing (not an error)', async () => {
    const list = makeForkList()
    fetchMock.mockResolvedValue(jsonResponse(list, 200))
    expect(await forkList(COMMON_ID, 'org')).toEqual({ kind: 'existing', list })
  })

  it('409 fork_exists / fork_not_applicable / no reason', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { code: 'CONFLICT', reason: 'fork_exists', message: 'x' },
        409
      )
    )
    expect(await forkList(COMMON_ID)).toEqual({ kind: 'fork_exists' })
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { code: 'CONFLICT', reason: 'fork_not_applicable', message: 'x' },
        409
      )
    )
    expect(await forkList(COMMON_ID)).toEqual({ kind: 'fork_not_applicable' })
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ code: 'CONFLICT', message: 'key taken' }, 409)
    )
    expect(await forkList(COMMON_ID)).toEqual({ kind: 'key_taken' })
  })

  it('403 QUOTA_EXCEEDED keeps the scope and numbers; 403 FORBIDDEN is a different answer', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          code: 'QUOTA_EXCEEDED',
          message: 'q',
          scope: 'list_items',
          limit: 250,
          current: 312,
        },
        403
      )
    )
    expect(await forkList(COMMON_ID)).toEqual({
      kind: 'quota',
      scope: 'list_items',
      limit: 250,
      current: 312,
    })
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ code: 'FORBIDDEN', message: 'no' }, 403)
    )
    expect(await forkList(COMMON_ID)).toEqual({ kind: 'forbidden' })
  })

  it('400 → too_large; 404 → not_found; 401 → unauthenticated', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ code: 'VALIDATION_ERROR', message: 'too big' }, 400)
    )
    expect(await forkList(COMMON_ID)).toEqual({ kind: 'too_large' })
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ code: 'NOT_FOUND', message: 'gone' }, 404)
    )
    expect(await forkList(COMMON_ID)).toEqual({ kind: 'not_found' })
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ code: 'UNAUTHENTICATED', message: 'no token' }, 401)
    )
    expect(await forkList(COMMON_ID)).toEqual({ kind: 'unauthenticated' })
  })

  it('5xx, a non-JSON gateway page and a network failure are all an unknown outcome', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 'UNKNOWN' }, 503))
    expect(await forkList(COMMON_ID)).toEqual({
      kind: 'unknown_outcome',
      status: 503,
    })
    fetchMock.mockResolvedValueOnce(htmlResponse(502))
    expect(await forkList(COMMON_ID)).toEqual({
      kind: 'unknown_outcome',
      status: 502,
    })
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    expect(await forkList(COMMON_ID)).toEqual({
      kind: 'unknown_outcome',
      status: undefined,
    })
  })

  it('rethrows a cancelled request instead of calling it an outcome', async () => {
    fetchMock.mockRejectedValue(new DOMException('aborted', 'AbortError'))
    await expect(forkList(COMMON_ID)).rejects.toMatchObject({
      name: 'AbortError',
    })
  })
})

describe('restoreList (frame 06 — restore your version)', () => {
  it('PATCHes {status:"active"} and returns the restored list', async () => {
    const list = makeForkList()
    fetchMock.mockResolvedValue(jsonResponse(list))
    expect(await restoreList(FORK_ID)).toEqual({ kind: 'restored', list })
    expect(lastUrl()).toBe(`/api/v1/selection-lists/${FORK_ID}`)
    expect(lastInit().method).toBe('PATCH')
    expect(JSON.parse(lastInit().body as string)).toEqual({ status: 'active' })
  })

  it('403 QUOTA_EXCEEDED (org_lists / user_lists) is branched on code, not status', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          code: 'QUOTA_EXCEEDED',
          message: 'q',
          scope: 'org_lists',
          limit: 100,
          current: 100,
        },
        403
      )
    )
    expect(await restoreList(FORK_ID)).toEqual({
      kind: 'quota',
      scope: 'org_lists',
      limit: 100,
      current: 100,
    })
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ code: 'FORBIDDEN', message: 'no' }, 403)
    )
    expect(await restoreList(FORK_ID)).toEqual({ kind: 'forbidden' })
  })

  it('a 409 fork_required (restoring a common list) is reported with its source', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          code: 'CONFLICT',
          reason: 'fork_required',
          source_list_id: COMMON_ID,
          fork_url: '/v1/x',
          message: 'x',
        },
        409
      )
    )
    expect(await restoreList(COMMON_ID)).toEqual({
      kind: 'fork_required',
      sourceListId: COMMON_ID,
      forkUrl: '/v1/x',
    })
  })

  it('404 and a network failure', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ code: 'NOT_FOUND', message: 'x' }, 404)
    )
    expect(await restoreList(FORK_ID)).toEqual({ kind: 'not_found' })
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    expect(await restoreList(FORK_ID)).toEqual({
      kind: 'unknown_outcome',
      status: undefined,
    })
  })

  it('rethrows a cancelled request', async () => {
    fetchMock.mockRejectedValue(new DOMException('aborted', 'AbortError'))
    await expect(restoreList(FORK_ID)).rejects.toMatchObject({
      name: 'AbortError',
    })
  })
})

describe('changeVisibility (frame 08)', () => {
  it('PATCHes only {visibility} and returns the changed list', async () => {
    const list = makeSharedList({ visibility: 'private' })
    fetchMock.mockResolvedValue(jsonResponse(list))
    expect(await changeVisibility(FORK_ID, 'private')).toEqual({
      kind: 'changed',
      list,
    })
    expect(lastInit().method).toBe('PATCH')
    expect(JSON.parse(lastInit().body as string)).toEqual({
      visibility: 'private',
    })
  })

  it('409 visibility_locked → locked', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { code: 'CONFLICT', reason: 'visibility_locked', message: 'locked' },
        409
      )
    )
    expect(await changeVisibility(COMMON_ID, 'private')).toEqual({
      kind: 'locked',
    })
  })

  it('403 FORBIDDEN carries what was asked for, so publish and not-owner are worded apart', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ code: 'FORBIDDEN', message: 'no' }, 403)
    )
    expect(await changeVisibility(FORK_ID, 'platform')).toEqual({
      kind: 'forbidden',
      requested: 'platform',
    })
    expect(await changeVisibility(FORK_ID, 'org')).toEqual({
      kind: 'forbidden',
      requested: 'org',
    })
  })

  it('400 (service flag OFF refuses non-private) and the rest', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ code: 'VALIDATION_ERROR', message: 'x' }, 400)
    )
    expect(await changeVisibility(FORK_ID, 'org')).toEqual({
      kind: 'validation',
      details: undefined,
    })
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ code: 'NOT_FOUND', message: 'x' }, 404)
    )
    expect(await changeVisibility(FORK_ID, 'org')).toEqual({
      kind: 'not_found',
    })
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ code: 'UNAUTHENTICATED', message: 'x' }, 401)
    )
    expect(await changeVisibility(FORK_ID, 'org')).toEqual({
      kind: 'unauthenticated',
    })
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ code: 'CONFLICT', message: 'other' }, 409)
    )
    expect(await changeVisibility(FORK_ID, 'org')).toEqual({
      kind: 'conflict',
      reason: undefined,
    })
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 500))
    expect(await changeVisibility(FORK_ID, 'org')).toEqual({
      kind: 'unknown_outcome',
      status: 500,
    })
  })

  it('rethrows a cancelled request', async () => {
    fetchMock.mockRejectedValue(new DOMException('aborted', 'AbortError'))
    await expect(changeVisibility(FORK_ID, 'org')).rejects.toMatchObject({
      name: 'AbortError',
    })
  })
})

describe('resolveStoredValues (frame 10)', () => {
  const wire = (results: Record<string, unknown>, missing: string[] = []) =>
    jsonResponse({ results, missing })

  it('resolves every id in ONE call and keeps effective_item_id when shared lists are ON', async () => {
    fetchMock.mockResolvedValue(
      wire({
        front_sli_a: {
          label: 'Medium',
          locale: 'en',
          is_machine: false,
          status: 'active',
          effective_item_id: 'front_sli_a2',
        },
        front_sli_b: {
          label: 'Normal',
          locale: 'en',
          is_machine: true,
          status: 'archived',
        },
      })
    )
    const outcomes = await resolveStoredValues(['front_sli_a', 'front_sli_b'], {
      sharedLists: true,
    })
    expect(callsOf(fetchMock)).toHaveLength(1)
    expect(lastUrl()).toBe('/api/v1/resolve')
    expect(JSON.parse(lastInit().body as string)).toEqual({
      ids: ['front_sli_a', 'front_sli_b'],
    })
    expect(outcomes.front_sli_a).toEqual({
      kind: 'resolved',
      id: 'front_sli_a',
      label: 'Medium',
      locale: 'en',
      isMachine: false,
      status: 'active',
      effectiveItemId: 'front_sli_a2',
    })
    expect(outcomes.front_sli_b).toMatchObject({
      kind: 'resolved',
      isMachine: true,
      status: 'archived',
      effectiveItemId: null,
    })
  })

  it('ignores effective_item_id with the flag OFF (4.0.0 behaviour must not depend on it)', async () => {
    fetchMock.mockResolvedValue(
      wire({
        front_sli_a: {
          label: 'Medium',
          locale: 'en',
          is_machine: false,
          status: 'active',
          effective_item_id: 'front_sli_a2',
        },
      })
    )
    const outcomes = await resolveStoredValues(['front_sli_a'], {
      sharedLists: false,
    })
    expect(outcomes.front_sli_a).toMatchObject({
      kind: 'resolved',
      effectiveItemId: null,
    })
  })

  it('accounts for every id: one the service lists as missing, and one it dropped, are both missing', async () => {
    fetchMock.mockResolvedValue(wire({}, ['front_sli_gone']))
    const outcomes = await resolveStoredValues(
      ['front_sli_gone', 'front_sli_dropped'],
      { sharedLists: true }
    )
    expect(outcomes).toEqual({
      front_sli_gone: { kind: 'missing', id: 'front_sli_gone' },
      front_sli_dropped: { kind: 'missing', id: 'front_sli_dropped' },
    })
  })

  it('de-duplicates ids and sends the locale when given', async () => {
    fetchMock.mockResolvedValue(wire({}))
    await resolveStoredValues(['front_sli_a', 'front_sli_a'], {
      sharedLists: true,
      locale: 'fr',
    })
    expect(JSON.parse(lastInit().body as string)).toEqual({
      ids: ['front_sli_a'],
      locale: 'fr',
    })
  })

  it('makes no call for an empty batch', async () => {
    expect(await resolveStoredValues([], { sharedLists: true })).toEqual({})
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('splits only a batch over the 500-id cap, one call per chunk', async () => {
    fetchMock.mockResolvedValue(wire({}))
    const ids = Array.from({ length: 501 }, (_, i) => `front_sli_${i}`)
    const outcomes = await resolveStoredValues(ids, { sharedLists: true })
    expect(callsOf(fetchMock)).toHaveLength(2)
    expect(
      JSON.parse(callsOf(fetchMock)[0][1]!.body as string).ids
    ).toHaveLength(500)
    expect(
      JSON.parse(callsOf(fetchMock)[1][1]!.body as string).ids
    ).toHaveLength(1)
    expect(Object.keys(outcomes)).toHaveLength(501)
  })

  it('tolerates a response with neither results nor missing', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}))
    expect(
      await resolveStoredValues(['front_sli_a'], { sharedLists: true })
    ).toEqual({
      front_sli_a: { kind: 'missing', id: 'front_sli_a' },
    })
  })

  it('rejects when the call fails — the stored id is then left untouched by the caller', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: 'UNKNOWN' }, 503))
    await expect(
      resolveStoredValues(['front_sli_a'], { sharedLists: true })
    ).rejects.toMatchObject({ status: 503 })
  })
})
