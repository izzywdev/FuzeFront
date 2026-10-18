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
  /** Signed-in accounts that could receive a new link, ACTIVE FIRST. >1 shows a choice; 1 names the target on the button. */
  accounts?: { id: string; email: string }[]
  /** Resend to a specific signed-in account. */
  onResendTo?: (accountId: string) => void
  /** "Not you? Sign in to another account". */
  onUseAnotherAccount?: () => void
  /** Only a signed-in user may request a new link (the server binds it to the session). Default true. */
  canResend?: boolean
  /** Where "sign in to get a new link" goes (signed-out expired state). */
  signInForLinkHref?: string
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
  accounts,
  onResendTo,
  onUseAnotherAccount,
  canResend = true,
  signInForLinkHref = '/login',
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
      subtitle={expired ? (canResend ? labels.expiredText : labels.signInForNewLinkText) : errorText}
      data-state={expired ? 'expired' : 'error'}
    >
      {expired && canResend && accounts && accounts.length > 1 ? (
        <div className="fzf-vr-form" role="group" aria-label={labels.chooseAccount} data-state="choose-account">
          <p className="fzf-vr-sub">{labels.chooseAccount}</p>
          {accounts.map((a, i) => (
            <Button
              key={a.id}
              type="button"
              variant={i === 0 ? 'primary' : 'secondary'}
              fullWidth
              data-action="resend-account"
              data-account-id={a.id}
              disabled={resending}
              onClick={() => onResendTo?.(a.id)}
            >
              {labels.sendToAccount(a.email)}
            </Button>
          ))}
        </div>
      ) : expired && canResend ? (
        <Button type="button" variant="primary" fullWidth data-action="resend" disabled={resending} onClick={onResend}>
          {resending
            ? labels.resending
            : accounts && accounts.length === 1
              ? labels.sendNewLinkTo(accounts[0].email)
              : labels.sendNewLink}
        </Button>
      ) : expired ? (
        <Button variant="primary" fullWidth data-action="sign-in-for-link" href={signInForLinkHref}>
          {labels.signInForNewLink}
        </Button>
      ) : (
        <Button type="button" variant="primary" fullWidth data-action="retry" onClick={onRetry}>
          {labels.retry}
        </Button>
      )}
      {expired && canResend && onUseAnotherAccount && (
        <Button type="button" variant="ghost" fullWidth data-action="use-another-account" onClick={onUseAnotherAccount}>
          {labels.notYou}
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
