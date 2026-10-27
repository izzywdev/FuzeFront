import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useArchiveFork } from './useArchiveFork'
import { FORK_ID, archivePath, error, jsonResponse, routeFetch } from '../../test/provenanceFixtures'
import { makeForkList } from '../../test/sharedListsFixtures'

afterEach(() => vi.unstubAllGlobals())

describe('useArchiveFork', () => {
  it('idle -> submitting -> done(archived)', async () => {
    let release!: () => void
    const gate = new Promise<void>(r => (release = r))
    const fetchMock = routeFetch({
      [archivePath]: async () => {
        await gate
        return jsonResponse(makeForkList({ status: 'archived' }))
      },
    })
    const { result } = renderHook(() => useArchiveFork())
    expect(result.current.state).toEqual({ status: 'idle' })
    let promise!: Promise<unknown>
    act(() => {
      promise = result.current.run(FORK_ID)
    })
    expect(result.current.state).toEqual({ status: 'submitting' })
    release()
    await act(async () => {
      await promise
    })
    expect(result.current.state).toMatchObject({ status: 'done', outcome: { kind: 'archived' } })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('is single-flight: a second run while one is in flight sends nothing', async () => {
    let release!: () => void
    const gate = new Promise<void>(r => (release = r))
    const fetchMock = routeFetch({
      [archivePath]: async () => {
        await gate
        return jsonResponse(makeForkList())
      },
    })
    const { result } = renderHook(() => useArchiveFork())
    let first!: Promise<unknown>
    let second!: Promise<unknown>
    act(() => {
      first = result.current.run(FORK_ID)
      second = result.current.run(FORK_ID)
    })
    expect(second).toBe(first)
    release()
    await act(async () => {
      await first
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('a refusal stays as the outcome until reset()', async () => {
    routeFetch({ [archivePath]: () => error(403, 'FORBIDDEN') })
    const { result } = renderHook(() => useArchiveFork())
    await act(async () => {
      await result.current.run(FORK_ID)
    })
    expect(result.current.state).toEqual({ status: 'done', outcome: { kind: 'forbidden' } })
    act(() => result.current.reset())
    expect(result.current.state).toEqual({ status: 'idle' })
  })

  it('a cancelled request returns to idle and rethrows', async () => {
    routeFetch({
      [archivePath]: () => Promise.reject(new DOMException('aborted', 'AbortError')),
    })
    const { result } = renderHook(() => useArchiveFork())
    await act(async () => {
      await expect(result.current.run(FORK_ID)).rejects.toMatchObject({ name: 'AbortError' })
    })
    expect(result.current.state).toEqual({ status: 'idle' })
  })

  it('does not set state after unmount, and still lets the write finish', async () => {
    let release!: () => void
    const gate = new Promise<void>(r => (release = r))
    const fetchMock = routeFetch({
      [archivePath]: async () => {
        await gate
        return jsonResponse(makeForkList())
      },
    })
    const { result, unmount } = renderHook(() => useArchiveFork())
    let promise!: Promise<unknown>
    act(() => {
      promise = result.current.run(FORK_ID)
    })
    unmount()
    release()
    await expect(promise).resolves.toMatchObject({ kind: 'archived' })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
  })

  it('an unmount during a cancelled request does not set state either', async () => {
    let fail!: () => void
    const gate = new Promise<void>(r => (fail = r))
    routeFetch({
      [archivePath]: async () => {
        await gate
        throw new DOMException('aborted', 'AbortError')
      },
    })
    const { result, unmount } = renderHook(() => useArchiveFork())
    let promise!: Promise<unknown>
    act(() => {
      promise = result.current.run(FORK_ID)
    })
    unmount()
    fail()
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
  })
})
