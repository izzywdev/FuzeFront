/**
 * useCompactViewport — whether the viewport is phone-sized (≤ 40em, frame 14),
 * where confirmations become BottomSheets and actions stack full-width.
 *
 * `matchMedia` is absent in some environments (jsdom, SSR): that reads as
 * "not compact", never an error.
 */

import { useEffect, useState } from 'react'

/** The shared-lists mobile breakpoint (frames 11-15): `≤ 40em`. */
export const COMPACT_QUERY = '(max-width: 40em)'

function read(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function')
    return false
  return window.matchMedia(COMPACT_QUERY).matches
}

export function useCompactViewport(): boolean {
  const [compact, setCompact] = useState<boolean>(read)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function')
      return undefined
    const mql = window.matchMedia(COMPACT_QUERY)
    const onChange = () => setCompact(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])
  return compact
}
