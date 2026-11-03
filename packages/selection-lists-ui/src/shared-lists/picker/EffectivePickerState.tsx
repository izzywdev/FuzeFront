/**
 * EffectivePickerState — the picker's in-place states while the shared-lists
 * flag is ON (frames 09, 10, 15): loading, resolving a stored value, load
 * failed, no effective list, and resolve failed.
 *
 * Embedded in someone else's form, so: never throw into the host, never
 * silently render an empty control, and always keep the host's value (the
 * hidden `[data-persisted]` slot is passed in by the picker and rendered in
 * every state). A failed lookup is a LOAD FAILURE with an in-place Retry — it
 * never falls back to a second, different list, and a 403 (a developer-role
 * caller holds no `SelectionListCatalog:list`) is never "List unavailable".
 *
 * Tokens only; the control and Retry are at least one touch target tall.
 */

import type { ComponentProps, ReactNode } from 'react'
import { effectiveStyles as st } from './styles'

export type EffectivePickerStateKind =
  | 'loading'
  | 'resolving'
  | 'error'
  | 'not-found'
  | 'resolve-error'

type RootAttributes = ComponentProps<'div'> & {
  [attribute: `data-${string}`]: string | undefined
}

export interface EffectivePickerStateProps {
  state: EffectivePickerStateKind
  /** The picker's root attributes (`data-frame`, `data-picker`, `data-panel`, style, …). */
  rootProps: RootAttributes
  listKey: string
  /** The lookup ended without an answer (not a "no"): worded as "couldn't confirm". */
  incomplete?: boolean
  onRetry: () => void
  /** The hidden slot carrying the host's value; rendered in every state. */
  persisted: ReactNode
}

export function EffectivePickerState({
  state,
  rootProps,
  listKey,
  incomplete = false,
  onRetry,
  persisted,
}: EffectivePickerStateProps) {
  const root = { ...rootProps, 'data-state': state }

  if (state === 'loading' || state === 'resolving') {
    return (
      <div {...root}>
        {/* One skeleton at the final control height; never the stored id as a placeholder. */}
        <div
          role="status"
          aria-busy="true"
          aria-label={
            state === 'resolving' ? 'Loading the saved value' : 'Loading options'
          }
          style={{ ...pickerControlBase, ...st.comboControl }}
        >
          <span style={st.skeleton} />
        </div>
        {persisted}
      </div>
    )
  }

  if (state === 'not-found') {
    return (
      <div {...root}>
        <button
          type="button"
          data-combo-control
          disabled
          aria-disabled="true"
          style={{
            ...pickerControlBase,
            ...st.comboControl,
            opacity: 0.6,
            cursor: 'not-allowed',
          }}
        >
          <span style={st.placeholder}>List unavailable</span>
        </button>
        <p data-error="NOT_FOUND" style={st.fieldError}>
          <span aria-hidden="true">⚠</span>
          <span>
            List unavailable — there is no active list with the key{' '}
            <bdi>{listKey}</bdi> for your organization.
          </span>
        </p>
        {persisted}
      </div>
    )
  }

  const resolveFailed = state === 'resolve-error'
  return (
    <div {...root}>
      <div
        style={{
          ...pickerControlBase,
          ...st.comboControl,
          ...st.invalidControl,
        }}
      >
        <span style={st.placeholder}>
          {resolveFailed
            ? "Couldn't load the saved value"
            : incomplete
              ? "Couldn't confirm the options"
              : "Couldn't load options"}
        </span>
        <button
          type="button"
          data-action="retry"
          onClick={onRetry}
          style={st.retry}
        >
          Retry
        </button>
      </div>
      <p
        role="alert"
        data-error={resolveFailed ? 'resolve-failed' : 'load-failed'}
        style={st.fieldError}
      >
        <span aria-hidden="true">⚠</span>
        <span>
          {resolveFailed
            ? 'The saved value is kept exactly as it is. Try again to show it.'
            : 'Your selection is kept. Try again to load the options.'}
        </span>
      </p>
      {persisted}
    </div>
  )
}

/** The control's box, shared by every in-place state (the loaded control adds its own). */
const pickerControlBase = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--space-2)',
  padding: 'var(--space-2) var(--space-3)',
  borderRadius: 'var(--radius-md)',
  fontSize: 'var(--text-sm)',
  textAlign: 'start',
} as const
