import { Button } from '@fuzefront/design-system'

export interface ContextSwitchErrorNoticeProps {
  onRetry: () => void
}

/**
 * 05-states.html e4 — the org list or the target org failed to load. The
 * previous active context is kept by the caller (this notice never
 * navigates away on its own) — never strand the user in a blank context.
 */
export function ContextSwitchErrorNotice({ onRetry }: ContextSwitchErrorNoticeProps) {
  return (
    <div
      data-state="error"
      role="alert"
      style={{
        textAlign: 'center',
        padding: 'var(--space-6) var(--space-4)',
        color: 'var(--text-secondary)',
      }}
    >
      <div style={{ fontSize: 'var(--text-2xl)', marginBottom: 'var(--space-2)' }} aria-hidden="true">
        ⚠️
      </div>
      <h3
        style={{
          margin: '0 0 var(--space-1)',
          fontFamily: 'var(--font-display)',
          fontSize: 'var(--text-md)',
          color: 'var(--text-primary)',
        }}
      >
        Couldn't switch context
      </h3>
      <p style={{ margin: '0 0 var(--space-3)', fontSize: 'var(--text-sm)' }}>
        The org list or the target org failed to load. Your previous context is unchanged.
      </p>
      <Button variant="ghost" data-action="retry" onClick={onRetry}>
        Retry
      </Button>
    </div>
  )
}
