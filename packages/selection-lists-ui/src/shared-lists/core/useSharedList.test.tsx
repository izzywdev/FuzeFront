import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSharedList } from './useSharedList'
import {
  COMMON_ID,
  callsOf,
  jsonResponse,
  makeCommonList,
  makeSharedList,
  queryOf,
  stubFetch,
} from '../../test/sharedListsFixtures'

let fetchMock: ReturnType<typeof stubFetch>
beforeEach(() => {
  fetchMock = stubFetch()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useSharedList (frames 02, 03)', () => {
  it('loading — nothing guesses "editable" — then ready with the 4.1.0 fields', async () => {
    fetchMock.mockResolvedValue(jsonResponse(makeCommonList()))
    const { result } = renderHook(() => useSharedList(COMMON_ID))
    expect(result.current).toMatchObject({
      phase: 'loading',
      list: null,
      error: null,
    })
    await waitFor(() => expect(result.current.phase).toBe('ready'))
    expect(result.current.list).toMatchObject({
      visibility: 'platform',
      editable: false,
    })
    expect(callsOf(fetchMock)[0][0]).toBe(
      `/api/v1/selection-lists/${COMMON_ID}`
    )
  })

  it("404 is not_found — another org's list and a list that never existed look the same", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ code: 'NOT_FOUND', message: 'x' }, 404)
    )
    const { result } = renderHook(() => useSharedList(COMMON_ID))
    await waitFor(() => expect(result.current.phase).toBe('not_found'))
    expect(result.current.list).toBeNull()
  })

  it('anything else is an error, and reload recovers', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 'UNKNOWN' }, 500))
    fetchMock.mockResolvedValueOnce(jsonResponse(makeCommonList()))
    const { result } = renderHook(() => useSharedList(COMMON_ID))
    await waitFor(() => expect(result.current.phase).toBe('error'))
    expect(result.current.error).toMatchObject({ kind: 'unknown', status: 500 })
    act(() => result.current.reload())
    await waitFor(() => expect(result.current.phase).toBe('ready'))
  })

  it('passes the locale', async () => {
    fetchMock.mockResolvedValue(jsonResponse(makeCommonList()))
    const { result } = renderHook(() =>
      useSharedList(COMMON_ID, { locale: 'ar' })
    )
    await waitFor(() => expect(result.current.phase).toBe('ready'))
    expect(queryOf(callsOf(fetchMock)[0][0]).locale).toBe('ar')
  })

  it("setList patches the loaded list from a command's returned entity — no re-read", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(makeSharedList({ visibility: 'org' }))
    )
    const { result } = renderHook(() => useSharedList('front_sl_x'))
    await waitFor(() => expect(result.current.phase).toBe('ready'))
    act(() => result.current.setList(makeSharedList({ visibility: 'private' })))
    expect(result.current.list?.visibility).toBe('private')
    expect(callsOf(fetchMock)).toHaveLength(1)
  })

  it('reload discards the patch in favour of a fresh read', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(makeSharedList({ visibility: 'org' }))
    )
    const { result } = renderHook(() => useSharedList('front_sl_x'))
    await waitFor(() => expect(result.current.phase).toBe('ready'))
    act(() => result.current.setList(makeSharedList({ visibility: 'private' })))
    fetchMock.mockResolvedValueOnce(
      jsonResponse(makeSharedList({ visibility: 'org', name: 'Fresh' }))
    )
    act(() => result.current.reload())
    await waitFor(() => expect(result.current.list?.name).toBe('Fresh'))
    expect(result.current.list?.visibility).toBe('org')
  })

  it('a new list id reports loading at once', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(makeSharedList({ id: 'front_sl_a', name: 'A' }))
    )
    const { result, rerender } = renderHook(({ id }) => useSharedList(id), {
      initialProps: { id: 'front_sl_a' },
    })
    await waitFor(() => expect(result.current.phase).toBe('ready'))
    fetchMock.mockResolvedValueOnce(
      jsonResponse(makeSharedList({ id: 'front_sl_b', name: 'B' }))
    )
    rerender({ id: 'front_sl_b' })
    expect(result.current.phase).toBe('loading')
    await waitFor(() => expect(result.current.list?.name).toBe('B'))
  })

  it('without an id it stays loading and sends nothing', () => {
    const { result } = renderHook(() => useSharedList(undefined))
    expect(result.current.phase).toBe('loading')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
