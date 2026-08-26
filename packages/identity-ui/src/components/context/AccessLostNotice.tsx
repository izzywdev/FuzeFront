import { Button } from '@fuzefront/design-system'

export interface AccessLostNoticeProps {
  /** Returns the caller to the Personal context — never a sign-in redirect. */
  onGoPersonal: () => void
}

/**
 * 05-states.html e5 — fail-closed: the caller's membership in the org they
 * had active was removed while it sat in their switcher. This is an
 * AUTHORIZATION denial (403 / ACCESS_LOST) rendered IN PLACE, never a
 * sign-in redirect — only a 401 re-authenticates. The switcher drops the row
 * and the caller returns to Personal.
 */
export function AccessLostNotice({ onGoPersonal }: AccessLostNoticeProps) {
  return (
    <div
      data-state="forbidden"
      data-http="403"
      data-error-code="ACCESS_LOST"
      role="alert"
      style={{
        textAlign: 'center',
        padding: 'var(--space-6) var(--space-4)',
        color: 'var(--error-color)',
      }}
    >
      <div style={{ fontSize: 'var(--text-2xl)', marginBottom: 'var(--space-2)' }} aria-hidden="true">
        ⛔
      </div>
      <h3
        style={{
          margin: '0 0 var(--space-1)',
          fontFamily: 'var(--font-display)',
          fontSize: 'var(--text-md)',
          color: 'var(--text-primary)',
        }}
      >
        You no longer have access to that organization
      </h3>
      <p style={{ margin: '0 0 var(--space-3)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
        Your membership was removed while it was in your switcher.
      </p>
      <Button variant="ghost" data-action="go-personal" onClick={onGoPersonal}>
        Go to Personal
      </Button>
    </div>
  )
}
