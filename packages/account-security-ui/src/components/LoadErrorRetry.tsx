import React from 'react'
import { StatusCallout, Button } from '@fuzefront/design-system'
import { useAccountSecurityI18n } from '../i18n/AccountSecurityI18nProvider'

export interface LoadErrorRetryProps {
  onRetry: () => void
}

/**
 * Load-failure state: an error StatusCallout with a single retry action.
 * Fail-closed voice — the account is unaffected; the user simply retries.
 */
export function LoadErrorRetry({ onRetry }: LoadErrorRetryProps) {
  const { messages: m } = useAccountSecurityI18n()
  return (
    <div data-state="error">
      <StatusCallout
        tone="error"
        icon="!"
        title={m.error.title}
        actions={
          <Button variant="primary" data-action="retry" onClick={onRetry}>
            {m.error.retry}
          </Button>
        }
      >
        {m.error.text}
      </StatusCallout>
    </div>
  )
}
