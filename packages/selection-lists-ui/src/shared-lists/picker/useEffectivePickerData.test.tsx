import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  COMMON_ITEMS,
  FORK_ITEMS,
  callsMade,
  commonWorld,
  forbidden,
  forkWorld,
  mountWorld,
  resolved,
  serverError,
} from '../../test/effectivePickerWorld'
import {
  COMMON_ID,
  FORK_ID,
  makeForkList,
  makeSharedList,
} from '../../test/sharedListsFixtures'
import { withSharedLists } from '../../test/sharedListsWrapper'
import { MAX_EFFECTIVE_LOOKUP_PAGES } from '../core/api'
import { useEffectivePickerData } from './useEffectivePickerData'

afterEach(() => {
  vi.unstubAllGlobals()
})

const on = withSharedLists(true)
const hook = (listKey = 'priority', storedIds: string[] = [], opts = {}) =>
  renderHook(() => useEffectivePickerData({ listKey, storedIds, ...opts }), {
    wrapper: on,
  })

describe('useEffectivePickerData — flag OFF', () => {
  it('is inert: no request of any kind, enabled=false', async () => {
    const fetchMock = mountWorld(forkWorld())
    const { result } = renderHook(
      () => useEffectivePickerData({ listKey: 'priority', storedIds: ['x'] }),
      { wrapper: withSharedLists(false) }
    )
    await act(async () => {})
    expect(result.current.enabled).toBe(false)
    expect(result.current.loadState).toBe('loading')
    expect(result.current.list).toBeNull()
    expect(result.current.source).toBeNull()
    expect(result.current.incomplete).toBe(false)
    expect(() => result.current.retryLoad()).not.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('without any provider it is OFF too (a 4.0.0 host)', async () => {
    const fetchMock = mountWorld(forkWorld())
    const { result } = renderHook(() =>
      useEffectivePickerData({ listKey: 'priority', storedIds: [] })
    )
    await act(async () => {})
    expect(result.current.enabled).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('useEffectivePickerData — flag ON', () => {
  it('ONE lookup, then the items of THAT list only (active, in sort_order)', async () => {
    const fetchMock = mountWorld(forkWorld())
    const { result } = hook()
    expect(result.current.loadState).toBe('loading')
    await waitFor(() => expect(result.current.loadState).toBe('loaded'))
    expect(result.current.list?.id).toBe(FORK_ID)
    expect(result.current.source).toMatchObject({ kind: 'fork' })
    expect(result.current.items.map(i => i.label)).toEqual(['Low', 'Medium', 'High'])
    const calls = callsMade(fetchMock)
    expect(calls).toHaveLength(2)
    expect(calls[0].query.get('key')).toBe('priority')
    expect(calls[0].query.get('include_shared')).toBe('true')
    expect(calls[0].query.get('limit')).toBe('1')
    expect(calls[1].path).toBe(`/v1/selection-lists/${FORK_ID}/items`)
    expect(calls[1].query.get('status')).toBe('active')
  })

  it('no fork → the common list is the effective one', async () => {
    mountWorld(commonWorld())
    const { result } = hook()
    await waitFor(() => expect(result.current.loadState).toBe('loaded'))
    expect(result.current.list?.id).toBe(COMMON_ID)
    expect(result.current.source).toEqual({ kind: 'common' })
    expect(result.current.items.map(i => i.id)).toEqual([
      COMMON_ITEMS.low,
      COMMON_ITEMS.normal,
      COMMON_ITEMS.high,
    ])
  })

  it('follows an items cursor to the end', async () => {
    const fetchMock = mountWorld(forkWorld())
    const base = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (/\/items/.test(url) && !/cursor=/.test(url)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              {
                id: 'front_sli_p1',
                list_id: FORK_ID,
                code: 'P1',
                label: 'Page one',
                status: 'active',
                sort_order: 1,
              },
            ],
            page: { nextCursor: 'c2', hasMore: true },
          }),
        } as Response
      }
      return base(url, init)
    })
    const { result } = hook()
    await waitFor(() => expect(result.current.loadState).toBe('loaded'))
    expect(result.current.items.map(i => i.label)).toEqual([
      'Page one',
      'Low',
      'Medium',
      'High',
    ])
    const itemCalls = callsMade(fetchMock).filter(c => /\/items$/.test(c.path))
    expect(itemCalls).toHaveLength(2)
    expect(itemCalls[1].query.get('cursor')).toBe('c2')
  })

  it('an empty TERMINAL page is "not-found"; an empty page with a next cursor is followed first', async () => {
    mountWorld(
      forkWorld({
        lookupPages: [
          { items: [], nextCursor: 'next' },
          { items: [makeSharedList({ key: 'priority', id: COMMON_ID })] },
        ],
      })
    )
    const walked = hook()
    await waitFor(() => expect(walked.result.current.loadState).toBe('loaded'))
    expect(walked.result.current.list?.id).toBe(COMMON_ID)

    mountWorld(forkWorld({ lookupPages: [{ items: [] }] }))
    const none = hook()
    await waitFor(() => expect(none.result.current.loadState).toBe('not-found'))
    expect(none.result.current.list).toBeNull()
  })

  it('a lookup that runs out of pages is an INCOMPLETE error — never "not-found"', async () => {
    mountWorld(
      forkWorld({
        lookupPages: Array.from({ length: MAX_EFFECTIVE_LOOKUP_PAGES + 1 }, () => ({
          items: [],
          nextCursor: 'more',
        })),
      })
    )
    const { result } = hook()
    await waitFor(() => expect(result.current.loadState).toBe('error'))
    expect(result.current.incomplete).toBe(true)
  })

  it('a 403 on the lookup is an error (a developer-role caller), not "not-found"; no items are read', async () => {
    const fetchMock = mountWorld(
      forkWorld({
        fail: url => (/selection-lists\?/.test(url) ? forbidden() : undefined),
      })
    )
    const { result } = hook()
    await waitFor(() => expect(result.current.loadState).toBe('error'))
    expect(result.current.incomplete).toBe(false)
    expect(callsMade(fetchMock).filter(c => /items/.test(c.path))).toHaveLength(0)
  })

  it('retry after a failed lookup asks the lookup again, then loads that list', async () => {
    let failures = 1
    const fetchMock = mountWorld(
      forkWorld({
        fail: url =>
          /selection-lists\?/.test(url) && failures-- > 0 ? serverError() : undefined,
      })
    )
    const { result } = hook()
    await waitFor(() => expect(result.current.loadState).toBe('error'))
    act(() => result.current.retryLoad())
    await waitFor(() => expect(result.current.loadState).toBe('loaded'))
    expect(
      callsMade(fetchMock).filter(c => c.path === '/v1/selection-lists')
    ).toHaveLength(2)
  })

  it('a failed items read is an error whose retry re-reads the SAME list (no second lookup)', async () => {
    let failures = 1
    const fetchMock = mountWorld(
      forkWorld({
        fail: url => (/\/items/.test(url) && failures-- > 0 ? serverError() : undefined),
      })
    )
    const { result } = hook()
    await waitFor(() => expect(result.current.loadState).toBe('error'))
    act(() => result.current.retryLoad())
    await waitFor(() => expect(result.current.loadState).toBe('loaded'))
    const calls = callsMade(fetchMock)
    expect(calls.filter(c => c.path === '/v1/selection-lists')).toHaveLength(1)
    expect(new Set(calls.filter(c => /items/.test(c.path)).map(c => c.path)).size).toBe(1)
  })

  it('a key that already is a list id is used as-is: no lookup, no source', async () => {
    const fetchMock = mountWorld(forkWorld())
    const { result } = hook(FORK_ID)
    await waitFor(() => expect(result.current.loadState).toBe('loaded'))
    expect(result.current.list).toBeNull()
    expect(result.current.source).toBeNull()
    expect(callsMade(fetchMock).map(c => c.path)).toEqual([
      `/v1/selection-lists/${FORK_ID}/items`,
    ])
  })

  it('resolves the stored ids in ONE request, independently of the options', async () => {
    const fetchMock = mountWorld(
      forkWorld({
        resolve: {
          [COMMON_ITEMS.normal]: resolved('Medium', {
            effective_item_id: FORK_ITEMS.medium,
          }),
        },
      })
    )
    const onEffectiveValue = vi.fn()
    const { result } = hook('priority', [COMMON_ITEMS.normal], { onEffectiveValue })
    await waitFor(() => expect(result.current.stored.status).toBe('resolved'))
    await waitFor(() => expect(result.current.loadState).toBe('loaded'))
    expect(
      callsMade(fetchMock).filter(c => c.path === '/v1/resolve')
    ).toHaveLength(1)
    expect(onEffectiveValue).toHaveBeenCalledTimes(1)
    expect(onEffectiveValue).toHaveBeenCalledWith(COMMON_ITEMS.normal, FORK_ITEMS.medium)
  })

  it('a failed resolve never calls onEffectiveValue and retry recovers', async () => {
    let failures = 1
    mountWorld(
      forkWorld({
        resolve: {
          [COMMON_ITEMS.normal]: resolved('Medium', {
            effective_item_id: FORK_ITEMS.medium,
          }),
        },
        fail: url => (/resolve/.test(url) && failures-- > 0 ? serverError() : undefined),
      })
    )
    const onEffectiveValue = vi.fn()
    const { result } = hook('priority', [COMMON_ITEMS.normal], { onEffectiveValue })
    await waitFor(() => expect(result.current.stored.status).toBe('error'))
    expect(onEffectiveValue).not.toHaveBeenCalled()
    act(() => result.current.stored.retry())
    await waitFor(() => expect(result.current.stored.status).toBe('resolved'))
    expect(onEffectiveValue).toHaveBeenCalledTimes(1)
  })

  it('a private fork the lookup returns is a draft source', async () => {
    mountWorld(
      forkWorld({ lookupPages: [{ items: [makeForkList({ visibility: 'private' })] }] })
    )
    const { result } = hook()
    await waitFor(() => expect(result.current.loadState).toBe('loaded'))
    expect(result.current.source).toMatchObject({ kind: 'draft-fork' })
  })
})
