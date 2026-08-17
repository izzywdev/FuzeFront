import { Button, Input } from '@fuzefront/design-system'
import { useConfigI18n } from '../../i18n/ConfigI18nProvider'

export interface SaveBarProps {
  dirtyCount: number
  invalidCount?: number
  reason: string
  onReasonChange: (reason: string) => void
  onDiscard: () => void
  onSubmit: () => void
  saving?: boolean
}

/** The dirty-batch save bar — 01-settings-editor.html `.savebar`. Save is one atomic PUT. */
export function SaveBar({ dirtyCount, invalidCount = 0, reason, onReasonChange, onDiscard, onSubmit, saving }: SaveBarProps) {
  const { messages, t } = useConfigI18n()
  const m = messages.editor
  const disabled = dirtyCount === 0 || invalidCount > 0 || saving

  return (
    <div
      data-save-bar
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        flexWrap: 'wrap',
        padding: 'var(--space-4) var(--space-6)',
        borderTop: '1px solid var(--border-color)',
        background: 'var(--bg-tertiary)',
        position: 'sticky',
        bottom: 0,
      }}
    >
      <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
        <b data-dirty-count style={{ color: 'var(--text-primary)' }}>{dirtyCount}</b> {m.dirtySuffix}
      </span>
      <div style={{ flex: '1 1 240px', minWidth: 180 }}>
        <Input
          aria-label={m.reasonPlaceholder}
          placeholder={m.reasonPlaceholder}
          value={reason}
          onChange={e => onReasonChange(e.target.value)}
          data-save-reason
        />
      </div>
      <span style={{ flex: 1 }} />
      <Button variant="ghost" onClick={onDiscard} disabled={dirtyCount === 0} data-save-discard>
        {messages.common.discard}
      </Button>
      <Button
        onClick={onSubmit}
        disabled={disabled}
        aria-disabled={disabled || undefined}
        aria-busy={saving || undefined}
        data-save-submit
      >
        {t(m.saveSubmit, { count: dirtyCount })}
      </Button>
    </div>
  )
}
