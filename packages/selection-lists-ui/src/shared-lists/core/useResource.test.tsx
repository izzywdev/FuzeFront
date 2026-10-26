import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useResource } from './useResource'

describe('useResource', () => {
  it('is idle for a null key and never loads', () => {
    const load = vi.fn()
    const { result } = renderHook(() => useResource<string>(null, load))
    expect(result.current.settled).toEqual({ status: 'idle' })
    expect(result.current.token).toBeNull()
    expect(load).not.toHaveBeenCalled()
  })

  it('loading, then done', async () => {
    const { result } = renderHook(() => useResource('k', async () => 'v'))
    expect(result.current.settled).toEqual({ status: 'loading' })
    await waitFor(() =>
      expect(result.current.settled).toEqual({ status: 'done', value: 'v' })
    )
  })

  it('failed carries the error', async () => {
    const boom = new Error('boom')
    const { result } = renderHook(() =>
      useResource('k', async () => {
        throw boom
      })
    )
    await waitFor(() =>
      expect(result.current.settled).toEqual({ status: 'failed', error: boom })
    )
  })

  it('reload re-runs the same key and changes the token', async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce('one')
      .mockResolvedValueOnce('two')
    const { result } = renderHook(() => useResource('k', load))
    await waitFor(() =>
      expect(result.current.settled).toEqual({ status: 'done', value: 'one' })
    )
    const before = result.current.token
    act(() => result.current.reload())
    expect(result.current.settled).toEqual({ status: 'loading' })
    await waitFor(() =>
      expect(result.current.settled).toEqual({ status: 'done', value: 'two' })
    )
    expect(result.current.token).not.toBe(before)
  })

  it("a new key never shows the old key's value", async () => {
    const { result, rerender } = renderHook(
      ({ k }) => useResource(k, async () => k),
      {
        initialProps: { k: 'a' },
      }
    )
    await waitFor(() =>
      expect(result.current.settled).toEqual({ status: 'done', value: 'a' })
    )
    rerender({ k: 'b' })
    expect(result.current.settled).toEqual({ status: 'loading' })
    await waitFor(() =>
      expect(result.current.settled).toEqual({ status: 'done', value: 'b' })
    )
  })

  it('aborts the superseded request and discards its late answer', async () => {
    const resolvers: Array<(v: string) => void> = []
    const signals: AbortSignal[] = []
    const load = (signal: AbortSignal) => {
      signals.push(signal)
      return new Promise<string>(resolve => resolvers.push(resolve))
    }
    const { result, rerender } = renderHook(({ k }) => useResource(k, load), {
      initialProps: { k: 'a' },
    })
    await waitFor(() => expect(resolvers).toHaveLength(1))
    rerender({ k: 'b' })
    await waitFor(() => expect(resolvers).toHaveLength(2))
    expect(signals[0].aborted).toBe(true)
    expect(signals[1].aborted).toBe(false)

    await act(async () => resolvers[0]('stale'))
    expect(result.current.settled).toEqual({ status: 'loading' })
    await act(async () => resolvers[1]('fresh'))
    expect(result.current.settled).toEqual({ status: 'done', value: 'fresh' })
  })

  it('an error from a superseded request is discarded; an AbortError is never an error', async () => {
    const rejecters: Array<(e: unknown) => void> = []
    const load = () =>
      new Promise<string>((_, reject) => rejecters.push(reject))
    const { result, rerender, unmount } = renderHook(
      ({ k }) => useResource(k, load),
      {
        initialProps: { k: 'a' },
      }
    )
    await waitFor(() => expect(rejecters).toHaveLength(1))
    rerender({ k: 'b' })
    await waitFor(() => expect(rejecters).toHaveLength(2))
    await act(async () => rejecters[0](new Error('late')))
    expect(result.current.settled).toEqual({ status: 'loading' })
    await act(async () => rejecters[1](new DOMException('x', 'AbortError')))
    expect(result.current.settled).toEqual({ status: 'loading' })
    unmount()
  })

  it('uses the latest loader without restarting the request', async () => {
    const first = vi.fn().mockResolvedValue('first')
    const second = vi.fn().mockResolvedValue('second')
    const { result, rerender } = renderHook(
      ({ load }) => useResource('k', load),
      {
        initialProps: { load: first },
      }
    )
    rerender({ load: second })
    await waitFor(() => expect(result.current.settled.status).toBe('done'))
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).not.toHaveBeenCalled()
    act(() => result.current.reload())
    await waitFor(() => expect(second).toHaveBeenCalledTimes(1))
  })

  it("A -> B -> A is a NEW request: the first A's answer is never shown for the second A", async () => {
    const loads: Array<(v: string) => void> = []
    const load = () => new Promise<string>(resolve => loads.push(resolve))
    const { result, rerender } = renderHook(
      ({ k }) => useResource<string>(k, load),
      { initialProps: { k: 'A' as string | null } }
    )
    await waitFor(() => expect(loads).toHaveLength(1))
    await act(async () => loads[0]('first A'))
    expect(result.current.settled).toEqual({ status: 'done', value: 'first A' })
    const firstToken = result.current.token

    rerender({ k: 'B' })
    await waitFor(() => expect(loads).toHaveLength(2))
    rerender({ k: 'A' })
    await waitFor(() => expect(loads).toHaveLength(3))
    expect(result.current.settled).toEqual({ status: 'loading' })
    expect(result.current.token).not.toBe(firstToken)
    await act(async () => loads[2]('second A'))
    expect(result.current.settled).toEqual({
      status: 'done',
      value: 'second A',
    })
  })

  it('A -> null -> A is a new request too', async () => {
    const { result, rerender } = renderHook(
      ({ k }) => useResource<string>(k, async () => 'v'),
      { initialProps: { k: 'A' as string | null } }
    )
    await waitFor(() => expect(result.current.settled.status).toBe('done'))
    const first = result.current.token
    rerender({ k: null })
    expect(result.current.token).toBeNull()
    rerender({ k: 'A' })
    expect(result.current.token).not.toBe(first)
    expect(result.current.settled).toEqual({ status: 'loading' })
    await waitFor(() => expect(result.current.settled.status).toBe('done'))
  })
})
