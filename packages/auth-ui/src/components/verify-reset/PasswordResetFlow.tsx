import React, { useState } from 'react'
import { Alert, Button, Input, PasswordChecklist } from '@fuzefront/design-system'
import { AuthCard } from './AuthCard'
import { PasswordConfirmField } from './PasswordConfirmField'
import { PasswordStrengthMeter } from './PasswordStrengthMeter'
import { ResendCooldownButton } from './ResendCooldownButton'
import { classifyAuthError } from './errors'
import {
  DEFAULT_VERIFY_RESET_LABELS,
  type VerifyResetLabels,
  type VerifyResetTransport,
} from './types'

type Rule = { id: string; label: string; test: (v: string) => boolean }
type Step = 'request' | 'request-sent' | 'confirm' | 'confirm-done' | 'confirm-expired'
type Notice = { kind: 'rate-limited' | 'error'; text: string } | null

export interface PasswordResetFlowProps {
  transport: VerifyResetTransport
  /** The single-use token from the emailed link. Present → confirm step; absent → request step. */
  token?: string
  /** Pre-fill the request form (e.g. from the sign-in email field). */
  initialEmail?: string
  signInHref?: string
  onBackToSignIn?: () => void
  /** Password policy rules; defaults to the DS default (mirrors the Security API: 12+/upper/lower/digit/symbol). */
  rules?: Rule[]
  /** Resend cooldown in seconds. Default 60. */
  cooldownSeconds?: number
  labels?: Partial<VerifyResetLabels>
}

/**
 * PasswordResetFlow — request (unconditional 202, identical confirmation whether
 * or not the account exists) → sent → confirm new password (policy + strength +
 * match) → done | expired-token.
 */
