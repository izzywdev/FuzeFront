import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_EFFECTIVE_LOOKUP_PAGES } from './api'
import { useEffectiveList } from './useEffectiveList'
import {
  COMMON_ID,
  FORK_ID,
  callsOf,
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

const lastUrl = () => lastCallOf(fetchMock)[0]

describe('useEffectiveList — flag ON (frames 09, 10)', () => {
  const wrapper = withSharedLists(true)

  it('loading, then the ONE list the service chose; the org fork wins', async () => {
    fetchMock.mockResolvedValue(jsonResponse(page([makeForkList()])))
    const { result } = renderHook(() => useEffectiveList('priority'), {
      wrapper,
    })
    expect(result.current.status).toBe('loading')
    await waitFor(() => expect(result.current.status).toBe('ready'))
    if (result.current.status !== 'ready') throw new Error('unreachable')
    expect(result.current.list.id).toBe(FORK_ID)
    expect(result.current.source).toEqual({
      kind: 'fork',
      forkedFrom: makeForkList().forked_from,
    })
    expect(callsOf(fetchMock)).toHaveLength(1)
    expect(queryOf(lastUrl())).toEqual({
      limit: '1',
      key: 'priority',
      include_shared: 'true',
    })
  })

  it('no fork → the common list, labelled common', async () => {
    fetchMock.mockResolvedValue(jsonResponse(page([makeCommonList()])))
    const { result } = renderHook(() => useEffectiveList('priority'), {
      wrapper,
    })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    if (result.current.status !== 'ready') throw new Error('unreachable')
    expect(result.current.list.id).toBe(COMMON_ID)
    expect(result.current.source).toEqual({ kind: 'common' })
  })

  it('a private fork is a draft', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(page([makeForkList({ visibility: 'private' })]))
    )
    const { result } = renderHook(() => useEffectiveList('priority'), {
      wrapper,
    })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current).toMatchObject({ source: { kind: 'draft-fork' } })
  })

  it('an empty page is "none" — not an error', async () => {
    fetchMock.mockResolvedValue(jsonResponse(page([])))
    const { result } = renderHook(() => useEffectiveList('priority'), {
      wrapper,
    })
    await waitFor(() => expect(result.current.status).toBe('none'))
  })

  it('a 403 is an ERROR (a developer-role caller), never "List unavailable"', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ code: 'FORBIDDEN', message: 'no' }, 403)
    )
    const { result } = renderHook(() => useEffectiveList('priority'), {
      wrapper,
    })
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current).toMatchObject({ error: { kind: 'forbidden' } })
  })

  it('an empty page with a next cursor is followed: the readable common list is found, not "none"', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(page([], 'cur-1')))
    fetchMock.mockResolvedValueOnce(jsonResponse(page([makeCommonList()])))
    const { result } = renderHook(() => useEffectiveList('priority'), {
      wrapper,
    })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current).toMatchObject({
      list: { id: COMMON_ID },
      source: { kind: 'common' },
    })
    expect(callsOf(fetchMock)).toHaveLength(2)
    expect(queryOf(lastUrl()).cursor).toBe('cur-1')
  })

  it('a terminal empty page is "none"', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(page([], 'c1')))
    fetchMock.mockResolvedValueOnce(jsonResponse(page([], null)))
    const { result } = renderHook(() => useEffectiveList('priority'), {
      wrapper,
    })
    await waitFor(() => expect(result.current.status).toBe('none'))
  })

  it('an exhausted walk is an ERROR (incomplete), never "none"; retry walks again', async () => {
    let n = 0
    fetchMock.mockImplementation(async () => jsonResponse(page([], `c${++n}`)))
    const { result } = renderHook(() => useEffectiveList('priority'), {
      wrapper,
    })
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current).toMatchObject({ error: { kind: 'incomplete' } })
    expect(callsOf(fetchMock)).toHaveLength(MAX_EFFECTIVE_LOOKUP_PAGES)
    fetchMock.mockReset()
    fetchMock.mockResolvedValueOnce(jsonResponse(page([makeCommonList()])))
    act(() => result.current.retry())
    await waitFor(() => expect(result.current.status).toBe('ready'))
  })

  it('a key change mid-walk abandons the old walk and discards its answer', async () => {
    let releaseOld: (r: Response) => void = () => undefined
    fetchMock.mockResolvedValueOnce(jsonResponse(page([], 'c1')))
    fetchMock.mockImplementationOnce(
      () => new Promise<Response>(resolve => (releaseOld = resolve))
    )
    const { result, rerender } = renderHook(({ k }) => useEffectiveList(k), {
      wrapper,
      initialProps: { k: 'priority' },
    })
    await waitFor(() => expect(callsOf(fetchMock)).toHaveLength(2))
    fetchMock.mockResolvedValueOnce(
      jsonResponse(page([makeSharedList({ key: 'status' })]))
    )
    rerender({ k: 'status' })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    await act(async () =>
      releaseOld(jsonResponse(page([makeCommonList({ key: 'priority' })])))
    )
    expect(result.current).toMatchObject({ list: { key: 'status' } })
  })

  it('a failed lookup does NOT fall back to a second, different list', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: 'UNKNOWN' }, 503))
    const { result } = renderHook(() => useEffectiveList('priority'), {
      wrapper,
    })
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(callsOf(fetchMock)).toHaveLength(1)
  })

  it('a key the contract rejects (400) cannot name a list: none, as in the 4.0.0 picker', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ code: 'VALIDATION_ERROR', message: 'bad key' }, 400)
    )
    const { result } = renderHook(() => useEffectiveList('Not A Key'), {
      wrapper,
    })
    await waitFor(() => expect(result.current.status).toBe('none'))
  })

  it('retry re-asks and recovers', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 'UNKNOWN' }, 500))
    fetchMock.mockResolvedValueOnce(jsonResponse(page([makeForkList()])))
    const { result } = renderHook(() => useEffectiveList('priority'), {
      wrapper,
    })
    await waitFor(() => expect(result.current.status).toBe('error'))
    act(() => result.current.retry())
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(callsOf(fetchMock)).toHaveLength(2)
  })

  it("a new key reports loading at once — the previous key's list is never shown for it", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(page([makeForkList({ key: 'priority' })]))
    )
    const { result, rerender } = renderHook(({ k }) => useEffectiveList(k), {
      wrapper,
      initialProps: { k: 'priority' },
    })
    await waitFor(() => expect(result.current.status).toBe('ready'))

    fetchMock.mockResolvedValueOnce(
      jsonResponse(page([makeSharedList({ key: 'status', name: 'Status' })]))
    )
    rerender({ k: 'status' })
    expect(result.current.status).toBe('loading')
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current).toMatchObject({ list: { key: 'status' } })
  })

  it('a different locale asks again', async () => {
    fetchMock.mockResolvedValue(jsonResponse(page([makeForkList()])))
    const { result, rerender } = renderHook(
      ({ locale }) => useEffectiveList('priority', { locale }),
      {
        wrapper,
        initialProps: { locale: 'en' as const } as { locale: 'en' | 'he' },
      }
    )
    await waitFor(() => expect(result.current.status).toBe('ready'))
    rerender({ locale: 'he' })
    await waitFor(() => expect(callsOf(fetchMock)).toHaveLength(2))
    expect(queryOf(lastUrl()).locale).toBe('he')
  })

  it('is idle — and sends nothing — with no key, or when skipped', async () => {
    const none = renderHook(() => useEffectiveList(null), { wrapper })
    const empty = renderHook(() => useEffectiveList(''), { wrapper })
    const skipped = renderHook(
      () => useEffectiveList('priority', { skip: true }),
      { wrapper }
    )
    for (const { result } of [none, empty, skipped])
      expect(result.current.status).toBe('idle')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('cancels the request on unmount', async () => {
    fetchMock.mockImplementation(() => new Promise(() => undefined))
    const { unmount } = renderHook(() => useEffectiveList('priority'), {
      wrapper,
    })
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const signal = (callsOf(fetchMock)[0][1] as RequestInit)
      .signal as AbortSignal
    expect(signal.aborted).toBe(false)
    unmount()
    expect(signal.aborted).toBe(true)
  })
})

