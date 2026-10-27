/**
 * ConfirmSurface - the in-place confirmation shared by the three archive
 * confirms of frame 07 / 13 (`RevertToCommonConfirm` composes it).
 *
 * Two presentations, one behaviour:
 *  - `inline`       - frame 07: a bordered panel in the page flow.
 *  - `bottom-sheet` - frame 13 (<= 40em): a sheet docked to the bottom edge over
 *                     a scrim, actions stacked full width, destructive last.
 *
 * Behaviour (frame 07 / 13 "Rules the implementation must keep"):
 *  - `role="alertdialog"`, named by its title and described by its consequences.
 *  - The SAFE action (Cancel) holds initial focus; focus returns to what opened it.
 *  - Escape, the scrim and a downward swipe cancel ONLY while idle. While the
 *    request is in flight nothing dismisses it and both buttons carry native
 *    `disabled`.
 *  - The sheet is modal: Tab cycles inside it and the page behind does not scroll.
 *
 * The design system's `BottomSheet` / `Modal` shells are `role="dialog"` and move
 * focus to the shell itself; an alertdialog whose safe action holds focus needs
 * neither, so this surface is composed here from the DS `Button` and tokens.
 */

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@fuzefront/design-system'

/** Downward travel, in CSS pixels, that counts as a dismissing swipe. */
const SWIPE_DISMISS_DISTANCE = 64

export interface ConfirmSurfaceProps {
  presentation: 'inline' | 'bottom-sheet'
  title: ReactNode
  /** The consequence list; described to assistive tech as the dialog description. */
  children: ReactNode
  cancelLabel: string
  confirmLabel: string
  /** `data-action` on the destructive button. */
  confirmAction: string
  /** The request is in flight: nothing dismisses, both buttons are disabled. */
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
  /** Extra `data-*` hooks on the dialog element (`data-confirm`, `data-case`, ...). */
  dataAttributes: Record<string, string>
}

const styles = {
  inline: {
    background: 'var(--bg-secondary)',
    border: 'var(--border-width) solid var(--warning-color)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-4)',
    marginBlockEnd: 'var(--space-4)',
  } satisfies CSSProperties,
  scrim: {
    position: 'fixed',
    inset: 0,
    zIndex: 'var(--z-modal)',
    background: 'var(--scrim)',
    display: 'flex',
    alignItems: 'flex-end',
  } satisfies CSSProperties,
  sheet: {
    inlineSize: '100%',
    maxBlockSize: 'var(--sheet-max-h)',
    overflowY: 'auto',
    background: 'var(--bg-tertiary)',
    borderStartStartRadius: 'var(--radius-xl)',
    borderStartEndRadius: 'var(--radius-xl)',
    paddingBlockEnd: 'var(--safe-area-bottom)',
    outline: 'none',
  } satisfies CSSProperties,
  grab: {
    display: 'flex',
    justifyContent: 'center',
    paddingBlock: 'var(--space-2) var(--space-1)',
    touchAction: 'none',
  } satisfies CSSProperties,
  grabBar: {
    inlineSize: 'var(--space-8)',
    blockSize: 'var(--space-1)',
    borderRadius: 'var(--radius-pill)',
    background: 'var(--border-strong)',
  } satisfies CSSProperties,
  seam: {
    blockSize: 'var(--border-width)',
    background: 'var(--seam)',
    marginInline: 'var(--space-4)',
    marginBlockEnd: 'var(--space-4)',
  } satisfies CSSProperties,
  sheetBody: {
    paddingInline: 'var(--space-5)',
    paddingBlockEnd: 'var(--space-6)',
  } satisfies CSSProperties,
  title: {
    margin: 0,
    marginBlockEnd: 'var(--space-3)',
    fontFamily: 'var(--font-display)',
    fontSize: 'var(--text-lg)',
    fontWeight: 'var(--weight-semibold)',
    color: 'var(--text-primary)',
    lineHeight: 'var(--leading-snug)',
  } satisfies CSSProperties,
  describe: {
    marginBlock: 0,
    marginBlockEnd: 'var(--space-4)',
    paddingInlineStart: 'var(--space-5)',
    color: 'var(--text-secondary)',
    fontSize: 'var(--text-sm)',
    lineHeight: 'var(--leading-normal)',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-2)',
  } satisfies CSSProperties,
  actionsRow: {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 'var(--space-3)',
  } satisfies CSSProperties,
  actionsStack: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 'var(--space-3)',
  } satisfies CSSProperties,
}

