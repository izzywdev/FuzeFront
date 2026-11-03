import { useEffect, useState } from 'react'
import { Button, CodeField, Spinner, StatusCallout } from '@fuzefront/design-system'
import { useAccountSecurityI18n } from '../../i18n/AccountSecurityI18nProvider'
import { Actions, SeamCard } from '../common/flowKit'
import { RateLimitCallout, retryButtonLabel, useRetryCountdown } from './rateLimit'

export type RecoveryStatus =
  | 'idle'
  | 'verifying'
  | 'error-invalid'
  | 'rate-limited'
  | 'error-expired'
  | 'error-generic'

/**
 * Recovery-code entry (desktop frame 07 / mobile frame 05). One opaque text field —
 * NOT OTP cells: the code's format is not the client's business, so "Verify" is
 * disabled only while the trimmed value is empty and the value is sent as typed.
 */
export function RecoveryCodeEntry({
  status,
  retryAt,
  onVerify,
  onChooseFactor,
  onRestart,
  onContactSupport,
  hosted = false,
  variant = 'desktop',
}: {
  status: RecoveryStatus
  /** Epoch-ms end of a 429 wait; null/undefined = the server gave no usable Retry-After. */
  retryAt?: number | null
  onVerify: (code: string) => void
  onChooseFactor?: () => void
  /** Restart sign-in (challenge expired / rate limited). */
  onRestart?: () => void
  onContactSupport?: () => void
  hosted?: boolean
  variant?: 'desktop' | 'mobile'
}) {
  const { messages: m } = useAccountSecurityI18n()
  const mobile = variant === 'mobile'
  const [code, setCode] = useState('')
  const wait = useRetryCountdown(status === 'rate-limited' ? retryAt : undefined)
  const cooling = status === 'rate-limited' && wait !== null && wait > 0
  const frameState = {
    idle: mobile ? 'idle' : 'recovery-prompt',
    verifying: mobile ? 'verifying' : 'recovery-verifying',
    'error-invalid': mobile ? 'error-invalid' : 'recovery-error-invalid',
    'rate-limited': mobile ? 'rate-limited' : 'recovery-rate-limited',
    'error-expired': mobile ? 'error-expired' : 'recovery-error-expired',
    'error-generic': mobile ? 'error-generic' : 'recovery-error-generic',
  }[status]
  const httpStatus =
    status === 'error-invalid' || status === 'error-expired' ? '401' : status === 'rate-limited' ? '429' : undefined
  const attrs = mobile
    ? { 'data-panel': 'recovery-code', 'data-state': frameState, 'data-http-status': httpStatus, 'data-factor': 'recovery' }
    : {
        'data-component': 'mfa-challenge',
        'data-state': frameState,
        'data-http-status': httpStatus,
        'data-factor': 'recovery',
      }

  // A rejected code stays on screen: focus and select it so the next attempt replaces it.
  useEffect(() => {
    if (status === 'error-invalid') {
      const el = document.getElementById('mfa-recovery-code') as HTMLInputElement | null
      el?.focus()
      el?.select()
    }
  }, [status])

  // A plain function (not a component type) so the field is never remounted between renders.
  const wrap = (children: React.ReactNode) => (
    <SeamCard flush={mobile || hosted} {...attrs}>
      {children}
    </SeamCard>
  )

  if (status === 'error-expired') {
    // NOT_ACTIVE: neutral. It also covers an already-completed challenge, so this screen
    // must say nothing about whether the recovery code was or was not used.
    return wrap(
      <>
        <div data-error="challenge-expired">
          <StatusCallout tone="error" icon="⚠" title={m.stepUp.recoveryExpiredTitle} role="alert">
            {m.stepUp.recoveryExpiredText}
          </StatusCallout>
        </div>
        {onRestart && (
          <Actions style={{ flexDirection: 'column' }}>
            <Button variant="primary" fullWidth data-action="restart-sign-in" onClick={onRestart}>
              {m.stepUp.backToSignIn}
            </Button>
          </Actions>
        )}
      </>
    )
  }

  const verifying = status === 'verifying'
  const invalid = status === 'error-invalid'
  const trimmedEmpty = code.trim().length === 0
  const prompt = invalid ? m.stepUp.recoveryInvalidPrompt : m.stepUp.recoveryPrompt
  const helpId = 'mfa-recovery-code-help'
  const submit = () => {
    if (!verifying && !cooling && !trimmedEmpty) onVerify(code)
  }
  const idleLabel = mobile ? m.stepUp.verifyShort : m.stepUp.verify
  const label = verifying
    ? m.stepUp.verifying
    : status === 'rate-limited'
      ? retryButtonLabel(m, wait)
      : invalid || status === 'error-generic'
        ? m.stepUp.tryAgain
        : idleLabel

  return wrap(
    <>
      {!mobile && (
        <h2 style={{ margin: '0 0 var(--space-2)', fontFamily: 'var(--font-display)', fontSize: 'var(--text-lg)' }}>
          {m.stepUp.recoveryTitle}
        </h2>
      )}
      {status === 'rate-limited' && <RateLimitCallout seconds={wait} />}
      {status === 'error-generic' && (
        <div data-error="recovery-generic" style={{ marginBlockEnd: 'var(--space-4)' }}>
          <StatusCallout tone="error" icon="⚠" title={m.stepUp.recoveryGenericTitle} role="alert">
            {m.stepUp.recoveryGenericText}
          </StatusCallout>
        </div>
      )}
      {(status === 'idle' || verifying || invalid) && (
        <p
          style={{
            margin: '0 0 var(--space-4)',
            color: 'var(--text-tertiary)',
            fontSize: 'var(--text-sm)',
            lineHeight: 'var(--leading-normal)',
          }}
        >
          {prompt}
        </p>
      )}
      <div data-component="recovery-code-input" data-error={invalid ? 'recovery-invalid' : undefined}>
        <CodeField
          id="mfa-recovery-code"
          data-field="recovery-code"
          label={m.stepUp.recoveryLabel}
          type="text"
          autoComplete="one-time-code"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={64}
          dir="ltr"
          value={code}
          onChange={(e: { target: { value: string } }) => setCode(e.target.value)}
          onKeyDown={(e: React.KeyboardEvent) => {
            if (e.key === 'Enter') submit()
          }}
          error={invalid ? m.stepUp.recoveryInvalid : undefined}
          aria-invalid={invalid || undefined}
          aria-describedby={helpId}
          disabled={verifying}
          autoFocus
        />
        <span
          id={helpId}
          data-help="recovery-code"
          style={{ display: 'block', marginBlockStart: 'var(--space-2)', color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)' }}
        >
          {m.stepUp.recoveryHelp}
        </span>
      </div>
      <Actions style={{ flexDirection: 'column' }}>
        <Button
          variant="primary"
          fullWidth
          data-action="verify-recovery"
          data-state={cooling ? 'cooldown' : undefined}
          onClick={submit}
          disabled={verifying || cooling || trimmedEmpty}
          aria-disabled={cooling || undefined}
          aria-busy={verifying || undefined}
          leadingIcon={verifying ? <Spinner size={16} label={m.stepUp.verifying} /> : undefined}
        >
          {label}
        </Button>
        {status === 'rate-limited' ? (
          onRestart && (
            <Button variant="ghost" fullWidth data-action="back-to-sign-in" onClick={onRestart}>
              {m.stepUp.backToSignIn}
            </Button>
          )
        ) : (
          onChooseFactor && (
            <Button variant="ghost" fullWidth data-action="choose-factor" onClick={onChooseFactor} disabled={verifying}>
              {m.stepUp.useDifferent}
            </Button>
          )
        )}
        {status === 'idle' && onContactSupport && (
          <Button variant="ghost" fullWidth data-action="contact-support" onClick={onContactSupport}>
            {m.stepUp.recoveryContactSupport}
          </Button>
        )}
      </Actions>
    </>
  )
}
