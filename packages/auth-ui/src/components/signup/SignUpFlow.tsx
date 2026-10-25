import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Input, Spinner } from '@fuzefront/design-system'
import type {
  AuthMethods,
  AuthTransport,
  AuthenticatedMeta,
  AuthenticatedSession,
} from '../../types'
import { classifyAuthError } from '../verify-reset/errors'
import { PasswordStrengthMeter } from '../verify-reset/PasswordStrengthMeter'
import { PasswordConfirmField } from '../verify-reset/PasswordConfirmField'
import { FullNameField } from '../fields/FullNameField'
import { InlineAvailabilityField } from '../fields/InlineAvailabilityField'
import { PasswordPolicyChecklist } from '../fields/PasswordPolicyChecklist'
import { TurnstileField } from '../fields/TurnstileField'
import { SocialButton } from '../SocialButton'
import { AuthCard } from '../verify-reset/AuthCard'
import { DEFAULT_SIGNUP_LABELS, type SignUpLabels } from './labels'
import { buildPolicyRules, meetsPolicy } from './policy'

/**
 * Fallback capability descriptor so the form is never gated on the methods round
 * trip. NO `captcha` and NO `passwordPolicy` here on purpose: the checklist falls
 * back to `DEFAULT_PASSWORD_POLICY`, and a missing captcha means no widget — if the
 * server actually requires one it rejects the signup (fail-closed) and the error
 * state says so rather than the form silently passing.
 */
const FALLBACK_METHODS: AuthMethods = {
  password: true,
  social: ['google'],
  mfa: { enabled: false, types: [] },
  verification: { email: false, sms: false },
}

type SubmitError =
  | { kind: 'conflict' }
  | { kind: 'policy' }
  | { kind: 'unavailable' }
  | { kind: 'rate-limited' }
  | { kind: 'captcha' }
  | { kind: 'generic' }
  | null

export interface SignUpFlowProps {
  transport: AuthTransport
  /** Called with the new session. `meta.mode === 'signup'` so a host can route to email verification. */
  onAuthenticated: (session: AuthenticatedSession, meta?: AuthenticatedMeta) => void
  /**
   * Capability descriptor. When omitted the flow fetches it from `transport`. A host
   * that already has it (AuthPanel) passes it down with `methodsReady` so the page
   * makes one request, and the submit stays disabled until it has settled (the
   * captcha requirement is only known once it has).
   */
  methods?: AuthMethods
  methodsReady?: boolean
  /** `compact` renders just the form (inside a host card); `full` wraps it in the flow `AuthCard`. */
  variant?: 'compact' | 'full'
  /** Show the Google button. Also needs `transport.startSocial` and `google` in `methods.social`. Default true. */
  social?: boolean
  /** "Sign in" links (foot, taken-email help, 409 card). */
  signInHref?: string
  /** SPA handler for those links (the href is still rendered). */
  onSignInInstead?: () => void
  /** href for the 409 card's "reset your password" link. Omitted → the link is not rendered. */
  resetPasswordHref?: string
  termsHref?: string
  privacyHref?: string
  /** Debounce for the inline email check, ms. Default 500. */
  checkDebounceMs?: number
  /** Language passed to the Turnstile widget (`auto` follows the browser). */
  captchaLanguage?: string
  labels?: Partial<SignUpLabels>
}

const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/**
 * SignUpFlow — the redesigned account-creation orchestrator (frames 01-signup + 06-states).
 *
 * Single OPTIONAL full name → work email with debounced, FAIL-OPEN availability →
 * password with a live strength meter + per-rule checklist driven by the AUTHORITATIVE
 * `AuthMethods.passwordPolicy` → confirm with live match → Cloudflare Turnstile (only when
 * `AuthMethods.captcha` is present) → submit. Submit is disabled until the checklist passes,
 * the confirmation matches and, when a captcha is required, it is verified.
 *
 * Every failure is an explicit state, never a crash or a blank: 409 → "sign in instead",
 * weak password (inline AND post-submit), provider unavailable → "Continue with Google" +
 * retry, rate-limited, Turnstile failed. The Turnstile token is single-use, so every failed
 * submit resets the widget for a fresh one.
 */
