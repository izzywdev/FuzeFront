import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Alert } from '@fuzefront/design-system'
import { AuthCard } from './AuthCard'
import { ResendCooldownButton } from './ResendCooldownButton'
import { VerifyStatusPanel, type VerifyStatus } from './VerifyStatusPanel'
import { classifyAuthError } from './errors'
import {
  DEFAULT_VERIFY_RESET_LABELS,
  type VerifyResetLabels,
  type VerifyResetTransport,
} from './types'

export interface EmailVerificationFlowProps {
  transport: VerifyResetTransport
  /** `check-inbox` = /signup/verify (post-signup); `landing` = /verify/email (the emailed link). */
  view: 'check-inbox' | 'landing'
  /** The address the link was sent to (check-inbox) / used for "send a new link" (landing). */
  email?: string
  /** The link token (landing). */
  token?: string
  /** Called from the verified state's "Continue" button. */
  onContinue?: () => void
  /** Where "Go back and edit it" goes (check-inbox). Default `/signup`. */
  editAddressHref?: string
  signInHref?: string
  onBackToSignIn?: () => void
  /** Resend cooldown in seconds. Default 60. */
  cooldownSeconds?: number
  labels?: Partial<VerifyResetLabels>
}

type Notice = { kind: 'rate-limited' | 'error' | 'sent'; text: string } | null

export function EmailVerificationFlow(props: EmailVerificationFlowProps) {
  return props.view === 'check-inbox' ? <CheckInbox {...props} /> : <VerifyLanding {...props} />
}

function NoticeAlert({ notice }: { notice: Notice }) {
  if (!notice) return null
  return (
    <Alert
      tone={notice.kind === 'sent' ? 'success' : notice.kind === 'rate-limited' ? 'warning' : 'error'}
      data-state={notice.kind}
      className="fzf-vr-alert"
    >
      {notice.text}
    </Alert>
  )
}

function CheckInbox({
  transport,
  email,
  editAddressHref = '/signup',
  cooldownSeconds,
  labels: overrides,
}: EmailVerificationFlowProps) {
  const labels = { ...DEFAULT_VERIFY_RESET_LABELS, ...overrides }
  const [notice, setNotice] = useState<Notice>(null)

  const resend = useCallback(async () => {
    setNotice(null)
    try {
      await transport.startEmailVerification(email)
    } catch (err) {
      const kind = classifyAuthError(err)
      if (kind === 'rate-limited') {
        // Handled: show it and keep the cooldown running so we don't hammer the limiter.
        setNotice({ kind: 'rate-limited', text: labels.rateLimited })
        return
      }
      setNotice({ kind: 'error', text: kind === 'unavailable' ? labels.unavailable : labels.genericError })
      throw err
    }
  }, [transport, email, labels.rateLimited, labels.unavailable, labels.genericError])

  return (
    <div data-frame="03-check-inbox" data-flow="verify-email">
      <AuthCard centered icon="mail" title={labels.checkInboxTitle} subtitle={labels.checkInboxSent}>
        {email && (
          <div className="fzf-vr-chip" data-value="email">
            {email}
          </div>
        )}
        <p className="fzf-vr-sub">{labels.checkInboxHint}</p>
        <div className="fzf-vr-actions">
          <ResendCooldownButton onResend={resend} cooldownSeconds={cooldownSeconds} labels={overrides} />
        </div>
        <NoticeAlert notice={notice} />
        <p className="fzf-vr-help">
          {labels.editAddressPrompt} <a href={editAddressHref}>{labels.editAddressCta}</a>.
        </p>
        <Alert tone="info" className="fzf-vr-alert fzf-vr-alert--left" role="note">
          {labels.spamNote}
        </Alert>
      </AuthCard>
    </div>
  )
}

function VerifyLanding({
  transport,
  email,
  token,
  onContinue,
  signInHref,
  onBackToSignIn,
  labels: overrides,
}: EmailVerificationFlowProps) {
  const labels = { ...DEFAULT_VERIFY_RESET_LABELS, ...overrides }
  const [status, setStatus] = useState<VerifyStatus>(token ? 'verifying' : 'expired')
  const [errorText, setErrorText] = useState<string>('')
  const [notice, setNotice] = useState<Notice>(null)
  const [resending, setResending] = useState(false)
  // The link token is single-use: guard so React StrictMode's double effect
  // invocation (and re-renders) can't confirm it twice.
  const confirmedFor = useRef<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    if (!token) {
      setStatus('expired')
      return
    }
    const key = `${token}#${attempt}`
    if (confirmedFor.current === key) return
    confirmedFor.current = key
    setStatus('verifying')
    transport
      .confirmEmailVerification({ token })
      .then(res => {
        if (!mounted.current) return
        setStatus(res?.emailVerified ? 'verified' : 'expired')
      })
      .catch(err => {
        if (!mounted.current) return
        const kind = classifyAuthError(err, { badRequestIsExpired: true })
        if (kind === 'expired') {
          setStatus('expired')
          return
        }
        setErrorText(
          kind === 'rate-limited' ? labels.rateLimited : kind === 'unavailable' ? labels.unavailable : '',
        )
        setStatus('error')
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, attempt, transport])

  const sendNewLink = async () => {
    setNotice(null)
    setResending(true)
    try {
      await transport.startEmailVerification(email)
      setNotice({ kind: 'sent', text: labels.newLinkSent })
    } catch (err) {
      const kind = classifyAuthError(err)
      setNotice({
        kind: kind === 'rate-limited' ? 'rate-limited' : 'error',
        text:
          kind === 'rate-limited' ? labels.rateLimited : kind === 'unavailable' ? labels.unavailable : labels.genericError,
      })
    } finally {
      setResending(false)
    }
  }

  return (
    <div data-frame="04-verify-landing" data-flow="verify-email">
      <VerifyStatusPanel
        status={status}
        onContinue={onContinue}
        onResend={sendNewLink}
        onRetry={() => setAttempt(a => a + 1)}
        resending={resending}
        signInHref={signInHref}
        onBackToSignIn={onBackToSignIn}
        errorText={errorText || undefined}
        labels={overrides}
      >
        <NoticeAlert notice={notice} />
      </VerifyStatusPanel>
    </div>
  )
}
