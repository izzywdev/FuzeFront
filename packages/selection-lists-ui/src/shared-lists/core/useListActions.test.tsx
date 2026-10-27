import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useChangeVisibility,
  useForkList,
  useRestoreList,
} from './useListActions'
import {
  COMMON_ID,
  FORK_ID,
  callsOf,
  flush,
  jsonResponse,
  makeForkList,
  makeSharedList,
  stubFetch,
} from '../../test/sharedListsFixtures'

let fetchMock: ReturnType<typeof stubFetch>
beforeEach(() => {
  fetchMock = stubFetch()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useForkList (frames 05, 06)', () => {
  it('idle → submitting → done(created); run resolves to the same outcome', async () => {
    const list = makeForkList()
    fetchMock.mockResolvedValue(jsonResponse(list, 201))
    const { result } = renderHook(() => useForkList())
    expect(result.current.state).toEqual({ status: 'idle' })

    let outcome: unknown
    act(() => {
      void result.current.run(COMMON_ID, 'org').then(o => (outcome = o))
    })
    expect(result.current.state).toEqual({ status: 'submitting' })
    await waitFor(() => expect(result.current.state.status).toBe('done'))
    expect(result.current.state).toEqual({
      status: 'done',
      outcome: { kind: 'created', list },
    })
    expect(outcome).toEqual({ kind: 'created', list })
  })

  it('a double-submit while in flight sends ONE request and both callers get the same outcome', async () => {
    let release: (r: Response) => void = () => undefined
    fetchMock.mockImplementation(
      () => new Promise<Response>(resolve => (release = resolve))
    )
    const { result } = renderHook(() => useForkList())

    let first!: Promise<unknown>
    let second!: Promise<unknown>
    act(() => {
      first = result.current.run(COMMON_ID, 'org')
      second = result.current.run(COMMON_ID, 'private')
    })
    await waitFor(() => expect(callsOf(fetchMock)).toHaveLength(1))
    await flush()
    expect(callsOf(fetchMock)).toHaveLength(1)
    expect(JSON.parse(callsOf(fetchMock)[0][1]!.body as string)).toEqual({
      visibility: 'org',
    })

    await act(async () => release(jsonResponse(makeForkList(), 201)))
    expect(await first).toEqual(await second)
  })

  it('a refusal stays as the outcome until reset (it sits in place of the options)', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { code: 'CONFLICT', reason: 'fork_exists', message: 'x' },
        409
      )
    )
    const { result } = renderHook(() => useForkList())
    await act(async () => {
      await result.current.run(COMMON_ID)
    })
    expect(result.current.state).toEqual({
      status: 'done',
      outcome: { kind: 'fork_exists' },
    })
    act(() => result.current.reset())
    expect(result.current.state).toEqual({ status: 'idle' })
  })

  it('"try again" after an unknown outcome re-sends the same request and can succeed (200 → existing)', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const existing = makeForkList()
    fetchMock.mockResolvedValueOnce(jsonResponse(existing, 200))
    const { result } = renderHook(() => useForkList())
    await act(async () => {
      await result.current.run(COMMON_ID, 'org')
    })
    expect(result.current.state).toEqual({
      status: 'done',
      outcome: { kind: 'unknown_outcome', status: undefined },
    })
    await act(async () => {
      await result.current.run(COMMON_ID, 'org')
    })
    expect(result.current.state).toEqual({
      status: 'done',
      outcome: { kind: 'existing', list: existing },
    })
    expect(callsOf(fetchMock)).toHaveLength(2)
    expect(callsOf(fetchMock)[1][1]!.body).toBe(callsOf(fetchMock)[0][1]!.body)
  })

  it('a rejected command (a cancelled request) returns to idle and rejects the caller', async () => {
    fetchMock.mockRejectedValue(new DOMException('aborted', 'AbortError'))
    const { result } = renderHook(() => useForkList())
    await act(async () => {
      await expect(result.current.run(COMMON_ID)).rejects.toMatchObject({
        name: 'AbortError',
      })
    })
    expect(result.current.state).toEqual({ status: 'idle' })
    // and it is usable again
    fetchMock.mockResolvedValue(jsonResponse(makeForkList(), 201))
    await act(async () => {
      await result.current.run(COMMON_ID)
    })
    expect(result.current.state.status).toBe('done')
  })

  it('does not abort a write on unmount and does not set state afterwards', async () => {
    let release: (r: Response) => void = () => undefined
    fetchMock.mockImplementation(
      () => new Promise<Response>(resolve => (release = resolve))
    )
    const { result, unmount } = renderHook(() => useForkList())
    let pending!: Promise<unknown>
    act(() => {
      pending = result.current.run(COMMON_ID, 'org')
    })
    await waitFor(() => expect(callsOf(fetchMock)).toHaveLength(1))
    const signal = callsOf(fetchMock)[0][1]!.signal
    unmount()
    expect(signal?.aborted ?? false).toBe(false)
    release(jsonResponse(makeForkList(), 201))
    expect(await pending).toMatchObject({ kind: 'created' })
  })

  it('an unmounted view that fails does not set state either', async () => {
    let fail: (e: Error) => void = () => undefined
    fetchMock.mockImplementation(
      () => new Promise<Response>((_, reject) => (fail = reject))
    )
    const { result, unmount } = renderHook(() => useForkList())
    let pending!: Promise<unknown>
    act(() => {
      pending = result.current.run(COMMON_ID)
    })
    await waitFor(() => expect(callsOf(fetchMock)).toHaveLength(1))
    unmount()
    fail(new DOMException('aborted', 'AbortError'))
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('keeps one stable run identity across renders', () => {
    const { result, rerender } = renderHook(() => useForkList())
    const run = result.current.run
    rerender()
    expect(result.current.run).toBe(run)
  })
})

describe('useRestoreList (frame 06)', () => {
  it('runs the restore PATCH and holds the outcome', async () => {
    const list = makeForkList()
    fetchMock.mockResolvedValue(jsonResponse(list))
    const { result } = renderHook(() => useRestoreList())
    await act(async () => {
      await result.current.run(FORK_ID)
    })
    expect(result.current.state).toEqual({
      status: 'done',
      outcome: { kind: 'restored', list },
    })
  })

  it('holds a quota refusal', async () => {
    fetchMock.mockResolvedValue(
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
    const { result } = renderHook(() => useRestoreList())
    await act(async () => {
      await result.current.run(FORK_ID)
    })
    expect(result.current.state).toEqual({
      status: 'done',
      outcome: { kind: 'quota', scope: 'org_lists', limit: 100, current: 100 },
    })
  })
})

describe('useChangeVisibility (frame 08)', () => {
  it('runs the visibility PATCH and holds the changed list', async () => {
    const list = makeSharedList({ visibility: 'private' })
    fetchMock.mockResolvedValue(jsonResponse(list))
    const { result } = renderHook(() => useChangeVisibility())
    await act(async () => {
      await result.current.run(FORK_ID, 'private')
    })
    expect(JSON.parse(callsOf(fetchMock)[0][1]!.body as string)).toEqual({
      visibility: 'private',
    })
    expect(result.current.state).toEqual({
      status: 'done',
      outcome: { kind: 'changed', list },
    })
  })

  it('holds a visibility_locked refusal', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { code: 'CONFLICT', reason: 'visibility_locked', message: 'locked' },
        409
      )
    )
    const { result } = renderHook(() => useChangeVisibility())
    await act(async () => {
      await result.current.run(COMMON_ID, 'private')
    })
    expect(result.current.state).toEqual({
      status: 'done',
      outcome: { kind: 'locked' },
    })
  })
})
