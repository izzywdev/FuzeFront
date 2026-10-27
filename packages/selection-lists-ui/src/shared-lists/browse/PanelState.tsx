/**
 * PanelState — the loading / empty / error / not-found blocks every panel of
 * the shared-read flow shares (frames 01, 03). Loading is a skeleton with
 * `aria-busy`; the others are a titled block with an optional action.
 */

import type { ReactNode } from 'react'
import { Skeleton } from '@fuzefront/design-system'
import * as css from './styles'

export function PanelSkeleton({ label }: { label?: string }) {
  return (
    <div
      aria-busy="true"
      aria-label={label}
      role="status"
      style={{ ...css.panelBody, display: 'grid', gap: 'var(--space-3)' }}
    >
      <Skeleton width="30%" />
      <Skeleton width="92%" />
      <Skeleton width="86%" />
      <Skeleton width="70%" />
    </div>
  )
}

export interface PanelStateBlockProps {
  icon: string
  title: string
  body?: ReactNode
  action?: ReactNode
  /** Extra attributes for the body paragraph (e.g. `data-error`). */
  bodyProps?: Record<string, string>
  role?: 'alert' | 'status'
}

export function PanelStateBlock({
  icon,
  title,
  body,
  action,
  bodyProps,
  role,
}: PanelStateBlockProps) {
  return (
    <div style={css.stateBlock} role={role}>
      <div aria-hidden="true" style={{ fontSize: 'var(--text-2xl)', lineHeight: 1 }}>
        {icon}
      </div>
      <h3 style={css.stateTitle}>{title}</h3>
      {body !== undefined && (
        <p style={css.stateBody} {...bodyProps}>
          {body}
        </p>
      )}
      {action}
    </div>
  )
}
