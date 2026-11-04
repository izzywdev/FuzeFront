import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, OtpInput, Skeleton, Spinner, StatusCallout } from '@fuzefront/design-system'
import { useAccountSecurityI18n } from '../../i18n/AccountSecurityI18nProvider'
import { classifyCodeFailure, classifyRecoveryFailure, retryAfterOf } from '../../api/errors'
import type { MfaFactorRef, MfaFactorType, MfaSession, StepUpClient } from '../../types'
import {
  Actions,
  FlowPage,
  FlowRoot,
  Hint,
  InlineError,
  SeamCard,
  useSecurityClient,
  type FlowBaseProps,
} from '../common/flowKit'
import { FACTOR_ICON, factorName } from './factorMeta'
import { RateLimitCallout, retryButtonLabel, retryDeadline, useRetryCountdown } from './rateLimit'
import { RecoveryCodeEntry, type RecoveryStatus } from './RecoveryEntry'

/** Seconds a delivered code stays valid / before "resend" re-enables. */
const EXPIRY_SECONDS = 300
const RESEND_COOLDOWN_SECONDS = 30

/** Factor kinds the step-up can actually answer today (webauthn is not drivable from this UI). */
const SUPPORTED_STEP_UP_TYPES: readonly MfaFactorType[] = ['totp', 'sms', 'email']

type Variant = 'desktop' | 'mobile'
type Choice = MfaFactorRef | { type: 'recovery'; factorId?: undefined }

export interface MfaStepUpProps extends FlowBaseProps {
  /** The `mfa_required` challenge from login / social exchange. */
  challenge: {
    challengeId: string
    factors?: MfaFactorRef[]
    /** `mfa_required.recoveryAvailable`: offer "Recovery code" ONLY when strictly `true` (missing = false). */
    recoveryAvailable?: boolean
  }
  /** Optional: fetch the factor list when `challenge.factors` is absent (shows loading / error). */
  loadFactors?: () => Promise<MfaFactorRef[]>
  /** The authenticated session minted by a successful verification. */
  onAuthenticated: (session: MfaSession) => void
  /** Zero-factors fail-closed state: route the user to support. */
  onContactSupport?: () => void
  onBack?: () => void
  /**
   * The host already renders this inside a card (e.g. the login AuthCard): drop our own
   * card chrome on EVERY variant so the nested padding/border can't squeeze the OTP row.
   */
  hosted?: boolean
}