export function SignUpFlow({
  transport,
  onAuthenticated,
  methods: methodsProp,
  methodsReady: methodsReadyProp,
  variant = 'compact',
  social = true,
  signInHref = '/login',
  onSignInInstead,
  resetPasswordHref,
  termsHref,
  privacyHref,
  checkDebounceMs,
  captchaLanguage,
  labels: overrides,
}: SignUpFlowProps) {
  const labels = useMemo(() => ({ ...DEFAULT_SIGNUP_LABELS, ...overrides }), [overrides])

  // ── capabilities ───────────────────────────────────────────────────────────
  const [ownMethods, setOwnMethods] = useState<AuthMethods>(FALLBACK_METHODS)
  const [ownReady, setOwnReady] = useState(false)
  useEffect(() => {
    if (methodsProp) return
    let cancelled = false
    transport
      .getAuthMethods()
      .then(m => !cancelled && setOwnMethods(m))
      .catch(() => !cancelled && setOwnMethods(FALLBACK_METHODS))
      .finally(() => !cancelled && setOwnReady(true))
    return () => {
      cancelled = true
    }
    // Once per mount, mirroring AuthPanel's capability fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const methods = methodsProp ?? ownMethods
  const methodsReady = methodsProp ? (methodsReadyProp ?? true) : ownReady
  const captcha = methods.captcha
  const socialEnabled = social && Boolean(transport.startSocial) && methods.social.includes('google')

  // ── form state ─────────────────────────────────────────────────────────────
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [token, setToken] = useState<string | null>(null)
  const [resetSignal, setResetSignal] = useState(0)
  const [pending, setPending] = useState(false)
  const [socialPending, setSocialPending] = useState(false)
  const [error, setError] = useState<SubmitError>(null)

  const rules = useMemo(() => buildPolicyRules(methods.passwordPolicy, labels), [methods.passwordPolicy, labels])
  const policyMet = meetsPolicy(password, rules)
  const confirmMatches = confirm.length > 0 && confirm === password
  const emailOk = LOOKS_LIKE_EMAIL.test(email.trim())
  const captchaOk = !captcha || token !== null
  const canSubmit = methodsReady && emailOk && policyMet && confirmMatches && captchaOk && !pending

  const pristine = !fullName && !email && !password && !confirm

  const signInInstead = (e: React.MouseEvent) => {
    if (onSignInInstead) {
      e.preventDefault()
      onSignInInstead()
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setPending(true)
    setError(null)
    try {
      const session = await transport.signup({
        email: email.trim(),
        password,
        name: fullName.trim() || undefined,
        turnstileToken: token ?? undefined,
      })
      onAuthenticated(session, { mode: 'signup', email: email.trim() })
    } catch (err) {
      const kind = classifyAuthError(err, { malformedIsPolicy: true })
      setError(
        kind === 'conflict' ? { kind: 'conflict' }
        : kind === 'captcha' ? { kind: 'captcha' }
        : kind === 'policy' ? { kind: 'policy' }
        : kind === 'unavailable' ? { kind: 'unavailable' }
        : kind === 'rate-limited' ? { kind: 'rate-limited' }
        : { kind: 'generic' },
      )
      // A Turnstile token is single-use: whatever failed, the next attempt needs a new one.
      if (captcha) {
        setToken(null)
        setResetSignal(n => n + 1)
      }
    } finally {
      setPending(false)
    }
  }

  const handleGoogle = () => {
    if (!transport.startSocial) return
    setSocialPending(true)
    transport
      .startSocial('google')
      .catch(() => setError({ kind: 'generic' }))
      .finally(() => setSocialPending(false))
  }

  // ── alerts ─────────────────────────────────────────────────────────────────
  const errorIcon = (
    <svg viewBox="0 0 20 20" fill="none" width="18" height="18">
      <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10 6v5M10 14h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )

  let alert: React.ReactNode = null
  if (error?.kind === 'conflict') {
    alert = (
      <Alert tone="error" icon={errorIcon} data-state="signup-conflict" className="fzf-su-alert">
        <b>{labels.conflictTitle}</b>{' '}
        <a className="fzf-su-link" href={signInHref} data-action="signin-instead" onClick={signInInstead}>
          {labels.conflictSignIn}
        </a>
        {resetPasswordHref && (
          <>
            {' '}
            {labels.conflictOr}{' '}
            <a className="fzf-su-link" href={resetPasswordHref} data-nav="reset">
              {labels.conflictReset}
            </a>
          </>
        )}
        .
      </Alert>
    )
  } else if (error?.kind === 'policy') {
    alert = (
      <Alert tone="error" icon={errorIcon} data-state="signup-pw-weak-submit" className="fzf-su-alert">
        <b>{labels.weakPasswordTitle}</b> {labels.weakPasswordText}
      </Alert>
    )
  } else if (error?.kind === 'rate-limited') {
    alert = (
      <Alert tone="warning" icon={errorIcon} data-state="rate-limited" className="fzf-su-alert">
        {labels.rateLimited}
      </Alert>
    )
  } else if (error?.kind === 'generic') {
    alert = (
      <Alert tone="error" icon={errorIcon} data-state="form-error" className="fzf-su-alert">
        {labels.genericError}
      </Alert>
    )
  }

  const rootState =
    pending ? 'submit-inflight'
    : error?.kind === 'conflict' ? 'signup-conflict'
    : error?.kind === 'policy' ? 'signup-pw-weak-submit'
    : error?.kind === 'unavailable' ? 'signup-service-unavailable'
    : error?.kind === 'generic' ? 'form-error'
    : pristine ? 'signup-initial'
    : 'editing'

  // ── provider unavailable: fail closed with a browser-flow fallback + retry ──
  const unavailable = error?.kind === 'unavailable'

  const body = (
    <div data-frame="01-signup" data-flow="signup" data-state={rootState} className="fzf-su">
      {variant === 'compact' && (
        <>
          <h2 className="fzf-auth-panel__heading">{labels.heading}</h2>
          <p className="fzf-auth-panel__subtitle">{labels.subtitle}</p>
        </>
      )}

      {unavailable ? (
        <div data-state="signup-service-unavailable" className="fzf-su-unavailable">
          <Alert tone="error" icon={errorIcon} className="fzf-su-alert">
            <b>{labels.unavailableTitle}</b> {labels.unavailableText}
          </Alert>
          {socialEnabled && (
            <SocialButton
              label={labels.googleCta}
              pendingLabel={labels.googlePending}
              pending={socialPending}
              disabled={socialPending}
              onClick={handleGoogle}
            />
          )}
          <p className="fzf-su-center">
            <button
              type="button"
              className="fzf-su-textbtn"
              data-action="retry"
              onClick={() => setError(null)}
            >
              {labels.retry}
            </button>
          </p>
        </div>
      ) : (
        <>
          {alert}
          <form data-form="signup" noValidate onSubmit={handleSubmit} className="fzf-auth-panel__form">
            <FullNameField value={fullName} onChange={setFullName} disabled={pending} labels={labels} />

            <InlineAvailabilityField
              value={email}
              onChange={setEmail}
              disabled={pending}
              check={transport.checkEmailAvailable}
              debounceMs={checkDebounceMs}
              signInHref={signInHref}
              onSignInInstead={onSignInInstead}
              labels={labels}
            />

            <div className="fzf-su-field">
              <Input
                id="fzf-signup-password"
                name="password"
                type="password"
                label={labels.passwordLabel}
                autoComplete="new-password"
                value={password}
                disabled={pending}
                invalid={error?.kind === 'policy'}
                aria-describedby="fzf-signup-pw-meter"
                showPasswordLabel={labels.showPassword}
                hidePasswordLabel={labels.hidePassword}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
              />
              <PasswordStrengthMeter
                id="fzf-signup-pw-meter"
                value={password}
                rules={rules}
                showChecklist={false}
                labels={{
                  strengthLabel: labels.strengthLabel,
                  strengthWeak: labels.strengthWeak,
                  strengthFair: labels.strengthFair,
                  strengthGood: labels.strengthGood,
                  strengthStrong: labels.strengthStrong,
                }}
              >
                <PasswordPolicyChecklist
                  value={password}
                  rules={rules}
                  labels={labels}
                  highlightUnmet={error?.kind === 'policy'}
                />
              </PasswordStrengthMeter>
            </div>

            <PasswordConfirmField
              password={password}
              value={confirm}
              onChange={setConfirm}
              id="fzf-signup-confirm"
              label={labels.confirmLabel}
              labels={{
                matches: labels.confirmMatch,
                mismatch: labels.confirmMismatch,
                showPassword: labels.showPassword,
                hidePassword: labels.hidePassword,
              }}
            />

            {captcha && (
              <TurnstileField
                siteKey={captcha.siteKey}
                onToken={setToken}
                resetSignal={resetSignal}
                failed={error?.kind === 'captcha'}
                language={captchaLanguage}
                labels={labels}
              />
            )}

            <Button
              type="submit"
              variant="primary"
              fullWidth
              data-action="submit"
              data-state={pending ? 'submit-inflight' : undefined}
              disabled={!canSubmit}
              aria-busy={pending || undefined}
              leadingIcon={pending ? <Spinner size={16} aria-hidden="true" /> : undefined}
            >
              {pending ? labels.submitting : labels.submit}
            </Button>
          </form>

          {socialEnabled && (
            <div className="fzf-auth-panel__social">
              <div className="fzf-auth-panel__divider" role="separator">
                <span className="fzf-su-rule" />
                <span className="fzf-auth-panel__divider-label">{labels.orDivider}</span>
                <span className="fzf-su-rule" />
              </div>
              <SocialButton
                label={labels.googleCta}
                pendingLabel={labels.googlePending}
                pending={socialPending}
                disabled={socialPending || pending}
                onClick={handleGoogle}
              />
            </div>
          )}

          <p className="fzf-su-foot">
            {labels.haveAccount}{' '}
            <a className="fzf-su-link" href={signInHref} data-nav="signin" onClick={signInInstead}>
              {labels.signIn}
            </a>
          </p>
          {termsHref && privacyHref && (
            <p className="fzf-su-legal">
              {labels.legalPrefix}{' '}
              <a href={termsHref}>{labels.terms}</a> {labels.legalAnd} <a href={privacyHref}>{labels.privacy}</a>.
            </p>
          )}
        </>
      )}
    </div>
  )

  return variant === 'full' ? (
    <AuthCard title={labels.heading} subtitle={labels.subtitle}>
      {body}
    </AuthCard>
  ) : (
    body
  )
}
