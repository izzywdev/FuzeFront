import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useSharedListIndex,
  type UseSharedListIndexOptions,
} from './useSharedListIndex'
import {
  callsOf,
  flush,
  jsonResponse,
  lastCallOf,
  makeCommonList,
  makeForkList,
  makeSharedList,
  page,
  queryOf,
  stubFetch,
} from '../../test/sharedListsFixtures'
import { withSharedLists } from '../../test/sharedListsWrapper'

let fetchMock: ReturnType<typeof stubFetch>
beforeEach(() => {
  fetchMock = stubFetch()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

const queries = () => callsOf(fetchMock).map(([url]) => queryOf(url))

const own = (id: string, key = id) =>
  makeSharedList({ id, key, visibility: 'org' })
const common = (id: string, key = id) => makeCommonList({ id, key })

describe('useSharedListIndex — flag ON', () => {
  const wrapper = withSharedLists(true)
  const on: UseSharedListIndexOptions = {
    status: 'active',
    includeShared: true,
  }

  it('loading, then groups "Your organization" and "Common lists" — headers only with their rows', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(page([own('a'), common('b'), own('c')]))
    )
    const { result } = renderHook(() => useSharedListIndex(on), { wrapper })
    expect(result.current).toMatchObject({
      phase: 'loading',
      rows: [],
      groups: null,
      isEmpty: false,
    })
    await waitFor(() => expect(result.current.phase).toBe('ready'))
    expect(result.current.groups?.own.map(l => l.id)).toEqual(['a', 'c'])
    expect(result.current.groups?.common.map(l => l.id)).toEqual(['b'])
    expect(queries()[0]).toEqual({ status: 'active', include_shared: 'true' })
  })

  it('a visibility filter is sent WITH include_shared, and removes the grouping', async () => {
    fetchMock.mockResolvedValue(jsonResponse(page([common('a'), common('b')])))
    const { result } = renderHook(
      () => useSharedListIndex({ ...on, visibility: 'platform' }),
      { wrapper }
    )
    await waitFor(() => expect(result.current.phase).toBe('ready'))
    expect(queries()[0]).toEqual({
      status: 'active',
      include_shared: 'true',
      visibility: 'platform',
    })
    expect(result.current.groups).toBeNull()
    expect(result.current.rows).toHaveLength(2)
  })

  it('"any" sends no visibility', async () => {
    fetchMock.mockResolvedValue(jsonResponse(page([own('a')])))
    const { result } = renderHook(
      () => useSharedListIndex({ ...on, visibility: 'any' }),
      { wrapper }
    )
    await waitFor(() => expect(result.current.phase).toBe('ready'))
    expect(queries()[0]).not.toHaveProperty('visibility')
  })

  it('switch OFF: neither include_shared nor visibility, whatever filter was left set; no groups', async () => {
    fetchMock.mockResolvedValue(jsonResponse(page([own('a')])))
    const { result } = renderHook(
      () =>
        useSharedListIndex({
          status: 'active',
          includeShared: false,
          visibility: 'org',
        }),
      { wrapper }
    )
    await waitFor(() => expect(result.current.phase).toBe('ready'))
    expect(queries()[0]).toEqual({ status: 'active' })
    expect(result.current.groups).toBeNull()
  })

  it('flipping the switch asks again and resets to loading (no stale rows under the new query)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(page([own('a')])))
    const { result, rerender } = renderHook(
      (o: UseSharedListIndexOptions) => useSharedListIndex(o),
      {
        wrapper,
        initialProps: {
          status: 'active',
          includeShared: false,
        } as UseSharedListIndexOptions,
      }
    )
    await waitFor(() => expect(result.current.phase).toBe('ready'))
    fetchMock.mockResolvedValueOnce(jsonResponse(page([own('a'), common('b')])))
    rerender({ status: 'active', includeShared: true })
    expect(result.current).toMatchObject({ phase: 'loading', rows: [] })
    await waitFor(() => expect(result.current.phase).toBe('ready'))
    expect(result.current.rows).toHaveLength(2)
    expect(queries()[1]).toEqual({ status: 'active', include_shared: 'true' })
  })

  it('an empty page is ready and empty', async () => {
    fetchMock.mockResolvedValue(jsonResponse(page([])))
    const { result } = renderHook(() => useSharedListIndex(on), { wrapper })
    await waitFor(() => expect(result.current.phase).toBe('ready'))
    expect(result.current).toMatchObject({
      isEmpty: true,
      hasMore: false,
      rows: [],
    })
  })

  it('error keeps no rows; reload retries and recovers', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ code: 'FORBIDDEN', message: 'no' }, 403)
    )
    fetchMock.mockResolvedValueOnce(jsonResponse(page([own('a')])))
    const { result } = renderHook(() => useSharedListIndex(on), { wrapper })
    await waitFor(() => expect(result.current.phase).toBe('error'))
    expect(result.current.error).toEqual({ kind: 'forbidden' })
    expect(result.current).toMatchObject({
      rows: [],
      groups: null,
      hasMore: false,
    })
    act(() => result.current.reload())
    await waitFor(() => expect(result.current.phase).toBe('ready'))
    expect(result.current.error).toBeNull()
  })

  it('walks the cursor envelope until hasMore is false, appending (and de-duplicating) rows', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(page([own('a'), own('b')], 'cur-1'))
    )
    fetchMock.mockResolvedValueOnce(
      jsonResponse(page([own('b'), common('c')], 'cur-2'))
    )
    fetchMock.mockResolvedValueOnce(jsonResponse(page([common('d')], null)))
    const { result } = renderHook(() => useSharedListIndex(on), { wrapper })
    await waitFor(() => expect(result.current.phase).toBe('ready'))
    expect(result.current.hasMore).toBe(true)

    act(() => result.current.loadMore())
    expect(result.current.loadingMore).toBe(true)
    await waitFor(() =>
      expect(result.current.rows.map(l => l.id)).toEqual(['a', 'b', 'c'])
    )
    expect(result.current).toMatchObject({ hasMore: true, loadingMore: false })
    expect(queries()[1]).toMatchObject({
      cursor: 'cur-1',
      include_shared: 'true',
    })

    act(() => result.current.loadMore())
    await waitFor(() =>
      expect(result.current.rows.map(l => l.id)).toEqual(['a', 'b', 'c', 'd'])
    )
    expect(result.current.hasMore).toBe(false)
    expect(queries()[2]).toMatchObject({ cursor: 'cur-2' })
    expect(result.current.groups?.common.map(l => l.id)).toEqual(['c', 'd'])
  })

  it('loadMore is single-flight and a no-op with no next page', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(page([own('a')], 'cur-1')))
    let release: (r: Response) => void = () => undefined
    fetchMock.mockImplementationOnce(
      () => new Promise<Response>(resolve => (release = resolve))
    )
    const { result } = renderHook(() => useSharedListIndex(on), { wrapper })
    await waitFor(() => expect(result.current.phase).toBe('ready'))
    act(() => {
      result.current.loadMore()
      result.current.loadMore()
    })
    await waitFor(() => expect(callsOf(fetchMock)).toHaveLength(2))
    await flush()
    expect(callsOf(fetchMock)).toHaveLength(2)
    await act(async () => release(jsonResponse(page([own('b')], null))))
    await waitFor(() => expect(result.current.hasMore).toBe(false))
    act(() => result.current.loadMore())
    await flush()
    expect(callsOf(fetchMock)).toHaveLength(2)
  })

  it('a failed LOAD MORE keeps every row shown, flags it, and retries the same cursor', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(page([own('a')], 'cur-1')))
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 'UNKNOWN' }, 503))
    fetchMock.mockResolvedValueOnce(jsonResponse(page([own('b')], null)))
    const { result } = renderHook(() => useSharedListIndex(on), { wrapper })
    await waitFor(() => expect(result.current.phase).toBe('ready'))
    act(() => result.current.loadMore())
    await waitFor(() => expect(result.current.loadMoreFailed).toBe(true))
    expect(result.current).toMatchObject({
      phase: 'ready',
      hasMore: true,
      loadingMore: false,
    })
    expect(result.current.rows.map(l => l.id)).toEqual(['a'])

    act(() => result.current.loadMore())
    await waitFor(() =>
      expect(result.current.rows.map(l => l.id)).toEqual(['a', 'b'])
    )
    expect(result.current.loadMoreFailed).toBe(false)
    expect(queries()[2]).toMatchObject({ cursor: 'cur-1' })
  })

  it('a LOAD MORE that lands after the query changed is discarded', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(page([own('a')], 'cur-1')))
    let release: (r: Response) => void = () => undefined
    fetchMock.mockImplementationOnce(
      () => new Promise<Response>(resolve => (release = resolve))
    )
    const { result, rerender } = renderHook(
      (o: UseSharedListIndexOptions) => useSharedListIndex(o),
      {
        wrapper,
        initialProps: on,
      }
    )
    await waitFor(() => expect(result.current.phase).toBe('ready'))
    act(() => result.current.loadMore())

    fetchMock.mockResolvedValueOnce(jsonResponse(page([common('z')], null)))
    rerender({ ...on, visibility: 'platform' })
    await waitFor(() =>
      expect(result.current.rows.map(l => l.id)).toEqual(['z'])
    )

    await act(async () => release(jsonResponse(page([own('stale')], null))))
    expect(result.current.rows.map(l => l.id)).toEqual(['z'])
  })

  it('a LOAD MORE that fails after the query changed is discarded too', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(page([own('a')], 'cur-1')))
    let fail: (e: Error) => void = () => undefined
    fetchMock.mockImplementationOnce(
      () => new Promise<Response>((_, reject) => (fail = reject))
    )
    const { result, rerender } = renderHook(
      (o: UseSharedListIndexOptions) => useSharedListIndex(o),
      {
        wrapper,
        initialProps: on,
      }
    )
    await waitFor(() => expect(result.current.phase).toBe('ready'))
    act(() => result.current.loadMore())
    fetchMock.mockResolvedValueOnce(jsonResponse(page([common('z')], null)))
    rerender({ ...on, visibility: 'platform' })
    await waitFor(() =>
      expect(result.current.rows.map(l => l.id)).toEqual(['z'])
    )
    await act(async () => fail(new TypeError('Failed to fetch')))
    expect(result.current.loadMoreFailed).toBe(false)
  })

  it('A -> B -> A: pages loaded for the first A never attach to the second A', async () => {
    const A: UseSharedListIndexOptions = {
      status: 'active',
      includeShared: true,
    }
    const B: UseSharedListIndexOptions = {
      status: 'archived',
      includeShared: true,
    }
    fetchMock.mockResolvedValueOnce(jsonResponse(page([own('a1')], 'cur-1')))
    fetchMock.mockResolvedValueOnce(jsonResponse(page([own('a2')], null)))
    const { result, rerender } = renderHook(
      (o: UseSharedListIndexOptions) => useSharedListIndex(o),
      { wrapper, initialProps: A }
    )
    await waitFor(() => expect(result.current.phase).toBe('ready'))
    act(() => result.current.loadMore())
    await waitFor(() =>
      expect(result.current.rows.map(l => l.id)).toEqual(['a1', 'a2'])
    )
    expect(result.current.hasMore).toBe(false)

    fetchMock.mockResolvedValueOnce(jsonResponse(page([own('b1')], null)))
    rerender(B)
    await waitFor(() =>
      expect(result.current.rows.map(l => l.id)).toEqual(['b1'])
    )

    // Back to A: the fresh first page has a NEW cursor and no a2 any more.
    fetchMock.mockResolvedValueOnce(jsonResponse(page([own('a1')], 'cur-2')))
    rerender(A)
    expect(result.current.phase).toBe('loading')
    await waitFor(() => expect(result.current.phase).toBe('ready'))
    expect(result.current.rows.map(l => l.id)).toEqual(['a1'])
    expect(result.current.hasMore).toBe(true)

    fetchMock.mockResolvedValueOnce(jsonResponse(page([own('a3')], null)))
    act(() => result.current.loadMore())
    await waitFor(() =>
      expect(result.current.rows.map(l => l.id)).toEqual(['a1', 'a3'])
    )
    expect(queries()[queries().length - 1]).toMatchObject({ cursor: 'cur-2' })
  })

  it('a filter change during a pending LOAD MORE cancels it and the new query paginates independently', async () => {
    const A: UseSharedListIndexOptions = {
      status: 'active',
      includeShared: true,
    }
    const B: UseSharedListIndexOptions = {
      status: 'archived',
      includeShared: true,
    }
    fetchMock.mockResolvedValueOnce(jsonResponse(page([own('a1')], 'cur-a')))
    // The obsolete request never settles, whatever its signal says.
    fetchMock.mockImplementationOnce(
      () => new Promise<Response>(() => undefined)
    )
    const { result, rerender } = renderHook(
      (o: UseSharedListIndexOptions) => useSharedListIndex(o),
      { wrapper, initialProps: A }
    )
    await waitFor(() => expect(result.current.phase).toBe('ready'))
    act(() => result.current.loadMore())
    await waitFor(() => expect(callsOf(fetchMock)).toHaveLength(2))
    const staleSignal = callsOf(fetchMock)[1][1]!.signal as AbortSignal
    expect(staleSignal.aborted).toBe(false)

    fetchMock.mockResolvedValueOnce(jsonResponse(page([own('b1')], 'cur-b')))
    rerender(B)
    await waitFor(() => expect(result.current.phase).toBe('ready'))
    expect(staleSignal.aborted).toBe(true)
    expect(result.current).toMatchObject({ hasMore: true, loadingMore: false })

    fetchMock.mockResolvedValueOnce(jsonResponse(page([own('b2')], null)))
    act(() => result.current.loadMore())
    await waitFor(() =>
      expect(result.current.rows.map(l => l.id)).toEqual(['b1', 'b2'])
    )
    expect(queries()[queries().length - 1]).toMatchObject({
      cursor: 'cur-b',
      status: 'archived',
    })
  })

  it('reloading page one releases a stalled LOAD MORE', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(page([own('a1')], 'cur-a')))
    fetchMock.mockImplementationOnce(
      () => new Promise<Response>(() => undefined)
    )
    const { result } = renderHook(
      () => useSharedListIndex({ status: 'active', includeShared: true }),
      { wrapper }
    )
    await waitFor(() => expect(result.current.phase).toBe('ready'))
    act(() => result.current.loadMore())
    await waitFor(() => expect(callsOf(fetchMock)).toHaveLength(2))

    fetchMock.mockResolvedValueOnce(
      jsonResponse(page([own('a1')], 'cur-fresh'))
    )
    act(() => result.current.reload())
    await waitFor(() => expect(result.current.phase).toBe('ready'))
    expect(result.current.loadingMore).toBe(false)

    fetchMock.mockResolvedValueOnce(jsonResponse(page([own('a9')], null)))
    act(() => result.current.loadMore())
    await waitFor(() =>
      expect(result.current.rows.map(l => l.id)).toEqual(['a1', 'a9'])
    )
    expect(queries()[queries().length - 1]).toMatchObject({
      cursor: 'cur-fresh',
    })
  })

  it('exposes the forks on the page for the source-neutral shadow note', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        page([makeForkList({ id: 'f', key: 'priority' }), common('c')])
      )
    )
    const { result } = renderHook(() => useSharedListIndex(on), { wrapper })
    await waitFor(() => expect(result.current.phase).toBe('ready'))
    expect(
      result.current.rows.filter(l => l.forked_from).map(l => l.key)
    ).toEqual(['priority'])
  })

  it('forwards page size and locale', async () => {
    fetchMock.mockResolvedValue(jsonResponse(page([])))
    const { result } = renderHook(
      () => useSharedListIndex({ ...on, limit: 25, locale: 'he' }),
      { wrapper }
    )
    await waitFor(() => expect(result.current.phase).toBe('ready'))
    expect(queries()[0]).toMatchObject({ limit: '25', locale: 'he' })
  })

  it('works with no options at all', async () => {
    fetchMock.mockResolvedValue(jsonResponse(page([own('a')])))
    const { result } = renderHook(() => useSharedListIndex(), { wrapper })
    await waitFor(() => expect(result.current.phase).toBe('ready'))
    expect(lastCallOf(fetchMock)[0]).toBe('/api/v1/selection-lists')
  })
})

