import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { requestError } from '../../test/sharedListsFixtures'
import { withSharedLists } from '../../test/sharedListsWrapper'
import { useMutationRefusal } from './useMutationRefusal'

const forkRequired = requestError(409, {
  code: 'CONFLICT',
  reason: 'fork_required',
  source_list_id: 'front_sl_1',
  fork_url: '/v1/selection-lists/front_sl_1/fork',
})

describe('useMutationRefusal', () => {
  it('captures fork_required, forbidden and not_found, and clears', () => {
    const { result } = renderHook(() => useMutationRefusal(), {
      wrapper: withSharedLists(true),
    })
    let captured: unknown
    act(() => {
      captured = result.current.capture(forkRequired)
    })
    expect(captured).toMatchObject({ kind: 'fork_required', sourceListId: 'front_sl_1' })
    expect(result.current.refusal).toEqual(captured)
    act(() => {
      result.current.capture(requestError(403, { code: 'FORBIDDEN' }))
    })
    expect(result.current.refusal?.kind).toBe('forbidden')
    act(() => {
      result.current.capture(requestError(404, { code: 'NOT_FOUND' }))
    })
    expect(result.current.refusal?.kind).toBe('not_found')
    act(() => result.current.clear())
    expect(result.current.refusal).toBeNull()
  })

  it.each([
    ['no reason', requestError(409, { code: 'CONFLICT' })],
    ['unknown reason', requestError(409, { code: 'CONFLICT', reason: 'later' })],
    ['quota', requestError(403, { code: 'QUOTA_EXCEEDED', scope: 'org_lists' })],
    ['5xx', requestError(502, {})],
  ])('%s is the ordinary 4.0.0 failure: not captured', (_, err) => {
    const { result } = renderHook(() => useMutationRefusal(), {
      wrapper: withSharedLists(true),
    })
    let captured: unknown = 'unset'
    act(() => {
      captured = result.current.capture(err)
    })
    expect(captured).toBeNull()
    expect(result.current.refusal).toBeNull()
  })

  it('flag OFF: nothing is captured, even a stray fork_required', () => {
    const { result } = renderHook(() => useMutationRefusal(), {
      wrapper: withSharedLists(false),
    })
    let captured: unknown = 'unset'
    act(() => {
      captured = result.current.capture(forkRequired)
    })
    expect(captured).toBeNull()
    expect(result.current.refusal).toBeNull()
  })
})
