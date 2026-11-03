import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { COMPACT_QUERY, useCompactViewport } from './useCompactViewport'
import { stubMatchMedia } from '../../test/provenanceFixtures'

let media: ReturnType<typeof stubMatchMedia> | null = null
afterEach(() => media?.restore())

describe('useCompactViewport (frame 13: <= 40em)', () => {
  it('queries the 40em breakpoint', () => {
    expect(COMPACT_QUERY).toBe('(max-width: 40em)')
  })

  it('is not compact where matchMedia does not exist', () => {
    const original = window.matchMedia
    // @ts-expect-error - simulate an environment without matchMedia
    delete window.matchMedia
    try {
      const { result } = renderHook(() => useCompactViewport())
      expect(result.current).toBe(false)
    } finally {
      window.matchMedia = original
    }
  })

  it('follows the media query', () => {
    media = stubMatchMedia(true)
    const { result } = renderHook(() => useCompactViewport())
    expect(result.current).toBe(true)
    act(() => media!.set(false))
    expect(result.current).toBe(false)
  })

  it('stops listening on unmount', () => {
    media = stubMatchMedia(false)
    const { result, unmount } = renderHook(() => useCompactViewport())
    unmount()
    act(() => media!.set(true))
    expect(result.current).toBe(false)
  })
})
