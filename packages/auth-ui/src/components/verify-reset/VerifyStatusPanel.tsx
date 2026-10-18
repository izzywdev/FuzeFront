import React from 'react'
import { Button, Spinner } from '@fuzefront/design-system'
import { AuthCard } from './AuthCard'
import { DEFAULT_VERIFY_RESET_LABELS, type VerifyResetLabels } from './types'

export type VerifyStatus = 'verifying' | 'verified' | 'expired' | 'error'

export interface VerifyStatusPanelProps {
  status: VerifyStatus
  onContinue?: () => void
  onResend?: () => void
  onRetry?: () => void
  /** Href for the "Back to sign in" link on the expired/error states. */
  signInHref?: string
  onBackToSignIn?: () => void
  resending?: boolean
  /** Extra content under the actions (e.g. a "new link sent" confirmation or a rate-limit alert). */
  children?: React.ReactNode
  /** Detail copy for the generic error state. */
  errorText?: string
  labels?: Partial<VerifyResetLabels>
}

/** The verify-link landing state machine: verifying → verified | expired (| generic error). */
export function VerifyStatusPanel({
  status,
  onContinue,
  onResend,
  onRetry,
  signInHref = '/login',
  onBackToSignIn,
  resending = false,
  children,
  errorText,
  labels: overrides,
}: VerifyStatusPanelProps) {
  const labels = { ...DEFAULT_VERIFY_RESET_LABELS, ...overrides }

  if (status === 'verifying') {
    return (
      <AuthCard centered title={labels.verifyingTitle} data-state="verifying" aria-busy="true">
        <div className="fzf-vr-spinner">
          <Spinner label={labels.verifyingTitle} />
        </div>
        <p className="fzf-vr-sub" role="status" aria-live="polite">
          {labels.verifyingText}
        </p>
      </AuthCard>
    )
  }
  if (status === 'verified') {
    return (
      <AuthCard centered icon="success" title={labels.verifiedTitle} subtitle={labels.verifiedText} data-state="verified">
        <Button type="button" variant="primary" fullWidth data-action="continue" onClick={onContinue}>
          {labels.continueCta}
        </Button>
        {children}
      </AuthCard>
    )
  }
  const expired = status === 'expired'
  return (
    <AuthCard
      centered
      icon="error"
      title={expired ? labels.expiredTitle : labels.genericError}
      subtitle={expired ? labels.expiredText : errorText}
      data-state={expired ? 'expired' : 'error'}
    >
      {expired ? (
        <Button type="button" variant="primary" fullWidth data-action="resend" disabled={resending} onClick={onResend}>
          {resending ? labels.resending : labels.sendNewLink}
        </Button>
      ) : (
        <Button type="button" variant="primary" fullWidth data-action="retry" onClick={onRetry}>
          {labels.retry}
        </Button>
      )}
      {children}
      <p className="fzf-vr-foot">
        <a
          href={signInHref}
          onClick={e => {
            if (onBackToSignIn) {
              e.preventDefault()
              onBackToSignIn()
            }
          }}
        >
          {labels.backToSignIn}
        </a>
      </p>
    </AuthCard>
  )
}
