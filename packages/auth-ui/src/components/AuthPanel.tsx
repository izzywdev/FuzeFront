import React, { useEffect, useState } from 'react'
import { Button, Input, Alert, SeamDivider, CenteredCard } from '@fuzefront/design-system'
import type {
  AuthPanelProps,
  AuthMethods,
  PendingAction,
  AuthPanelMode,
} from '../types'
import { DEFAULT_AUTH_LABELS } from '../types'
import { SocialButton } from './SocialButton'
import { SignUpFlow } from './signup/SignUpFlow'
import { DEFAULT_SIGNUP_LABELS } from './signup/labels'

/**
 * Fallback capability descriptor — rendered immediately so the form is never
 * gated on the `getAuthMethods()` round trip; a slow/failed capability fetch
 * degrades to this, never to a blank screen.
 *
 * `social: ['google']` mirrors the SECURITY SERVICE'S OWN default
 * (backend/security/src/routes/security.ts: enabled unless
 * SECURITY_SOCIAL_GOOGLE=false, which no deploy env sets) — this panel's
 * `transport` is that service's contract, not a generic unknown backend, so
 * the fallback should describe what that specific backend actually does by
 * default, not the safest-sounding guess. `social: []` looked plausible but
 * was wrong: every time the fetch was slow, raced an unmount, or errored, a
 * legitimately-enabled Google button silently vanished — "it doesn't show in
 * some cases," reported against LoginPage, which carried the same bug and is
 * fixed the same way. If the security-service default ever changes, update
 * this to match. */
const FALLBACK_METHODS: AuthMethods = {
  password: true,
  social: ['google'],
  mfa: { enabled: false, types: [] },
  verification: { email: false, sms: false },
}

/**
 * `AuthPanel` — the reusable sign-in / sign-up form. Behavior parity with
 * `frontend/src/pages/LoginPage.tsx`, minus every host-specific dependency
 * (`useLanguage`, `useCurrentUser`, `window.location`, asset imports): every
 * side effect goes through the injected `transport`, every outcome comes back
 * via `onAuthenticated` / `onMfaRequired`.
 */
