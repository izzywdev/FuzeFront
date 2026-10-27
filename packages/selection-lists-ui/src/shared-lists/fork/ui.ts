import type { CSSProperties } from 'react'

/** Every pointer target is at least the DS touch target tall (frame 12: >= 44 px). */
export const TOUCH_TARGET: CSSProperties = {
  minBlockSize: 'var(--touch-target)',
}

/** A code/key rendered inside a (possibly RTL) sentence: an LTR island, bidi-isolated. */
export const LTR_ISLAND: CSSProperties = {
  direction: 'ltr',
  unicodeBidi: 'isolate',
  fontFamily: 'var(--font-mono)',
}

/** Org names inside RTL sentences: isolated, direction inherited from the text. */
export const ISOLATE: CSSProperties = { unicodeBidi: 'isolate' }
