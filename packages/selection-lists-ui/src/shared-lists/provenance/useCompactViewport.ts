/**
 * useCompactViewport - frame 13's breakpoint (`<= 40em`): the provenance card
 * stacks, the header action is full width and the confirmations become bottom
 * sheets. Inline styles cannot carry a media query, so the layout switch reads
 * `matchMedia` and follows changes. No `matchMedia` (jsdom, SSR) = not compact.
 */

import { useEffect, useState } from 'react'

export const COMPACT_QUERY = '(max-width: 40em)'

function matches(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(COMPACT_QUERY).matches
  )
}

export function useCompactViewport(): boolean {
  const [compact, setCompact] = useState(matches)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined
    const query = window.matchMedia(COMPACT_QUERY)
    const update = () => setCompact(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  return compact
}
