/**
 * Token-only styles for the shared-read flow. Every value is a design-system
 * custom property (`--space-*`, `--text-*`, `--bg-*`, `--border-*`, …) or a
 * layout keyword; direction-sensitive rules use CSS logical properties so the
 * flow mirrors under `dir="rtl"` without a second set of rules.
 */

import type { CSSProperties } from 'react'

export const panel: CSSProperties = {
  background: 'var(--bg-secondary)',
  border: 'var(--border-width) solid var(--border-color)',
  borderRadius: 'var(--radius-lg)',
  overflow: 'hidden',
  marginBlockEnd: 'var(--space-4)',
}

export const panelBody: CSSProperties = { padding: 'var(--space-4)' }

export const panelFoot: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--space-3)',
  padding: 'var(--space-3) var(--space-4)',
  borderBlockStart: 'var(--border-width) solid var(--border-color)',
  color: 'var(--text-tertiary)',
  fontSize: 'var(--text-sm)',
}

export const table: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 'var(--text-md)',
}

export const th: CSSProperties = {
  textAlign: 'start',
  padding: 'var(--space-3) var(--space-4)',
  color: 'var(--text-tertiary)',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-2xs)',
  fontWeight: 'var(--weight-medium)',
  textTransform: 'uppercase',
  letterSpacing: 'var(--tracking-wide)',
  borderBlockEnd: 'var(--border-width) solid var(--border-color)',
}

export const td: CSSProperties = {
  padding: 'var(--space-3) var(--space-4)',
  borderBlockEnd: 'var(--border-width) solid var(--border-color)',
  color: 'var(--text-secondary)',
  verticalAlign: 'middle',
}

export const tdName: CSSProperties = {
  ...td,
  color: 'var(--text-primary)',
  fontWeight: 'var(--weight-medium)',
}

export const groupRow: CSSProperties = {
  ...td,
  background: 'var(--bg-tertiary)',
  color: 'var(--text-tertiary)',
  fontSize: 'var(--text-sm)',
  textAlign: 'start',
  fontWeight: 'var(--weight-regular)',
}

/** Keys, codes and ids are LTR islands (frame 11): bidi-isolated so punctuation never jumps. */
export const ltrIsland: CSSProperties = {
  direction: 'ltr',
  unicodeBidi: 'isolate',
  display: 'inline-block',
}

export const keyChip: CSSProperties = {
  ...ltrIsland,
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-sm)',
  color: 'var(--text-secondary)',
}

export const mono: CSSProperties = {
  ...ltrIsland,
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-xs)',
  color: 'var(--text-tertiary)',
}

export const mutedText: CSSProperties = {
  color: 'var(--text-tertiary)',
  fontSize: 'var(--text-sm)',
}

export const numeric: CSSProperties = {
  textAlign: 'end',
  fontFamily: 'var(--font-mono)',
}

export const metaRow: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 'var(--space-3)',
  marginBlockEnd: 'var(--space-4)',
}

export const accessHint: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--space-1)',
  fontSize: 'var(--text-sm)',
  color: 'var(--text-tertiary)',
}

export const toolbar: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 'var(--space-3)',
  marginBlockEnd: 'var(--space-4)',
}

export const grow: CSSProperties = { flex: 1 }

export const stateBlock: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  textAlign: 'center',
  gap: 'var(--space-3)',
  padding: 'var(--space-8) var(--space-4)',
  color: 'var(--text-secondary)',
}

export const stateTitle: CSSProperties = {
  margin: 0,
  fontSize: 'var(--text-lg)',
  color: 'var(--text-primary)',
  fontWeight: 'var(--weight-semibold)',
}

export const stateBody: CSSProperties = {
  margin: 0,
  maxInlineSize: 'var(--container-2xl)',
  fontSize: 'var(--text-sm)',
}

export const link: CSSProperties = {
  color: 'var(--accent-2)',
  textDecoration: 'none',
}

export const touch: CSSProperties = { minBlockSize: 'var(--touch-target)' }
