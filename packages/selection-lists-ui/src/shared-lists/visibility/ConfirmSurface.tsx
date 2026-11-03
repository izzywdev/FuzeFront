/**
 * ConfirmSurface — the frame-08 / frame-14 confirmation chrome shared by the
 * two visibility confirmations (organization → private, publish to platform).
 *
 *  - desktop: an IN-PLACE `role="alertdialog"` panel under the options (not a
 *    modal — the page stays readable, which the consequence lists rely on);
 *  - phone (≤ 40em): the design system's `BottomSheet`, whose panel is promoted
 *    to the same `alertdialog` so ONE element carries the role, name and hooks.
 *
 * Both focus Cancel first (the safe action), close on Esc, and refuse to close
 * while `busy` (a request is in flight).
 *
 * Why the DOM promotion: the DS `BottomSheet`/`Modal` render a fixed
 * `role="dialog"` panel and forward no attributes to it, but a confirmation
 * that refuses an irreversible action is an `alertdialog` (WAI-ARIA), and the
 * approved frames hook `[data-confirm][data-presentation]` on that element. The
 * attributes are set on the DS panel by ref after each render — React never
 * manages them there, so they are not overwritten. A DS-side `role` /
 * attribute-passthrough prop would make this unnecessary; that is a
 * design-system change, tracked in the PR rather than forked here.
 */

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { BottomSheet } from '@fuzefront/design-system'

export type ConfirmPresentation = 'inline' | 'bottom-sheet'

export interface ConfirmSurfaceProps {
  /** `data-confirm` value, e.g. `visibility-to-private`. */
  confirm: string
  presentation: ConfirmPresentation
  title: ReactNode
  /** Extra `data-*` attributes mirrored on the alertdialog element. */
  attrs?: Record<string, string | undefined>
  /** A request is in flight: `aria-busy`, and Esc / backdrop do nothing. */
  busy?: boolean
  /** Esc, or a tap on the sheet's backdrop. */
  onDismiss: () => void
  children: ReactNode
  /** The action buttons; `stacked` on a phone (full width, one per row). */
  actions: (layout: { stacked: boolean }) => ReactNode
}

const card: CSSProperties = {
  marginBlockStart: 'var(--space-4)',
  padding: 'var(--space-4)',
  background: 'var(--bg-secondary)',
  border: 'var(--border-width) solid var(--border-color)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--text-primary)',
  fontFamily: 'var(--font-sans)',
}

const heading: CSSProperties = {
  margin: 0,
  marginBlockEnd: 'var(--space-3)',
  fontFamily: 'var(--font-display)',
  fontSize: 'var(--text-md)',
  fontWeight: 'var(--weight-semibold)',
  color: 'var(--text-primary)',
}

const rowActions: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'flex-end',
  gap: 'var(--space-3)',
  marginBlockStart: 'var(--space-4)',
}

const stackedActions: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-3)',
  marginBlockStart: 'var(--space-2)',
}

/** Sets or removes a batch of attributes on an element the DS owns. */
function mirror(el: Element, attrs: Record<string, string | undefined>) {
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined) el.removeAttribute(name)
    else el.setAttribute(name, value)
  }
}

export function ConfirmSurface({
  confirm,
  presentation,
  title,
  attrs = {},
  busy = false,
  onDismiss,
  children,
  actions,
}: ConfirmSurfaceProps) {
  const titleId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const sheet = presentation === 'bottom-sheet'

  // Cancel holds initial focus. In sheet mode the DS focuses its panel in its
  // own effect, which runs before this one (children first), so this wins.
  useEffect(() => {
    rootRef.current
      ?.querySelector<HTMLElement>('[data-action="cancel"]')
      ?.focus()
  }, [])

  // Esc closes the in-place panel (the sheet's own listener covers the sheet).
  useEffect(() => {
    if (sheet || busy) return undefined
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [sheet, busy, onDismiss])

  // Promote the DS panel to the alertdialog that carries the hooks.
  const attrsKey = JSON.stringify(attrs)
  useLayoutEffect(() => {
    if (!sheet) return
    const panel = rootRef.current?.closest('[role="dialog"], [role="alertdialog"]')
    if (!panel) return
    mirror(panel, {
      role: 'alertdialog',
      'aria-labelledby': titleId,
      'aria-busy': busy ? 'true' : undefined,
      'data-confirm': confirm,
      'data-presentation': 'bottom-sheet',
      ...attrs,
    })
    // `attrs` is covered by `attrsKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet, titleId, busy, confirm, attrsKey])

  const body = (
    <div ref={rootRef} style={sheet ? { display: 'contents' } : undefined}>
      <h3 id={titleId} style={heading}>
        {title}
      </h3>
      {children}
      <div style={sheet ? stackedActions : rowActions}>
        {actions({ stacked: sheet })}
      </div>
    </div>
  )

  if (sheet) {
    return (
      <BottomSheet open onClose={busy ? () => undefined : onDismiss}>
        {body}
      </BottomSheet>
    )
  }

  return (
    <div
      role="alertdialog"
      aria-labelledby={titleId}
      aria-busy={busy ? 'true' : undefined}
      data-confirm={confirm}
      data-presentation="inline"
      {...attrs}
      style={card}
    >
      {body}
    </div>
  )
}