export function PasswordResetFlow({
  transport,
  token: initialToken,
  initialEmail = '',
  signInHref = '/login',
  onBackToSignIn,
  rules,
  cooldownSeconds,
  labels: overrides,
}: PasswordResetFlowProps) {
  const labels = { ...DEFAULT_VERIFY_RESET_LABELS, ...overrides }
  const policy = rules ?? PasswordChecklist.rules
  const [token, setToken] = useState(initialToken)
  const [step, setStep] = useState<Step>(initialToken ? 'confirm' : 'request')
  const [email, setEmail] = useState(initialEmail)
  const [sentTo, setSentTo] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)

  const noticeFor = (err: unknown): NonNullable<Notice> => {
    const kind = classifyAuthError(err)
    if (kind === 'rate-limited') return { kind: 'rate-limited', text: labels.rateLimited }
    return { kind: 'error', text: kind === 'unavailable' ? labels.unavailable : labels.genericError }
  }

  const backToSignIn = (e: React.MouseEvent) => {
    if (onBackToSignIn) {
      e.preventDefault()
      onBackToSignIn()
    }
  }

  const alert = notice && (
    <Alert
      tone={notice.kind === 'rate-limited' ? 'warning' : 'error'}
      data-state={notice.kind}
      className="fzf-vr-alert"
    >
      {notice.text}
    </Alert>
  )

  // ── request ────────────────────────────────────────────────────────────────
  const sendRequest = async (address: string) => {
    await transport.requestPasswordReset(address)
  }

  const submitRequest = async (e: React.FormEvent) => {
    e.preventDefault()
    const address = email.trim()
    if (!address || pending) return
    setPending(true)
    setNotice(null)
    try {
      await sendRequest(address)
      setSentTo(address)
      setStep('request-sent')
    } catch (err) {
      setNotice(noticeFor(err))
    } finally {
      setPending(false)
    }
  }

  const resend = async () => {
    setNotice(null)
    try {
      await sendRequest(sentTo)
    } catch (err) {
      const n = noticeFor(err)
      setNotice(n)
      if (n.kind !== 'rate-limited') throw err
    }
  }

  // ── confirm ────────────────────────────────────────────────────────────────
  const meetsPolicy = policy.every(r => r.test(password))
  const matches = confirm.length > 0 && confirm === password
  const canSubmit = meetsPolicy && matches && !pending

  const submitConfirm = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit || !token) return
    setPending(true)
    setNotice(null)
    try {
      await transport.confirmPasswordReset({ token, newPassword: password })
      setPassword('')
      setConfirm('')
      setStep('confirm-done')
    } catch (err) {
      const kind = classifyAuthError(err, { badRequestIsExpired: true })
      if (kind === 'expired') {
        // Invalid, expired or already-used token (the API returns 400 for all three).
        setStep('confirm-expired')
      } else {
        setNotice(noticeFor(err))
      }
    } finally {
      setPending(false)
    }
  }

  const restart = () => {
    setToken(undefined)
    setPassword('')
    setConfirm('')
    setNotice(null)
    setStep('request')
  }

  const signInLink = (
    <p className="fzf-vr-foot">
      <a href={signInHref} onClick={backToSignIn}>
        {labels.backToSignIn}
      </a>
    </p>
  )

  return (
    <div data-frame="05-password-reset" data-flow="password-reset">
      {step === 'request' && (
        <AuthCard data-step="request" title={labels.resetRequestTitle} subtitle={labels.resetRequestText}>
          <form data-form="reset-request" onSubmit={submitRequest} noValidate className="fzf-vr-form">
            <Input
              id="fzf-reset-email"
              name="email"
              type="email"
              label={labels.emailLabel}
              autoComplete="email"
              placeholder={labels.emailPlaceholder}
              value={email}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
            />
            {alert}
            <Button
              type="submit"
              variant="primary"
              fullWidth
              data-action="submit"
              disabled={pending || !email.trim()}
            >
              {pending ? labels.sendingResetLink : labels.sendResetLink}
            </Button>
          </form>
          {signInLink}
        </AuthCard>
      )}

      {step === 'request-sent' && (
        <AuthCard
          data-step="request-sent"
          centered
          icon="mail"
          title={labels.requestSentTitle}
          subtitle={labels.requestSentText(sentTo)}
        >
          <div className="fzf-vr-actions">
            <ResendCooldownButton onResend={resend} cooldownSeconds={cooldownSeconds} labels={overrides} />
          </div>
          {alert}
          {signInLink}
        </AuthCard>
      )}

      {step === 'confirm' && (
        <AuthCard data-step="confirm" title={labels.confirmTitle} subtitle={labels.confirmText}>
          <form data-form="reset-confirm" onSubmit={submitConfirm} noValidate className="fzf-vr-form">
            <div>
              <Input
                id="fzf-reset-new-password"
                name="newPassword"
                type="password"
                label={labels.newPasswordLabel}
                autoComplete="new-password"
                value={password}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
              />
              <PasswordStrengthMeter value={password} rules={policy} labels={overrides} />
            </div>
            <PasswordConfirmField password={password} value={confirm} onChange={setConfirm} labels={overrides} />
            {alert}
            <Button
              type="submit"
              variant="primary"
              fullWidth
              data-action="submit"
              disabled={!canSubmit}
              aria-disabled={!canSubmit}
            >
              {pending ? labels.updatingPassword : labels.updatePassword}
            </Button>
          </form>
        </AuthCard>
      )}

      {step === 'confirm-done' && (
        <AuthCard
          data-step="confirm-done"
          centered
          icon="success"
          title={labels.confirmDoneTitle}
          subtitle={labels.confirmDoneText}
        >
          <Button
            variant="primary"
            fullWidth
            data-action="sign-in"
            href={signInHref}
            onClick={backToSignIn}
          >
            {labels.backToSignIn}
          </Button>
        </AuthCard>
      )}

      {step === 'confirm-expired' && (
        <AuthCard
          data-step="confirm-expired"
          centered
          icon="error"
          title={labels.confirmExpiredTitle}
          subtitle={labels.confirmExpiredText}
        >
          <Button type="button" variant="primary" fullWidth data-action="restart" onClick={restart}>
            {labels.requestNewLink}
          </Button>
        </AuthCard>
      )}
    </div>
  )
}
