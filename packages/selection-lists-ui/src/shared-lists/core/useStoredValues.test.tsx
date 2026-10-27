import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStoredValues } from './useStoredValues'
import {
  callsOf,
  jsonResponse,
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

const COMMON_ITEM = 'front_sli_01jf8k2m3n4p5q6r7s8t9v0wa2'
const FORK_ITEM = 'front_sli_01jfq3w8z6y5x4c3b2a1n9m8b2'
const PRIVATE_ITEM = 'front_sli_01jf8k2m3n4p5q6r7s8t9v0wa3'
const ARCHIVED_ITEM = 'front_sli_01jf8k2m3n4p5q6r7s8t9v0wa5'
const OTHER_ORG_ITEM = 'front_sli_01jf8k2m3n4p5q6r7s8t9v0zz09'

/** The frame-10 resolve matrix, as the service would answer it. */
const matrixResponse = () =>
  jsonResponse({
    results: {
      [COMMON_ITEM]: {
        label: 'Medium',
        locale: 'en',
        is_machine: false,
        status: 'active',
        effective_item_id: FORK_ITEM,
      },
      [PRIVATE_ITEM]: {
        label: 'High',
        locale: 'en',
        is_machine: false,
        status: 'active',
      },
      [ARCHIVED_ITEM]: {
        label: 'Critical (legacy)',
        locale: 'en',
        is_machine: false,
        status: 'archived',
      },
    },
    missing: [OTHER_ORG_ITEM],
  })

describe('useStoredValues — flag ON (frame 10)', () => {
  const wrapper = withSharedLists(true)

  it('is resolving (control not yet editable), then resolved with every outcome accounted for', async () => {
    fetchMock.mockResolvedValue(matrixResponse())
    const { result } = renderHook(
      () =>
        useStoredValues([
          COMMON_ITEM,
          PRIVATE_ITEM,
          ARCHIVED_ITEM,
          OTHER_ORG_ITEM,
        ]),
      { wrapper }
    )
    expect(result.current.status).toBe('resolving')
    expect(result.current.outcomes).toEqual({})
    await waitFor(() => expect(result.current.status).toBe('resolved'))
    expect(callsOf(fetchMock)).toHaveLength(1)
    const { outcomes } = result.current
    expect(outcomes[COMMON_ITEM]).toMatchObject({
      kind: 'resolved',
      label: 'Medium',
      effectiveItemId: FORK_ITEM,
    })
    expect(outcomes[PRIVATE_ITEM]).toMatchObject({
      kind: 'resolved',
      label: 'High',
      effectiveItemId: null,
    })
    expect(outcomes[ARCHIVED_ITEM]).toMatchObject({
      kind: 'resolved',
      status: 'archived',
    })
    expect(outcomes[OTHER_ORG_ITEM]).toEqual({
      kind: 'missing',
      id: OTHER_ORG_ITEM,
    })
    expect(result.current.redirects).toEqual([
      { stored: COMMON_ITEM, effective: FORK_ITEM },
    ])
  })

  it('calls onEffectiveValue ONCE per redirected id, only after a successful resolve', async () => {
    fetchMock.mockResolvedValue(matrixResponse())
    const onEffectiveValue = vi.fn()
    const { result, rerender } = renderHook(
      () => useStoredValues([COMMON_ITEM, PRIVATE_ITEM], { onEffectiveValue }),
      { wrapper }
    )
    expect(onEffectiveValue).not.toHaveBeenCalled()
    await waitFor(() => expect(result.current.status).toBe('resolved'))
    expect(onEffectiveValue).toHaveBeenCalledTimes(1)
    expect(onEffectiveValue).toHaveBeenCalledWith(COMMON_ITEM, FORK_ITEM)
    rerender()
    rerender()
    expect(onEffectiveValue).toHaveBeenCalledTimes(1)
  })

  it('never rewrites the stored id: the outcome is keyed by it, and the effective id is only reported', async () => {
    fetchMock.mockResolvedValue(matrixResponse())
    const { result } = renderHook(() => useStoredValues([COMMON_ITEM]), {
      wrapper,
    })
    await waitFor(() => expect(result.current.status).toBe('resolved'))
    expect(Object.keys(result.current.outcomes)).toEqual([COMMON_ITEM])
  })

  it('a failed resolve calls nothing and keeps the stored id untouched; retry recovers and then notifies once', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 'UNKNOWN' }, 503))
    fetchMock.mockResolvedValueOnce(matrixResponse())
    const onEffectiveValue = vi.fn()
    const { result } = renderHook(
      () => useStoredValues([COMMON_ITEM], { onEffectiveValue }),
      { wrapper }
    )
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.outcomes).toEqual({})
    expect(onEffectiveValue).not.toHaveBeenCalled()
    act(() => result.current.retry())
    await waitFor(() => expect(result.current.status).toBe('resolved'))
    expect(onEffectiveValue).toHaveBeenCalledTimes(1)
  })

  it('a retry that resolves the same redirect again does not notify twice', async () => {
    fetchMock.mockResolvedValue(matrixResponse())
    const onEffectiveValue = vi.fn()
    const { result } = renderHook(
      () => useStoredValues([COMMON_ITEM], { onEffectiveValue }),
      { wrapper }
    )
    await waitFor(() => expect(result.current.status).toBe('resolved'))
    act(() => result.current.retry())
    await waitFor(() => expect(callsOf(fetchMock)).toHaveLength(2))
    await waitFor(() => expect(result.current.status).toBe('resolved'))
    expect(onEffectiveValue).toHaveBeenCalledTimes(1)
  })

  it('a host re-creating the same ids array each render does not re-resolve', async () => {
    fetchMock.mockResolvedValue(matrixResponse())
    const { result, rerender } = renderHook(
      () => useStoredValues([COMMON_ITEM, PRIVATE_ITEM]),
      { wrapper }
    )
    await waitFor(() => expect(result.current.status).toBe('resolved'))
    rerender()
    rerender()
    expect(callsOf(fetchMock)).toHaveLength(1)
  })

  it('new ids resolve again (and report loading until THEIR answer lands)', async () => {
    fetchMock.mockResolvedValueOnce(matrixResponse())
    const { result, rerender } = renderHook(({ ids }) => useStoredValues(ids), {
      wrapper,
      initialProps: { ids: [COMMON_ITEM] },
    })
    await waitFor(() => expect(result.current.status).toBe('resolved'))
    fetchMock.mockResolvedValueOnce(matrixResponse())
    rerender({ ids: [PRIVATE_ITEM] })
    expect(result.current.status).toBe('resolving')
    expect(result.current.outcomes).toEqual({})
    await waitFor(() => expect(result.current.status).toBe('resolved'))
    expect(callsOf(fetchMock)).toHaveLength(2)
  })

  it('notifies again for a fresh set of ids with the same redirect', async () => {
    fetchMock.mockResolvedValue(matrixResponse())
    const onEffectiveValue = vi.fn()
    const { result, rerender } = renderHook(
      ({ ids }) => useStoredValues(ids, { onEffectiveValue }),
      {
        wrapper,
        initialProps: { ids: [COMMON_ITEM] },
      }
    )
    await waitFor(() => expect(result.current.status).toBe('resolved'))
    rerender({ ids: [COMMON_ITEM, PRIVATE_ITEM] })
    await waitFor(() => expect(callsOf(fetchMock)).toHaveLength(2))
    await waitFor(() =>
      expect(result.current.outcomes[PRIVATE_ITEM]).toBeDefined()
    )
    expect(onEffectiveValue).toHaveBeenCalledTimes(2)
  })

  it('uses the latest onEffectiveValue callback', async () => {
    fetchMock.mockResolvedValue(matrixResponse())
    const first = vi.fn()
    const second = vi.fn()
    const { result, rerender } = renderHook(
      ({ cb }) => useStoredValues([COMMON_ITEM], { onEffectiveValue: cb }),
      {
        wrapper,
        initialProps: { cb: first },
      }
    )
    rerender({ cb: second })
    await waitFor(() => expect(result.current.status).toBe('resolved'))
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('is idle — and sends nothing — with no ids (empty strings and duplicates ignored)', () => {
    const { result } = renderHook(() => useStoredValues(['', '']), { wrapper })
    expect(result.current.status).toBe('idle')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('de-duplicates ids before asking', async () => {
    fetchMock.mockResolvedValue(matrixResponse())
    const { result } = renderHook(
      () => useStoredValues([COMMON_ITEM, COMMON_ITEM]),
      { wrapper }
    )
    await waitFor(() => expect(result.current.status).toBe('resolved'))
    expect(JSON.parse(callsOf(fetchMock)[0][1]!.body as string)).toEqual({
      ids: [COMMON_ITEM],
    })
  })

  it('works without any callback', async () => {
    fetchMock.mockResolvedValue(matrixResponse())
    const { result } = renderHook(() => useStoredValues([COMMON_ITEM]), {
      wrapper,
    })
    await waitFor(() => expect(result.current.status).toBe('resolved'))
  })
})

describe('useStoredValues — flag OFF (4.0.0 unchanged)', () => {
  const wrapper = withSharedLists(false)

  it('ignores a stray effective_item_id and never calls onEffectiveValue', async () => {
    fetchMock.mockResolvedValue(matrixResponse())
    const onEffectiveValue = vi.fn()
    const { result } = renderHook(
      () => useStoredValues([COMMON_ITEM], { onEffectiveValue }),
      { wrapper }
    )
    await waitFor(() => expect(result.current.status).toBe('resolved'))
    expect(result.current.outcomes[COMMON_ITEM]).toMatchObject({
      kind: 'resolved',
      effectiveItemId: null,
    })
    expect(result.current.redirects).toEqual([])
    expect(onEffectiveValue).not.toHaveBeenCalled()
  })
})
