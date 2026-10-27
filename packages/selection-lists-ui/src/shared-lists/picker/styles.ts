/**
 * Styles of the shared-lists picker pieces — design-system tokens only (no raw
 * colour, spacing or type), logical properties only (they mirror under
 * `dir="rtl"` with no per-direction code). Frames 09, 10 and 15.
 */
import type { CSSProperties } from 'react'

const pill: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--space-1)',
  padding: 'var(--space-1) var(--space-2)',
  borderRadius: 'var(--radius-pill)',
  border: 'var(--border-width) solid',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-2xs)',
  textTransform: 'uppercase',
  letterSpacing: 'var(--tracking-wide)',
  // A badge never wraps mid-word; the caption row wraps between its children.
  whiteSpace: 'nowrap',
}

export const effectiveStyles = {
  /** The opt-in provenance caption: wraps UNDER the control, never widens the field. */
  source: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 'var(--space-2)',
    marginBlockStart: 'var(--space-2)',
    maxInlineSize: '100%',
    minInlineSize: 0,
    overflowWrap: 'anywhere',
    fontSize: 'var(--text-sm)',
    color: 'var(--text-tertiary)',
  } satisfies CSSProperties,
  forkBadge: {
    ...pill,
    color: 'var(--accent-color)',
    background: 'var(--accent-soft)',
    borderColor: 'var(--accent-color)',
  } satisfies CSSProperties,
  commonBadge: {
    ...pill,
    color: 'var(--cyan-400)',
    background: 'var(--bg-quaternary)',
    borderColor: 'var(--cyan-400)',
  } satisfies CSSProperties,

  /** The harness inspector: which list the key resolved to. */
  inspector: {
    marginBlockStart: 'var(--space-3)',
    padding: 'var(--space-2) var(--space-3)',
    borderRadius: 'var(--radius-sm)',
    border: 'var(--border-width) dashed var(--border-strong)',
    background: 'var(--bg-secondary)',
    color: 'var(--text-secondary)',
    fontSize: 'var(--text-xs)',
    overflowWrap: 'anywhere',
  } satisfies CSSProperties,
  inspectorLabel: {
    fontWeight: 'var(--weight-semibold)',
    marginBlockEnd: 'var(--space-1)',
  } satisfies CSSProperties,

  // ── The picker control, shared-lists mode ───────────────────────────────────
  // Real DS tokens (the 4.0.0 picker's `--bg-surface` / `--danger` do not exist
  // in the design system). The control and every option are at least one touch
  // target tall: the same layout at every width (frame 15 follows frame 4d).
  comboControl: {
    minBlockSize: 'var(--touch-target)',
    inlineSize: '100%',
    boxSizing: 'border-box',
    background: 'var(--bg-secondary)',
    border: 'var(--border-width) solid var(--border-color)',
    color: 'var(--text-primary)',
  } satisfies CSSProperties,
  /** Inline under the control, in the flow — an `overflow: hidden` host cannot clip it. */
  comboMenu: {
    position: 'static',
    marginBlockStart: 'var(--space-2)',
    background: 'var(--bg-tertiary)',
    border: 'var(--border-width) solid var(--border-strong)',
    boxShadow: 'var(--shadow-md)',
  } satisfies CSSProperties,
  comboSearch: {
    minBlockSize: 'var(--touch-target)',
    background: 'var(--bg-secondary)',
    borderBlockEnd: 'var(--border-width) solid var(--border-color)',
  } satisfies CSSProperties,
  option: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-3)',
    minBlockSize: 'var(--touch-target)',
    boxSizing: 'border-box',
  } satisfies CSSProperties,
  optionSelected: {
    background: 'var(--bg-quaternary)',
  } satisfies CSSProperties,

  // ── In-place states ─────────────────────────────────────────────────────────
  skeleton: {
    display: 'block',
    inlineSize: '45%',
    blockSize: 'var(--space-3)',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--bg-quaternary)',
  } satisfies CSSProperties,
  placeholder: {
    flex: 1,
    color: 'var(--text-tertiary)',
    textAlign: 'start',
  } satisfies CSSProperties,
  invalidControl: {
    borderColor: 'var(--error-color)',
  } satisfies CSSProperties,
  fieldError: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 'var(--space-2)',
    margin: 0,
    marginBlockStart: 'var(--space-2)',
    fontSize: 'var(--text-sm)',
    color: 'var(--error-color)',
  } satisfies CSSProperties,
  retry: {
    minBlockSize: 'var(--touch-target)',
    paddingInline: 'var(--space-3)',
    background: 'none',
    border: 'var(--border-width) solid var(--border-color)',
    borderRadius: 'var(--radius-md)',
    color: 'var(--accent-color)',
    fontSize: 'var(--text-sm)',
    cursor: 'pointer',
  } satisfies CSSProperties,
} as const