describe('useEffectiveList — flag OFF (4.0.0 lookup)', () => {
  const wrapper = withSharedLists(false)

  it('sends GET ?key= exactly — no include_shared, no limit — and renders no source caption', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(page([makeSharedList({ visibility: 'private' })]))
    )
    const { result } = renderHook(() => useEffectiveList('priority'), {
      wrapper,
    })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(lastUrl()).toBe('/api/v1/selection-lists?key=priority')
    expect(result.current).toMatchObject({ source: null })
  })

  it('shows no source even when the service answers with a fork', async () => {
    fetchMock.mockResolvedValue(jsonResponse(page([makeForkList()])))
    const { result } = renderHook(() => useEffectiveList('priority'), {
      wrapper,
    })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current).toMatchObject({ source: null })
  })

  it('does not paginate: an empty page with a cursor is just "none" (4.0.0)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(page([], 'c1')))
    const { result } = renderHook(() => useEffectiveList('priority'), {
      wrapper,
    })
    await waitFor(() => expect(result.current.status).toBe('none'))
    expect(callsOf(fetchMock)).toHaveLength(1)
  })

  it('a key with no own list is "none" (common lists are invisible)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(page([])))
    const { result } = renderHook(() => useEffectiveList('priority'), {
      wrapper,
    })
    await waitFor(() => expect(result.current.status).toBe('none'))
  })
})

describe('useEffectiveList — no provider mounted', () => {
  it('behaves as flag OFF', async () => {
    fetchMock.mockResolvedValue(jsonResponse(page([makeSharedList()])))
    const { result } = renderHook(() => useEffectiveList('priority'))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(lastUrl()).toBe('/api/v1/selection-lists?key=priority')
  })
})
