/**
 * The dialog is a DS Modal at >= 40em and a DS BottomSheet below it (frames 05,
 * 12). A browser without `matchMedia` (and jsdom) is treated as wide.
 */

import { useEffect, useState } from 'react'

export const WIDE_QUERY = '(min-width: 40em)'

const canMatch = (): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'

export function useIsWide(): boolean {
  const [wide, setWide] = useState<boolean>(() =>
    canMatch() ? window.matchMedia(WIDE_QUERY).matches : true
  )
  useEffect(() => {
    if (!canMatch()) return
    const query = window.matchMedia(WIDE_QUERY)
    const sync = () => setWide(query.matches)
    sync()
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])
  return wide
}
