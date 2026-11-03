import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useForkProvenance } from './useForkProvenance'
import {
  COMMON_ITEM,
  commonItems,
  error,
  jsonResponse,
  page,
  priorityCommon,
  priorityFork,
  routeFetch,
  sourceItemsPath,
  sourcePath,
} from '../../test/provenanceFixtures'
import { makeSharedList } from '../../test/sharedListsFixtures'
import { callsOf } from '../../test/sharedListsFixtures'

afterEach(() => vi.unstubAllGlobals())

const fork = priorityFork()

describe('useForkProvenance', () => {
  it('reads nothing and returns null while the flag is OFF', () => {
    const fetchMock = routeFetch({})
    const { result } = renderHook(() => useForkProvenance(fork, false))
    expect(result.current).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reads nothing and returns null for a list that is not a fork', () => {
    const fetchMock = routeFetch({})
    const { result } = renderHook(() => useForkProvenance(makeSharedList(), true))
    expect(result.current).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns null while the fork itself has not loaded', () => {
    routeFetch({})
    const { result } = renderHook(() => useForkProvenance(null, true))
    expect(result.current).toBeNull()
  })

  it('the recorded facts are there at once; only the comparison waits (checking)', () => {
    routeFetch({
      [sourcePath]: () => new Promise(() => {}),
    })
    const { result } = renderHook(() => useForkProvenance(fork, true))
    expect(result.current).toMatchObject({
      behind: 'checking',
      gate: 'source-unknown',
      recorded: { revision: 7 },
      sourceName: null,
      sourceRevision: null,
    })
  })

  it('source without a revision -> unknown (4.1.x); labels come from the source items', async () => {
    const fetchMock = routeFetch({
      [sourcePath]: () => jsonResponse(priorityCommon({ name: 'Priority (common)' })),
      [sourceItemsPath]: () => jsonResponse(page(commonItems())),
    })
    const { result } = renderHook(() => useForkProvenance(fork, true))
    await waitFor(() => expect(result.current?.behind).toBe('unknown'))
    expect(result.current).toMatchObject({
      gate: 'source-active',
      sourceName: 'Priority (common)',
      sourceRevision: null,
    })
    // "Copied from" before the items arrive says "copied" - then names the common label.
    await waitFor(() =>
      expect(result.current?.originLabel(COMMON_ITEM.normal)).toEqual({
        kind: 'common',
        label: 'Normal',
      })
    )
    expect(result.current?.originLabel(null)).toEqual({ kind: 'added' })
    const calls = callsOf(fetchMock).map(c => c[0])
    expect(calls[0]).toMatch(/\/front_sl_[^/?]+$/)
    // Items are read per status: the service rejects status=all.
    expect(calls.slice(1).sort()).toEqual([
      expect.stringContaining('/items?status=active'),
      expect.stringContaining('/items?status=archived'),
    ])
  })

  it('source revision 9 > copied 7 -> behind, with the source revision', async () => {
    routeFetch({
      [sourcePath]: () => jsonResponse({ ...priorityCommon(), revision: 9 }),
      [sourceItemsPath]: () => jsonResponse(page([])),
    })
    const { result } = renderHook(() => useForkProvenance(fork, true))
    await waitFor(() => expect(result.current?.behind).toBe('behind'))
    expect(result.current?.sourceRevision).toBe(9)
  })

  it('a 404 source -> source-gone, and its items are never read', async () => {
    const fetchMock = routeFetch({ [sourcePath]: () => error(404, 'NOT_FOUND') })
    const { result } = renderHook(() => useForkProvenance(fork, true))
    await waitFor(() => expect(result.current?.behind).toBe('source-gone'))
    expect(result.current?.gate).toBe('source-unavailable')
    expect(result.current?.originLabel(COMMON_ITEM.low)).toEqual({ kind: 'copied' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('an archived source -> source-archived (its items are still read for labels)', async () => {
    routeFetch({
      [sourcePath]: () => jsonResponse(priorityCommon({ status: 'archived' })),
      [sourceItemsPath]: () => jsonResponse(page(commonItems())),
    })
    const { result } = renderHook(() => useForkProvenance(fork, true))
    await waitFor(() => expect(result.current?.behind).toBe('source-archived'))
    await waitFor(() =>
      expect(result.current?.originLabel(COMMON_ITEM.low)).toMatchObject({ kind: 'common' })
    )
  })

  it('a 5xx -> error, and retry re-runs the SOURCE read', async () => {
    let calls = 0
    routeFetch({
      [sourcePath]: () => (++calls === 1 ? error(503, 'UNAVAILABLE') : jsonResponse(priorityCommon())),
      [sourceItemsPath]: () => jsonResponse(page([])),
    })
    const { result } = renderHook(() => useForkProvenance(fork, true))
    await waitFor(() => expect(result.current?.behind).toBe('error'))
    expect(result.current?.gate).toBe('source-unknown')
    act(() => result.current?.retry())
    await waitFor(() => expect(result.current?.behind).toBe('unknown'))
    expect(calls).toBe(2)
  })

  it('labels degrade to "copied" when the source items fail to load - the comparison is unaffected', async () => {
    routeFetch({
      [sourcePath]: () => jsonResponse(priorityCommon()),
      [sourceItemsPath]: () => error(503, 'UNAVAILABLE'),
    })
    const { result } = renderHook(() => useForkProvenance(fork, true))
    await waitFor(() => expect(result.current?.behind).toBe('unknown'))
    await new Promise(r => setTimeout(r, 20))
    expect(result.current?.originLabel(COMMON_ITEM.low)).toEqual({ kind: 'copied' })
  })

  it('a source with another key -> sourceKeyChanged, and no revert is promised', async () => {
    routeFetch({
      [sourcePath]: () => jsonResponse(priorityCommon({ key: 'urgency' })),
      [sourceItemsPath]: () => jsonResponse(page([])),
    })
    const { result } = renderHook(() => useForkProvenance(fork, true))
    await waitFor(() => expect(result.current?.behind).toBe('unknown'))
    expect(result.current).toMatchObject({ sourceKeyChanged: true, gate: 'source-unavailable' })
  })

  it('a source with the same key keeps the revert gate', async () => {
    routeFetch({
      [sourcePath]: () => jsonResponse(priorityCommon()),
      [sourceItemsPath]: () => jsonResponse(page([])),
    })
    const { result } = renderHook(() => useForkProvenance(fork, true))
    await waitFor(() => expect(result.current?.behind).toBe('unknown'))
    expect(result.current).toMatchObject({ sourceKeyChanged: false, gate: 'source-active' })
  })
})