function formatClock(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** Counts down once a second from `from`; restart by changing `key`. */
function useCountdown(from: number, key: unknown, active: boolean): number {
  const [left, setLeft] = useState(from)
  useEffect(() => {
    setLeft(from)
    if (!active) return
    const id = setInterval(() => setLeft((n) => (n > 0 ? n - 1 : 0)), 1000)
    return () => clearInterval(id)
  }, [from, key, active])
  return left
}

/**
 * Seconds left until a FIXED deadline (epoch ms), ticking once a second. Used for
 * the code-expiry display: the server's challenge expiry is set at login and a
 * resend does not extend it, so the deadline must never restart.
 */
function useDeadlineCountdown(deadline: number, active: boolean): number {
  const remaining = () => Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
  const [left, setLeft] = useState(remaining)
  useEffect(() => {
    setLeft(remaining())
    if (!active) return
    const id = setInterval(() => setLeft(remaining()), 1000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadline, active])
  return left
}

// ── FactorPicker ────────────────────────────────────────────────────────────

export function FactorPicker({
  factors,
  recoveryEnabled,
  onChoose,
  disabled = false,
  variant = 'desktop',
}: {
  factors: MfaFactorRef[]
  recoveryEnabled?: boolean
  onChoose: (choice: Choice) => void
  /** A choice is being dispatched: ignore further clicks. */
  disabled?: boolean
  variant?: Variant
}) {
  const { messages: m, dir } = useAccountSecurityI18n()
  const desc = (t: MfaFactorType): string =>
    t === 'sms' ? m.stepUp.smsDesc : t === 'email' ? m.stepUp.emailDesc : m.stepUp.totpDesc
  // Offer only what the server lists. SMS / email appear only when enrolled.
  const offered = factors.filter((f) => SUPPORTED_STEP_UP_TYPES.includes(f.type))
  const touch = variant === 'mobile'
  const row = (
    key: string,
    attrs: Record<string, string | undefined>,
    icon: string,
    title: string,
    sub: string,
    action: () => void
  ) => (
    <button
      key={key}
      type="button"
      onClick={action}
      disabled={disabled}
      {...attrs}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        width: '100%',
        minHeight: touch ? 'calc(var(--touch-target) + var(--space-4))' : 'var(--touch-target)',
        textAlign: 'start',
        padding: 'var(--space-3) var(--space-4)',
        background: 'var(--bg-secondary)',
        color: 'var(--text-primary)',
        border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-md)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--text-md)',
      }}
    >
      <span aria-hidden="true">{icon}</span>
      <span style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <b style={{ fontWeight: 'var(--weight-semibold)' }}>{title}</b>
        <small style={{ color: 'var(--text-tertiary)' }}>{sub}</small>
      </span>
      <span aria-hidden="true">{dir === 'rtl' ? '‹' : '›'}</span>
    </button>
  )
  return (
    <div
      data-component="factor-picker"
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}
    >
      {offered.map((f) =>
        row(
          f.factorId,
          { 'data-factor': f.type, 'data-factor-id': f.factorId, 'data-action': 'challenge' },
          FACTOR_ICON[f.type],
          factorName(m, f.type),
          desc(f.type),
          () => onChoose(f)
        )
      )}
      {recoveryEnabled &&
        row('recovery', { 'data-factor': 'recovery', 'data-action': 'use-recovery' }, FACTOR_ICON.recovery, factorName(m, 'recovery'), m.stepUp.recoveryDesc, () =>
          onChoose({ type: 'recovery' })
        )}
      <Hint style={{ margin: 0 }}>{m.stepUp.onlyEnrolled}</Hint>
    </div>
  )
}

// ── MfaChallengeCard (code entry) ───────────────────────────────────────────

type CodeStatus =
  | 'idle'
  | 'verifying'
  | 'error-invalid'
  | 'error-service'
  | 'error-delivery'
  | 'rate-limited'
  | 'error-expired'
  | 'error-generic'

