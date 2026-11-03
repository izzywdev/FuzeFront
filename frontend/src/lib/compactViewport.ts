import { useEffect, useState } from 'react'

/**
 * "Compact" = below the design system's `md` breakpoint (768px = 48rem, the point
 * where the SidePanel returns — see design-system/tokens/spacing.css). Expressed in
 * `em` so the query follows the DS rem-based scale instead of a raw px literal.
 */
export const COMPACT_VIEWPORT_QUERY = '(max-width: 47.9375em)'

function matcher(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
  return window.matchMedia(COMPACT_VIEWPORT_QUERY)
}

/** One-shot read (pre-auth surfaces that don't need to react to resizes). */
export function isCompactViewport(): boolean {
  return matcher()?.matches ?? false
}

/** Live read, kept in sync with the media query. */
export function useCompactViewport(): boolean {
  const [compact, setCompact] = useState(isCompactViewport)
  useEffect(() => {
    const mql = matcher()
    if (!mql) return
    const onChange = () => setCompact(mql.matches)
    onChange()
    mql.addEventListener?.('change', onChange)
    return () => mql.removeEventListener?.('change', onChange)
  }, [])
  return compact
}
