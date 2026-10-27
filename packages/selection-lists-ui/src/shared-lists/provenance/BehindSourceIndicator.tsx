/**
 * BehindSourceIndicator - frame 07's "Behind source" line, one state each.
 *
 * It is a statement about two numbers, never a call to action that changes
 * data: there is no merge, sync or update button, and nothing in a fork is ever
 * changed because the common list moved. The only control it can carry is
 * Retry, for a failed read.
 *
 * `behind` / `up-to-date` need the source's current revision
 * (`SelectionList.revision`, contract 4.2.0). Without it the state is `unknown`
 * - "comparison unavailable" - which is honest and complete; it is never
 * inferred from `updated_at`.
 */

import type { CSSProperties, ReactNode } from 'react'
import { Button, Spinner } from '@fuzefront/design-system'
import type { BehindState } from './derive'

export interface BehindSourceIndicatorProps {
  state: BehindState
  /** `forked_from.revision`: the source's revision when it was copied. */
  copiedRevision: number
  /** `forked_from.forked_at`, already formatted for display. */
  forkedOn: ReactNode
  /** Shown by the `error` state; omit and the Retry control is absent. */
  onRetry?: () => void
  /** Retry is a full-width, touch-sized button on a compact viewport. */
  compact?: boolean
}

type Dot = 'warning' | 'success' | 'muted'

const DOT_COLOR: Record<Dot, string> = {
  warning: 'var(--warning-color)',
  success: 'var(--success-color)',
  muted: 'var(--text-tertiary)',
}

const lineStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-2)',
  margin: 0,
  marginBlockStart: 'var(--space-3)',
  fontSize: 'var(--text-sm)',
  color: 'var(--text-secondary)',
}

const isolate: CSSProperties = { unicodeBidi: 'isolate' }

function StatusDot({ tone }: { tone: Dot }) {
  return (
    <span
      aria-hidden="true"
      style={{
        flex: 'none',
        inlineSize: 'var(--space-2)',
        blockSize: 'var(--space-2)',
        borderRadius: 'var(--radius-pill)',
        background: DOT_COLOR[tone],
      }}
    />
  )
}

export function BehindSourceIndicator({
  state,
  copiedRevision,
  forkedOn,
  onRetry,
  compact = false,
}: BehindSourceIndicatorProps) {
  let body: ReactNode
  switch (state) {
    case 'checking':
      return (
        <div data-behind-state="checking" style={lineStyle}>
          <Spinner size={16} label="Checking the common list" />
          <span>Checking the common list…</span>
        </div>
      )
    case 'behind':
      body = (
        <>
          <StatusDot tone="warning" />
          <span>
            <b>The common list has changed since you forked.</b> Your fork is
            unaffected — nothing is merged automatically. To take a change, open
            the common list and edit your fork by hand.
          </span>
        </>
      )
      break
    case 'up-to-date':
      body = (
        <>
          <StatusDot tone="success" />
          <span>
            Same version as the common list (<bdi style={isolate}>{copiedRevision}</bdi>).
          </span>
        </>
      )
      break
    case 'source-archived':
      body = (
        <>
          <StatusDot tone="muted" />
          <span>
            The common list was retired (archived). Your fork is unaffected.
          </span>
        </>
      )
      break
    case 'source-gone':
      body = (
        <>
          <StatusDot tone="muted" />
          <span>
            Your fork is unaffected. Copied version{' '}
            <bdi style={isolate}>{copiedRevision}</bdi> on {forkedOn}.
          </span>
        </>
      )
      break
    case 'error':
      body = (
        <>
          <span>Couldn't check the common list.</span>
          {onRetry && (
            <Button
              variant="ghost"
              size="sm"
              type="button"
              data-action="retry"
              style={compact ? { minBlockSize: 'var(--touch-target)' } : undefined}
              onClick={onRetry}
            >
              Retry
            </Button>
          )}
        </>
      )
      break
    case 'unknown':
      body = (
        <span>
          Copied version <bdi style={isolate}>{copiedRevision}</bdi>. Changes to
          the common list since then are not tracked here.
        </span>
      )
      break
  }

  return (
    <div data-behind-state={state} style={lineStyle}>
      {body}
    </div>
  )
}
