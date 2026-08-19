import { Avatar } from '@fuzefront/design-system'

export interface ContextPillProps {
  /** 'personal' or the active org's display name. */
  label: string
  context: 'personal' | 'org'
  open?: boolean
  onClick: () => void
}

/**
 * The top-bar context trigger — 01/02/03/05's `.ctx-pill`. Opens the
 * ContextSwitcher menu. `data-context-pill` + `data-context` are the frame's
 * testHooks; `aria-haspopup`/`aria-expanded` make the popover discoverable.
 */
export function ContextPill({ label, context, open = false, onClick }: ContextPillProps) {
  return (
    <button
      type="button"
      data-context-pill
      data-context={context}
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        padding: 'var(--space-1) var(--space-3)',
        borderRadius: 'var(--radius-pill)',
        background: 'var(--bg-quaternary)',
        border: '1px solid var(--border-color)',
        cursor: 'pointer',
        color: 'var(--text-primary)',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--text-sm)',
        fontWeight: 'var(--weight-medium)',
      }}
    >
      <Avatar name={context === 'personal' ? '◎' : label} size="sm" aria-hidden="true" />
      <span>{label}</span>
      <span aria-hidden="true" style={{ color: 'var(--text-tertiary)' }}>
        {open ? '▴' : '▾'}
      </span>
    </button>
  )
}
