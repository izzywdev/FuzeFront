import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_SOURCE_ITEM_PAGES,
  archiveFork,
  archiveOutcomeFromFailure,
  getSourceItems,
} from './api'
import {
  COMMON_ID,
  FORK_ID,
  callsOf,
  jsonResponse,
  makeForkList,
  page,
  queryOf,
  stubFetch,
} from '../../test/sharedListsFixtures'

afterEach(() => vi.unstubAllGlobals())

describe('getSourceItems', () => {
  it('never sends status=all (the service rejects it): reads active and archived separately and merges', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockImplementation(async (url: string) =>
      jsonResponse(
        queryOf(url).status === 'archived'
          ? page([{ id: 'old' }])
          : page([{ id: 'a' }])
      )
    )
    const items = await getSourceItems(COMMON_ID)
    expect(items.map(i => i.id)).toEqual(['a', 'old'])
    const calls = callsOf(fetchMock)
    expect(calls).toHaveLength(2)
    expect(calls.map(c => queryOf(c[0]).status).sort()).toEqual(['active', 'archived'])
    calls.forEach(c => expect(c[0]).toMatch(`/api/v1/selection-lists/${COMMON_ID}/items?`))
  })

  it('follows page.nextCursor until the last page, per status', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockImplementation(async (url: string) => {
      const q = queryOf(url)
      if (q.status === 'archived') return jsonResponse(page([]))
      return jsonResponse(q.cursor ? page([{ id: 'b' }]) : page([{ id: 'a' }], 'c1'))
    })
    const items = await getSourceItems(COMMON_ID)
    expect(items.map(i => i.id)).toEqual(['a', 'b'])
    const active = callsOf(fetchMock).filter(c => queryOf(c[0]).status === 'active')
    expect(active.map(c => queryOf(c[0]))).toEqual([{ status: 'active' }, { status: 'active', cursor: 'c1' }])
  })

  it('stops when hasMore is false even if a cursor is present', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValue(
      jsonResponse({ items: [{ id: 'a' }], page: { nextCursor: 'c1', hasMore: false } })
    )
    expect(await getSourceItems(COMMON_ID)).toHaveLength(2)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('bounds a runaway cursor', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockImplementation(async () => jsonResponse(page([{ id: 'a' }], 'again')))
    await getSourceItems(COMMON_ID)
    expect(fetchMock).toHaveBeenCalledTimes(2 * MAX_SOURCE_ITEM_PAGES)
  })

  it('a failed page rejects', async () => {
    stubFetch().mockResolvedValue(jsonResponse({ code: 'UNKNOWN' }, 500))
    await expect(getSourceItems(COMMON_ID)).rejects.toMatchObject({ status: 500 })
  })
})

describe('archiveFork', () => {
  it('POSTs .../archive and returns the archived list', async () => {
    const fetchMock = stubFetch()
    const archived = makeForkList({ status: 'archived' })
    fetchMock.mockResolvedValue(jsonResponse(archived))
    const outcome = await archiveFork(FORK_ID)
    expect(outcome).toEqual({ kind: 'archived', list: archived })
    const [url, init] = callsOf(fetchMock)[0]
    expect(url).toBe(`/api/v1/selection-lists/${FORK_ID}/archive`)
    expect(init?.method).toBe('POST')
  })

  it('a 204 (no body) is still archived, with no entity', async () => {
    stubFetch().mockResolvedValue({ ok: true, status: 204, statusText: 'No Content' } as Response)
    expect(await archiveFork(FORK_ID)).toEqual({ kind: 'archived', list: null })
  })

  it.each([
    [403, 'FORBIDDEN', undefined, { kind: 'forbidden' }],
    [401, 'UNAUTHENTICATED', undefined, { kind: 'unauthenticated' }],
    [404, 'NOT_FOUND', undefined, { kind: 'not_found' }],
    [409, 'CONFLICT', 'list_locked', { kind: 'conflict', reason: 'list_locked' }],
    [409, 'CONFLICT', 'fork_required', { kind: 'conflict', reason: 'fork_required' }],
    [503, 'UNAVAILABLE', undefined, { kind: 'unknown_outcome', status: 503 }],
  ])('%i %s resolves to a typed outcome', async (status, code, reason, expected) => {
    stubFetch().mockResolvedValue(
      jsonResponse({ code, message: code, ...(reason ? { reason } : {}), source_list_id: COMMON_ID }, status)
    )
    expect(await archiveFork(FORK_ID)).toEqual(expected)
  })

  it('a transport failure is an unknown outcome, not a throw', async () => {
    stubFetch().mockRejectedValue(new TypeError('Failed to fetch'))
    expect(await archiveFork(FORK_ID)).toEqual({ kind: 'unknown_outcome', status: undefined })
  })

  it('rejects for a cancelled request (never an outcome)', async () => {
    stubFetch().mockRejectedValue(new DOMException('aborted', 'AbortError'))
    await expect(archiveFork(FORK_ID)).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('failures the archive contract does not define are an unknown outcome', () => {
    expect(archiveOutcomeFromFailure({ kind: 'quota', scope: undefined, limit: 1, current: 1 })).toEqual(
      { kind: 'unknown_outcome', status: undefined }
    )
    expect(archiveOutcomeFromFailure({ kind: 'validation', details: undefined })).toEqual(
      { kind: 'unknown_outcome', status: undefined }
    )
    expect(archiveOutcomeFromFailure({ kind: 'incomplete' })).toEqual(
      { kind: 'unknown_outcome', status: undefined }
    )
  })
})
