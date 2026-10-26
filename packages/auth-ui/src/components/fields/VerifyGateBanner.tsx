import React, { useState } from 'react'
import { Alert } from '@fuzefront/design-system'
import { DEFAULT_SIGNUP_LABELS, type SignUpLabels } from '../signup/labels'

export interface VerifyGateBannerProps {
  /** The address the verification link goes to (the signed-in user's, from the session). */
  email: string
  /** Re-sends the verification link (`POST /verify/email/start`). Rejection shows nothing extra here — the caller owns error UX. */
  onResend: () => Promise<void>
  labels?: Partial<SignUpLabels>
}

/**
 * The "verify to continue" gate banner shown to a signed-in but UNVERIFIED account
 * wherever an action is gated on a verified email (inviting teammates, going live).
 * It explains the gate and offers a one-click resend.
 * Hooks: `data-state="unverified-gate"`, `data-action="resend"`.
 */
export function VerifyGateBanner({ email, onResend, labels: overrides }: VerifyGateBannerProps) {
  const labels = { ...DEFAULT_SIGNUP_LABELS, ...overrides }
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  const resend = async () => {
    if (sending) return
    setSending(true)
    try {
      await onResend()
      setSent(true)
    } catch {
      setSent(false)
    } finally {
      setSending(false)
    }
  }

  return (
    <Alert
      tone="warning"
      role="status"
      data-state="unverified-gate"
      title={labels.gateTitle}
      icon={
        <svg viewBox="0 0 20 20" fill="none" width="20" height="20">
          <path d="M10 3l7 12H3l7-12Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M10 8v3M10 13h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      }
    >
      {labels.gateTextBefore} <b>{email}</b> {labels.gateTextAfter}{' '}
      {sent ? (
        <span data-state="sent">{labels.gateResent}</span>
      ) : (
        <button
          type="button"
          className="fzf-su-textbtn"
          data-action="resend"
          disabled={sending}
          onClick={resend}
        >
          {sending ? labels.gateResending : labels.gateResend}
        </button>
      )}
    </Alert>
  )
}