export function ConfirmSurface({
  presentation,
  title,
  children,
  cancelLabel,
  confirmLabel,
  confirmAction,
  busy,
  onCancel,
  onConfirm,
  dataAttributes,
}: ConfirmSurfaceProps) {
  const sheet = presentation === 'bottom-sheet'
  const titleId = useId()
  const descriptionId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const swipeStart = useRef<number | null>(null)

  // The latest handlers, without re-subscribing the document listeners.
  const latest = useRef({ busy, onCancel })
  latest.current = { busy, onCancel }

  // The safe action holds initial focus; focus returns to the opener on close.
  useLayoutEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    dialogRef.current
      ?.querySelector<HTMLElement>('[data-initial-focus="true"]')
      ?.focus()
    return () => opener?.focus?.()
  }, [])

  // Escape cancels - only while idle.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !latest.current.busy) {
        event.preventDefault()
        latest.current.onCancel()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  // A modal sheet stops the page behind it scrolling.
  useEffect(() => {
    if (!sheet) return undefined
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [sheet])

  // Tab cycles inside the modal sheet.
  const trapTab = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!sheet || event.key !== 'Tab') return
    const buttons = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ??
        []
    )
    if (buttons.length === 0) {
      event.preventDefault()
      return
    }
    const first = buttons[0]
    const last = buttons[buttons.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const touchTarget: CSSProperties | undefined = sheet
    ? { minBlockSize: 'var(--touch-target)' }
    : undefined

  const content = (
    <>
      <h3 id={titleId} style={styles.title}>
        {title}
      </h3>
      <ul id={descriptionId} style={styles.describe}>
        {children}
      </ul>
      <div style={sheet ? styles.actionsStack : styles.actionsRow}>
        <Button
          variant="ghost"
          size="sm"
          type="button"
          fullWidth={sheet}
          style={touchTarget}
          disabled={busy}
          data-action="cancel"
          data-initial-focus="true"
          onClick={onCancel}
        >
          {cancelLabel}
        </Button>
        <Button
          variant="danger"
          size="sm"
          type="button"
          fullWidth={sheet}
          style={touchTarget}
          disabled={busy}
          data-action={confirmAction}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </div>
    </>
  )

  const dialogProps = {
    ref: dialogRef,
    role: 'alertdialog',
    'aria-labelledby': titleId,
    'aria-describedby': descriptionId,
    'aria-busy': busy || undefined,
    'data-presentation': presentation,
    onKeyDown: trapTab,
    ...dataAttributes,
  }

  if (!sheet) {
    return (
      <div {...dialogProps} style={styles.inline}>
        {content}
      </div>
    )
  }

  return createPortal(
    <div
      data-scrim=""
      style={styles.scrim}
      onClick={event => {
        if (event.target === event.currentTarget && !busy) onCancel()
      }}
    >
      <div
        {...dialogProps}
        aria-modal="true"
        tabIndex={-1}
        style={styles.sheet}
      >
        <div
          aria-hidden="true"
          style={styles.grab}
          onTouchStart={event => {
            swipeStart.current = event.touches[0]?.clientY ?? null
          }}
          onTouchEnd={event => {
            const start = swipeStart.current
            swipeStart.current = null
            const end = event.changedTouches[0]?.clientY
            if (
              start !== null &&
              end !== undefined &&
              end - start >= SWIPE_DISMISS_DISTANCE &&
              !busy
            )
              onCancel()
          }}
        >
          <div style={styles.grabBar} />
        </div>
        <div aria-hidden="true" style={styles.seam} />
        <div style={styles.sheetBody}>{content}</div>
      </div>
    </div>,
    document.body
  )
}