export function AuthPanel({
  variant = 'full',
  mode: initialMode = 'signin',
  transport,
  onAuthenticated,
  onMfaRequired,
  social = true,
  forgotPasswordHref,
  onForgotPassword,
  labels: labelOverrides,
  experience = false,
  signupLabels,
  termsHref,
  privacyHref,
  onSignInInstead,
  resetPasswordHref,
}: AuthPanelProps) {
  const labels = { ...DEFAULT_AUTH_LABELS, ...labelOverrides }
  const signupText = { ...DEFAULT_SIGNUP_LABELS, ...signupLabels }
  const [mode, setMode] = useState<AuthPanelMode>(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [pending, setPending] = useState<PendingAction>(null)
  const loading = pending !== null
  const [error, setError] = useState('')
  const [mfaPending, setMfaPending] = useState(false)
  const [authMethods, setAuthMethods] = useState<AuthMethods>(FALLBACK_METHODS)
  // The new signup experience needs to know whether a captcha is required BEFORE it
  // enables submit, so it waits for the capability fetch to settle (success or fallback).
  const [methodsReady, setMethodsReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    transport
      .getAuthMethods()
      .then((methods) => {
        if (!cancelled) {
          setAuthMethods(methods)
          setMethodsReady(true)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAuthMethods(FALLBACK_METHODS)
          setMethodsReady(true)
        }
      })
    return () => {
      cancelled = true
    }
    // Runs once per mount, mirroring LoginPage's page-load capability fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const passwordEnabled = authMethods.password !== false
  const socialEnabled = social && Boolean(transport.startSocial) && authMethods.social.includes('google')

  const toggleMode = () => {
    setMode((m) => (m === 'signin' ? 'signup' : 'signin'))
    setError('')
    setMfaPending(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setPending('credentials')
    setError('')
    setMfaPending(false)
    try {
      if (mode === 'signup') {
        const session = await transport.signup({
          email,
          password,
          name: name.trim() || undefined,
        })
        onAuthenticated(session, { mode: 'signup', email })
        return
      }

      const result = await transport.login({ email, password })
      if (result.status === 'mfa_required') {
        setMfaPending(true)
        onMfaRequired?.(result)
        return
      }
      onAuthenticated(result, { mode: 'signin', email })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : undefined
      setError(message || labels.genericError)
    } finally {
      setPending(null)
    }
  }

  const handleGoogle = () => {
    if (!transport.startSocial) return
    setPending('google')
    setError('')
    setMfaPending(false)
    transport
      .startSocial('google')
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : undefined
        setError(message || labels.socialStartError)
      })
      .finally(() => setPending(null))
  }

  const legacyForm = (
    <div className="fzf-auth-panel">
      <h2 className="fzf-auth-panel__heading">{labels.heading}</h2>
      <p className="fzf-auth-panel__subtitle">
        {mode === 'signin' ? labels.signInSubtitle : labels.signUpSubtitle}
      </p>

      {error && (
        <Alert tone="error" title={labels.errorTitle} className="fzf-auth-panel__alert">
          {error}
        </Alert>
      )}
      {mfaPending && (
        <Alert tone="info" className="fzf-auth-panel__alert" data-state="mfa-required">
          {experience ? (
            <>
              <b>{signupText.mfaTitle}</b> {signupText.mfaText}
            </>
          ) : (
            labels.mfaNotice
          )}
        </Alert>
      )}

      {passwordEnabled && (
        <form onSubmit={handleSubmit} className="fzf-auth-panel__form">
          {mode === 'signup' && (
            <Input
              id="fzf-auth-name"
              label={labels.nameLabel}
              value={name}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
              autoComplete="name"
            />
          )}

          <Input
            id="fzf-auth-email"
            label={labels.emailLabel}
            type="email"
            value={email}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />

          <Input
            id="fzf-auth-password"
            label={labels.passwordLabel}
            type="password"
            value={password}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            required
          />

          {mode === 'signin' && forgotPasswordHref && (
            <a
              className="fzf-auth-panel__forgot"
              href={forgotPasswordHref}
              onClick={(e) => {
                if (onForgotPassword) {
                  e.preventDefault()
                  onForgotPassword()
                }
              }}
            >
              {labels.forgotPassword}
            </a>
          )}

          <Button type="submit" variant="primary" fullWidth disabled={loading}>
            {pending === 'credentials'
              ? mode === 'signup'
                ? labels.signUpPending
                : labels.signInPending
              : mode === 'signup'
                ? labels.signUpCta
                : labels.signInCta}
          </Button>
        </form>
      )}

      {socialEnabled && (
        <div className="fzf-auth-panel__social">
          <div className="fzf-auth-panel__divider">
            <SeamDivider style={{ flex: 1 }} />
            <span className="fzf-auth-panel__divider-label">{labels.orDivider}</span>
            <SeamDivider style={{ flex: 1 }} />
          </div>
          <SocialButton
            label={labels.googleCta}
            pendingLabel={labels.googlePending}
            pending={pending === 'google'}
            disabled={loading}
            onClick={handleGoogle}
          />
        </div>
      )}

      <div className="fzf-auth-panel__toggle">
        <p className="fzf-auth-panel__toggle-prompt">
          {mode === 'signin' ? labels.toggleToSignUpPrompt : labels.toggleToSignInPrompt}
        </p>
        <Button type="button" variant="secondary" fullWidth disabled={loading} onClick={toggleMode}>
          {mode === 'signin' ? labels.toggleToSignUpCta : labels.toggleToSignInCta}
        </Button>
      </div>
    </div>
  )

  // `fuzefront.auth.experience`: the redesigned signup replaces ONLY the signup form;
  // sign-in is untouched and, with the flag off, nothing here changes.
  const form =
    experience && mode === 'signup' ? (
      <div className="fzf-auth-panel">
        <SignUpFlow
          variant="compact"
          transport={transport}
          methods={authMethods}
          methodsReady={methodsReady}
          social={social}
          onAuthenticated={onAuthenticated}
          onSignInInstead={onSignInInstead ?? toggleMode}
          resetPasswordHref={resetPasswordHref ?? forgotPasswordHref}
          termsHref={termsHref}
          privacyHref={privacyHref}
          labels={signupLabels}
        />
      </div>
    ) : (
      legacyForm
    )

  if (variant === 'compact') return form
  return <CenteredCard maxWidth="440px">{form}</CenteredCard>
}
