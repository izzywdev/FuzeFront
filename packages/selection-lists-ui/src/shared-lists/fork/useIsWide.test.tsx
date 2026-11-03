import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { stubViewport } from '../../test/forkHarness'
import { WIDE_QUERY, useIsWide } from './useIsWide'

afterEach(() => vi.unstubAllGlobals())

describe('useIsWide (>= 40em -> Modal, below -> BottomSheet)', () => {
  it('asks the 40em query and follows a viewport change', () => {
    const setWide = stubViewport(false)
    const { result } = renderHook(() => useIsWide())
    expect(result.current).toBe(false)
    act(() => setWide(true))
    expect(result.current).toBe(true)
    act(() => setWide(false))
    expect(result.current).toBe(false)
    expect(WIDE_QUERY).toBe('(min-width: 40em)')
  })

  it('stops listening on unmount', () => {
    const setWide = stubViewport(true)
    const { unmount, result } = renderHook(() => useIsWide())
    unmount()
    act(() => setWide(false))
    expect(result.current).toBe(true)
  })

  it('a browser without matchMedia is wide', () => {
    vi.stubGlobal('matchMedia', undefined)
    const { result } = renderHook(() => useIsWide())
    expect(result.current).toBe(true)
  })
})
