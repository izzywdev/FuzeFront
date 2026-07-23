import { StatusCallout, Button } from '@fuzefront/design-system'
import { useAccountSecurityI18n } from '../i18n/AccountSecurityI18nProvider'

export interface SetPasswordBannerProps {
  /** Invoked when the user chooses to set a password. */
  onSetPassword: () => void
}

/**
 * Social-only account guard (`hasPassword: false`). Surfaced at the top of the
 * hub: the account has no password sign-in method yet, so password change is
 * gated behind setting one first. Rendered as a warn StatusCallout.
 */
export function SetPasswordBanner({ onSetPassword }: SetPasswordBannerProps) {
  const { messages: m } = useAccountSecurityI18n()
  return (
    <div data-state="no-password" style={{ marginBottom: 'var(--space-5)' }}>
      <StatusCallout
        tone="warning"
        icon="🔑"
        title={m.setPassword.title}
        data-guard="set-password-first"
        actions={
          <Button variant="primary" data-action="set-password" onClick={onSetPassword}>
            {m.setPassword.action}
          </Button>
        }
      >
        {m.setPassword.text}
      </StatusCallout>
    </div>
  )
}
