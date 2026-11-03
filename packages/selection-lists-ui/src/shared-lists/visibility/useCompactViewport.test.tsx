import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { COMPACT_QUERY, useCompactViewport } from './useCompactViewport'
import { stubMatchMedia } from '../../test/visibilityHarness'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useCompactViewport', () => {
  it('queries the shared-lists mobile breakpoint (≤ 40em)', () => {
    expect(COMPACT_QUERY).toBe('(max-width: 40em)')
  })

  it('is false when matchMedia does not exist', () => {
    vi.stubGlobal('matchMedia', undefined)
    const { result } = renderHook(() => useCompactViewport())
    expect(result.current).toBe(false)
  })

  it('reads the current match and follows changes, and unsubscribes on unmount', () => {
    const media = stubMatchMedia(true)
    const { result, unmount } = renderHook(() => useCompactViewport())
    expect(result.current).toBe(true)
    act(() => media.set(false))
    expect(result.current).toBe(false)
    act(() => media.set(true))
    expect(result.current).toBe(true)
    expect(media.listeners.size).toBe(1)
    unmount()
    expect(media.listeners.size).toBe(0)
  })
})