export function MfaChallengeCard({
  factor,
  status,
  delivered,
  onVerify,
  onResend,
  onChooseFactor,
  onRestart,
  retryAt,
  expiresAt,
  hosted = false,
  variant = 'desktop',
}: {
  factor: MfaFactorRef
  status: CodeStatus
  /** A code was dispatched (sms / email) → show expiry + resend cooldown. */
  delivered: boolean
  onVerify: (code: string) => void
  onResend: () => void
  onChooseFactor?: () => void
  /** Restart sign-in (offered on the rate-limited screen). */
  onRestart?: () => void
  /** Epoch-ms end of a 429 wait; null/undefined = no usable Retry-After. */
  retryAt?: number | null
  /** Fixed challenge deadline (epoch ms). Defaults to now + the expiry window, captured once. */
  expiresAt?: number
  /** Rendered inside a host card: no card chrome of our own. */
  hosted?: boolean
  variant?: Variant
}) {
  const { messages: m } = useAccountSecurityI18n()
  const [code, setCode] = useState('')
  const [resendKey, setResendKey] = useState(0)
  const fallbackDeadline = useRef(Date.now() + EXPIRY_SECONDS * 1000)
  // A resend restarts only the cooldown; the challenge's expiry is fixed.
  const expiresIn = useDeadlineCountdown(expiresAt ?? fallbackDeadline.current, delivered)
  const cooldown = useCountdown(RESEND_COOLDOWN_SECONDS, resendKey, delivered)
  const mobile = variant === 'mobile'
  const needed = 6
  const rateLimited = status === 'rate-limited'
  const wait = useRetryCountdown(rateLimited ? retryAt : undefined)
  const cooling = rateLimited && wait !== null && wait > 0

  // Hooks differ per frame: desktop → data-component/mfa-challenge, mobile → data-panel/enter-code.
  const frameAttrs = mobile
    ? {
        'data-panel': 'enter-code',
        'data-state': status === 'idle' ? 'idle' : status,
        'data-http-status': rateLimited ? '429' : undefined,
        'data-factor': factor.type,
      }
    : {
        'data-component': 'mfa-challenge',
        'data-state': status === 'idle' ? (factor.type === 'totp' ? 'totp-prompt' : 'code-prompt') : status,
        'data-http-status': rateLimited ? '429' : undefined,
        'data-factor': factor.type,
      }

  if (status === 'error-delivery') {
    return (
      <SeamCard flush={mobile || hosted} {...frameAttrs}>
        <h2 style={{ margin: '0 0 var(--space-2)', fontFamily: 'var(--font-display)', fontSize: 'var(--text-lg)' }}>
          {m.stepUp.deliveryTitle}
        </h2>
        <Hint>{m.stepUp.deliveryText}</Hint>
        <Actions style={{ flexDirection: 'column' }}>
          <Button variant="primary" data-action="challenge" onClick={onResend}>
            {m.stepUp.resend}
          </Button>
          {onChooseFactor && (
            <Button variant="ghost" data-action="choose-factor" onClick={onChooseFactor}>
              {m.stepUp.useAnother}
            </Button>
          )}
        </Actions>
      </SeamCard>
    )
  }

  const prompt =
    status === 'error-invalid'
        ? m.stepUp.invalidPrompt
        : delivered
          ? factor.type === 'email'
            ? m.stepUp.sentPromptEmail
            : m.stepUp.sentPromptSms
          : mobile
            ? m.stepUp.totpPromptShort
            : m.stepUp.totpPrompt

  return (
    <SeamCard flush={mobile || hosted} {...frameAttrs}>
      <h2 style={{ margin: '0 0 var(--space-2)', fontFamily: 'var(--font-display)', fontSize: 'var(--text-lg)' }}>
        {m.stepUp.codeTitle}
      </h2>
      {rateLimited ? <RateLimitCallout seconds={wait} /> : <Hint>{prompt}</Hint>}
      <OtpInput
        length={needed}
        numeric
        value={code}
        onChange={setCode}
        error={status === 'error-invalid'}
        disabled={status === 'verifying'}
        size={mobile ? 'touch' : 'md'}
        aria-label={m.stepUp.codeLabel}
        autoFocus
      />
      {status === 'error-invalid' && <InlineError data-error="invalid-code">{m.stepUp.invalid}</InlineError>}
      {status === 'error-service' && <InlineError data-error="service-error">{m.stepUp.serviceError}</InlineError>}
      {delivered && (
        <>
          <div data-value="expires-in" style={{ marginBlockStart: 'var(--space-3)', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
            {m.stepUp.expiresIn.replace('{time}', formatClock(expiresIn))}
          </div>
          <div
            data-state={cooldown > 0 ? 'cooldown' : 'ready'}
            style={{ marginBlockStart: 'var(--space-2)', fontSize: 'var(--text-sm)' }}
          >
            <a
              href="#resend"
              data-action="resend"
              aria-disabled={cooldown > 0 ? 'true' : 'false'}
              onClick={(e) => {
                e.preventDefault()
                if (cooldown > 0 || status === 'verifying') return
                setResendKey((k) => k + 1)
                onResend()
              }}
              style={{
                color: cooldown > 0 ? 'var(--text-tertiary)' : 'var(--accent-color)',
                pointerEvents: cooldown > 0 ? 'none' : 'auto',
              }}
            >
              {m.stepUp.resendIn}
            </a>{' '}
            {cooldown > 0 && m.stepUp.resendCooldown.replace('{time}', formatClock(cooldown))}
          </div>
        </>
      )}
      <Actions style={{ flexDirection: 'column' }}>
        <Button
          variant="primary"
          fullWidth
          data-action="verify-mfa"
          onClick={() => onVerify(code)}
          disabled={status === 'verifying' || cooling || !OtpInput.isComplete(code, needed)}
          data-state={cooling ? 'cooldown' : undefined}
          aria-disabled={cooling || undefined}
          aria-busy={status === 'verifying' || undefined}
          leadingIcon={status === 'verifying' ? <Spinner size={16} label={m.stepUp.verifying} /> : undefined}
        >
          {status === 'verifying'
            ? m.stepUp.verifying
            : rateLimited
              ? retryButtonLabel(m, wait)
              : status === 'error-invalid' || status === 'error-service'
              ? m.stepUp.tryAgain
              : mobile
                ? m.stepUp.verifyShort
                : m.stepUp.verify}
        </Button>
        {rateLimited
          ? onRestart && (
              <Button variant="ghost" fullWidth data-action="back-to-sign-in" onClick={onRestart}>
                {m.stepUp.backToSignIn}
              </Button>
            )
          : onChooseFactor && (
              <Button variant="ghost" fullWidth data-action="choose-factor" onClick={onChooseFactor} disabled={status === 'verifying'}>
                {m.stepUp.useDifferent}
              </Button>
            )}
      </Actions>
    </SeamCard>
  )
}

// ── Orchestrator ────────────────────────────────────────────────────────────

type FactorsState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; factors: MfaFactorRef[] }

type Step =
  | { name: 'choose' }
  | { name: 'code'; factor: Choice; delivered: boolean; code: CodeStatus; retryAt?: number | null }

/**
 * Login MFA step-up (desktop frame 05 `/login/mfa`; mobile frames 01-02 at
 * 375px). Driven by the `mfa_required` challenge. FAIL-CLOSED throughout:
 *  - a wrong / expired code stays on screen with an inline error (never navigates);
 *  - the verify button disables while in flight (no double-submit);
 *  - a delivery failure (sms / email) offers resend and other methods;
 *  - zero factors → a "contact support" state, never a dead end or a guess;
 *  - a failed factor-list load offers retry only (no silent factor choice).
 */
export function MfaStepUpFlow(props: MfaStepUpProps & { variant?: Variant }) {
  return (
    <FlowRoot locale={props.locale}>
      <StepUpInner {...props} />
    </FlowRoot>
  )
}

/** Mobile (375px / TWA) step-up: touch-sized OTP cells and the mobile frame hooks. */
export function MfaStepUpMobileFlow(props: MfaStepUpProps) {
  return <MfaStepUpFlow {...props} variant="mobile" />
}

function StepUpInner({
  challenge,
  loadFactors,
  onAuthenticated,
  onContactSupport,
  onBack,
  hosted = false,
  client,
  getToken,
  variant = 'desktop',
}: MfaStepUpProps & { variant?: Variant }) {
  const { messages: m } = useAccountSecurityI18n()
  const api = useSecurityClient<StepUpClient>(client, getToken)
  // Fail-closed: only an explicit `true` from the server offers recovery.
  const recoveryEnabled = challenge.recoveryAvailable === true
  const mobile = variant === 'mobile'
  const [factorsState, setFactorsState] = useState<FactorsState>(
    challenge.factors ? { status: 'ready', factors: challenge.factors } : { status: 'loading' }
  )
  // Desktop frame: land directly on the authenticator prompt when TOTP is enrolled.
  // Computed synchronously so there is no flash of the picker before it.
  const initialTotp = !mobile ? challenge.factors?.find((f) => f.type === 'totp') : undefined
  const [step, setStep] = useState<Step>(
    initialTotp ? { name: 'code', factor: initialTotp, delivered: false, code: 'idle' } : { name: 'choose' }
  )
  const inFlight = useRef(false)
  const choosing = useRef(false)
  const [choosingBusy, setChoosingBusy] = useState(false)
  // The server's challenge deadline is fixed at login; resend never extends it.
  const expiresAt = useRef(Date.now() + EXPIRY_SECONDS * 1000)
  // Tracked on EVERY path (incl. TOTP, which shows no countdown): once the window
  // closes the server rejects everything, so we must not keep inviting codes.
  const expired = useDeadlineCountdown(expiresAt.current, true) === 0
  const alive = useRef(true)

  const loadList = useCallback(async () => {
    if (!loadFactors) {
      setFactorsState({ status: 'ready', factors: [] })
      return
    }
    setFactorsState({ status: 'loading' })
    try {
      const factors = await loadFactors()
      if (alive.current) setFactorsState({ status: 'ready', factors })
    } catch {
      if (alive.current) setFactorsState({ status: 'error' })
    }
  }, [loadFactors])

  useEffect(() => {
    alive.current = true
    if (!challenge.factors) void loadList()
    return () => {
      alive.current = false
    }
  }, [challenge.factors, loadList])

  // Factors that arrive later (loadFactors): same desktop landing rule, once.
  const startedRef = useRef(Boolean(initialTotp))
  useEffect(() => {
    if (startedRef.current || mobile || factorsState.status !== 'ready') return
    const totp = factorsState.factors.find((f) => f.type === 'totp')
    if (totp) {
      startedRef.current = true
      setStep({ name: 'code', factor: totp, delivered: false, code: 'idle' })
    }
  }, [factorsState, mobile])

  const choose = useCallback(
    async (choice: Choice) => {
      if (choice.type === 'recovery' || choice.type === 'totp') {
        setStep({ name: 'code', factor: choice, delivered: false, code: 'idle' })
        return
      }
      // sms / email: ask the server to dispatch a code first. Ignore re-entry
      // (double-click) while a dispatch is pending.
      // (also never while a verification is in flight, and vice-versa)
      if (choosing.current || inFlight.current) return
      choosing.current = true
      setChoosingBusy(true)
      try {
        const ack = await api.challengeMfa(challenge.challengeId, choice.factorId)
        const delivered = ack?.delivered !== false
        setStep({ name: 'code', factor: choice, delivered, code: delivered ? 'idle' : 'error-delivery' })
      } catch {
        setStep({ name: 'code', factor: choice, delivered: false, code: 'error-delivery' })
      } finally {
        choosing.current = false
        if (alive.current) setChoosingBusy(false)
      }
    },
    [api, challenge.challengeId]
  )

  const verify = useCallback(
    async (factor: Choice, delivered: boolean, code: string) => {
      if (inFlight.current || choosing.current) return
      inFlight.current = true
      setStep({ name: 'code', factor, delivered, code: 'verifying' })
      try {
        const session = factor.factorId
          ? await api.verifyMfa(challenge.challengeId, factor.factorId, code)
          : await api.verifyRecoveryCode(challenge.challengeId, code.trim())
        onAuthenticated(session)
      } catch (err) {
        if (!factor.factorId) {
          // Recovery redemption has distinct, contract-coded outcomes (frame 07 / mobile 05).
          const kind = classifyRecoveryFailure(err)
          const code: CodeStatus =
            kind === 'invalid'
              ? 'error-invalid'
              : kind === 'expired'
                ? 'error-expired'
                : kind === 'rate-limited'
                  ? 'rate-limited'
                  : 'error-generic'
          setStep({ name: 'code', factor, delivered, code, retryAt: kind === 'rate-limited' ? retryDeadline(retryAfterOf(err)) : undefined })
          return
        }
        // Fail closed on this screen. A rejected code (400/401/403/422) is "invalid"; a 429 shows the
        // Retry-After countdown (never "wrong code"); other 5xx / network failures are a retryable service error.
        const kind = classifyCodeFailure(err)
        setStep({
          name: 'code',
          factor,
          delivered,
          code: kind === 'invalid' ? 'error-invalid' : kind === 'rate-limited' ? 'rate-limited' : 'error-service',
          retryAt: kind === 'rate-limited' ? retryDeadline(retryAfterOf(err)) : undefined,
        })
      } finally {
        inFlight.current = false
      }
    },
    [api, challenge.challengeId, onAuthenticated]
  )

  const onRecovery = step.name === 'code' && step.factor.type === 'recovery'
  const title = step.name === 'choose' ? m.stepUp.chooseTitle : onRecovery ? m.stepUp.recoveryTitle : m.stepUp.codeTitle
  const wrapAttrs = mobile
    ? {
        'data-frame': step.name === 'choose' ? '01-choose-factor' : onRecovery ? '05-recovery-code' : '02-enter-code',
        'data-viewport': '375',
      }
    : { 'data-frame': onRecovery ? '07-recovery-code-entry' : '05-step-up-challenge', 'data-route': '/login/mfa' }

  let body: React.ReactNode
  if (expired) {
    body = (
      <div data-state="expired" data-component="mfa-challenge" role="alert">
        <StatusCallout
          tone="warning"
          icon="⏱"
          title={m.stepUp.expiredTitle}
          actions={
            onBack ? (
              <Button variant="primary" data-action="restart-sign-in" onClick={onBack}>
                {m.stepUp.restart}
              </Button>
            ) : undefined
          }
        >
          {m.stepUp.expiredText}
        </StatusCallout>
      </div>
    )
  } else if (step.name === 'code' && step.factor.type === 'recovery') {
    const factor = step.factor
    body = (
      <RecoveryCodeEntry
        variant={variant}
        status={step.code as RecoveryStatus}
        retryAt={step.retryAt}
        onVerify={(code) => void verify(factor, step.delivered, code)}
        onChooseFactor={() => setStep({ name: 'choose' })}
        onRestart={onBack}
        onContactSupport={onContactSupport}
        hosted={hosted}
      />
    )
  } else if (step.name === 'code') {
    body = (
      <MfaChallengeCard
        variant={variant}
        factor={step.factor as MfaFactorRef}
        status={step.code}
        retryAt={step.retryAt}
        onRestart={onBack}
        delivered={step.delivered}
        onVerify={(code) => void verify(step.factor, step.delivered, code)}
        onResend={() => void choose(step.factor)}
        onChooseFactor={() => setStep({ name: 'choose' })}
        expiresAt={expiresAt.current}
        hosted={hosted}
      />
    )
  } else if (factorsState.status === 'loading') {
    body = (
      <div
        data-panel={mobile ? 'choose-factor' : undefined}
        data-state="loading"
        aria-busy="true"
        role="status"
        aria-label={m.stepUp.loadingLabel}
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}
      >
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} width="100%" height="var(--space-12)" radius="var(--radius-md)" />
        ))}
      </div>
    )
  } else if (factorsState.status === 'error') {
    body = (
      <div data-panel={mobile ? 'choose-factor' : undefined} data-state="error">
        <StatusCallout
          tone="error"
          icon="!"
          title={m.stepUp.errorTitle}
          actions={
            <Button variant="primary" data-action="retry" onClick={() => void loadList()}>
              {m.stepUp.retry}
            </Button>
          }
        >
          {m.stepUp.errorText}
        </StatusCallout>
      </div>
    )
  } else if (
    // Empty is judged on the factors the picker can actually OFFER: a webauthn-only
    // challenge would otherwise render an empty picker (a dead end).
    !recoveryEnabled &&
    !factorsState.factors.some((f) => SUPPORTED_STEP_UP_TYPES.includes(f.type))
  ) {
    body = (
      <div data-panel={mobile ? 'choose-factor' : undefined} data-state="empty">
        <StatusCallout
          tone="warning"
          icon="🛟"
          title={m.stepUp.emptyTitle}
          actions={
            <Button variant="ghost" data-action="contact-support" onClick={onContactSupport}>
              {m.stepUp.contactSupport}
            </Button>
          }
        >
          {m.stepUp.emptyText}
        </StatusCallout>
      </div>
    )
  } else {
    const picker = (
      <FactorPicker
        variant={variant}
        factors={factorsState.factors}
        recoveryEnabled={recoveryEnabled}
        onChoose={(c) => void choose(c)}
        disabled={choosingBusy}
      />
    )
    body = mobile ? (
      <div data-panel="choose-factor" data-state="loaded">
        <Hint>{m.stepUp.chooseSubtitle}</Hint>
        {picker}
      </div>
    ) : (
      <SeamCard flush={hosted} data-component="mfa-challenge" data-state="choose-factor">
        <h2 style={{ margin: '0 0 var(--space-2)', fontFamily: 'var(--font-display)', fontSize: 'var(--text-lg)' }}>
          {m.stepUp.chooseTitle}
        </h2>
        <Hint>{m.stepUp.chooseSubtitle}</Hint>
        {picker}
      </SeamCard>
    )
  }

  return (
    <FlowPage title={title} maxWidth={mobile ? '100%' : 'var(--container-2xl)'} {...wrapAttrs}>
      {onBack && step.name === 'choose' && !expired && (
        <Button variant="ghost" data-action="back" onClick={onBack}>
          {m.stepUp.back}
        </Button>
      )}
      {body}
    </FlowPage>
  )
}