describe('useSharedListIndex — flag OFF (the approved 4.0.0 index)', () => {
  const wrapper = withSharedLists(false)

  it('sends neither include_shared nor visibility even if the controls ask, and shows no groups', async () => {
    fetchMock.mockResolvedValue(jsonResponse(page([own('a')])))
    const { result } = renderHook(
      () =>
        useSharedListIndex({
          status: 'active',
          includeShared: true,
          visibility: 'platform',
        }),
      { wrapper }
    )
    await waitFor(() => expect(result.current.phase).toBe('ready'))
    expect(lastCallOf(fetchMock)[0]).toBe(
      '/api/v1/selection-lists?status=active'
    )
    expect(result.current.groups).toBeNull()
  })

  it('a LOAD MORE keeps the 4.0.0 request too', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(page([own('a')], 'cur-1')))
    fetchMock.mockResolvedValueOnce(jsonResponse(page([own('b')], null)))
    const { result } = renderHook(
      () => useSharedListIndex({ status: 'active', includeShared: true }),
      { wrapper }
    )
    await waitFor(() => expect(result.current.phase).toBe('ready'))
    act(() => result.current.loadMore())
    await waitFor(() => expect(result.current.rows).toHaveLength(2))
    expect(queries()[1]).toEqual({ status: 'active', cursor: 'cur-1' })
  })
})

describe('useSharedListIndex — no provider mounted', () => {
  it('behaves as flag OFF', async () => {
    fetchMock.mockResolvedValue(jsonResponse(page([own('a')])))
    const { result } = renderHook(() =>
      useSharedListIndex({ includeShared: true })
    )
    await waitFor(() => expect(result.current.phase).toBe('ready'))
    expect(lastCallOf(fetchMock)[0]).toBe('/api/v1/selection-lists')
  })
})
