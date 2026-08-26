import { useState, type CSSProperties } from 'react'
import { Button } from '@fuzefront/design-system'
import { useConfigI18n } from '../../i18n/ConfigI18nProvider'

export interface ResetValueMenuProps {
  keyName: string
  /** The display name of the scope this key would resolve from if unset (e.g. "portal Acme Portal"). */
  parentScopeLabel: string
  /** The parent's current value, to preview the "pin" option and drive the emitted `set` op. */
  parentValue: unknown
  /** Emits `{ key, op: 'unset' }` — never the same control as `onPin`. */
  onUnset: () => void
  /** Emits `{ key, op: 'set', value: parentValue }` — pins a copy, stops following the parent. */
  onPin: () => void
}

/**
 * The "Reset…" menu — 02-provenance-and-lock.html `.inheritmenu`. Two
 * DISTINCT operations that must never collapse into one "Reset to inherited"
 * button: `unset` keeps tracking the parent forever; pinning copies today's
 * parent value and stops tracking. They produce the same value today and
 * diverge the moment the parent changes.
 */
export function ResetValueMenu({ keyName, parentScopeLabel, parentValue, onUnset, onPin }: ResetValueMenuProps) {
  const { messages, t } = useConfigI18n()
  const m = messages.editor
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <Button
        variant="ghost"
        size="sm"
        data-reset-menu={keyName}
        aria-expanded="false"
        onClick={() => setOpen(true)}
      >
        {m.resetMenu}
      </Button>
    )
  }

  return (
    <div
      role="menu"
      aria-label={m.resetMenu}
      data-inherit-menu={keyName}
      style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-strong)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-md)',
        overflow: 'hidden',
        maxWidth: 'var(--side-panel-width)',
      }}
    >
      <button
        role="menuitem"
        type="button"
        data-op="unset"
        onClick={() => {
          setOpen(false)
          onUnset()
        }}
        style={optStyle}
      >
        <b style={optTitleStyle}>{t(m.unsetTitle, { parentScope: parentScopeLabel })}</b>
        <span style={optBodyStyle}>{m.unsetBody}</span>
      </button>
      <button
        role="menuitem"
        type="button"
        data-op="pin-parent"
        onClick={() => {
          setOpen(false)
          onPin()
        }}
        style={optStyle}
      >
        <b style={optTitleStyle}>{t(m.pinTitle, { value: String(parentValue) })}</b>
        <span style={optBodyStyle}>{m.pinBody}</span>
      </button>
    </div>
  )
}

const optStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'start',
  padding: 'var(--space-3) var(--space-4)',
  borderBottom: '1px solid var(--border-color)',
  background: 'transparent',
  border: 'none',
  borderTop: 'none',
  borderInline: 'none',
  cursor: 'pointer',
  color: 'inherit',
  font: 'inherit',
}

const optTitleStyle: CSSProperties = {
  display: 'block',
  fontSize: 'var(--text-md)',
  fontWeight: 'var(--weight-medium)',
  color: 'var(--text-primary)',
}

const optBodyStyle: CSSProperties = {
  display: 'block',
  fontSize: 'var(--text-xs)',
  color: 'var(--text-tertiary)',
  marginTop: 'var(--space-1)',
}
