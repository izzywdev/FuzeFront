import React, { useEffect, useState } from 'react'
import { Button, Input, Alert, SeamDivider, CenteredCard } from '@fuzeone/design-system'
import type {
  AuthPanelProps,
  AuthMethods,
  PendingAction,
  AuthPanelMode,
} from '../types'
import { DEFAULT_AUTH_LABELS } from '../types'
import { GoogleGlyph } from './GoogleGlyph'

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
  labels: labelOverrides,
}: AuthPanelProps) {
  const labels = { ...DEFAULT_AUTH_LABELS, ...labelOverrides }
  const [mode, setMode] = useState<AuthPanelMode>(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [pending, setPending] = useState<PendingAction>(null)
  const loading = pending !== null
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [authMethods, setAuthMethods] = useState<AuthMethods>(FALLBACK_METHODS)

  useEffect(() => {
    let cancelled = false
    transport
      .getAuthMethods()
      .then((methods) => {
        if (!cancelled) setAuthMethods(methods)
      })
      .catch(() => {
        if (!cancelled) setAuthMethods(FALLBACK_METHODS)
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
    setNotice('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setPending('credentials')
    setError('')
    setNotice('')
    try {
      if (mode === 'signup') {
        const session = await transport.signup({
          email,
          password,
          firstName: firstName || undefined,
          lastName: lastName || undefined,
        })
        onAuthenticated(session)
        return
      }

      const result = await transport.login({ email, password })
      if (result.status === 'mfa_required') {
        setNotice(labels.mfaNotice)
        onMfaRequired?.(result)
        return
      }
      onAuthenticated(result)
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
    setNotice('')
    transport
      .startSocial('google')
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : undefined
        setError(message || 'Failed to start sign-in')
      })
      .finally(() => setPending(null))
  }

  const form = (
    <div className="fzf-auth-panel">
      <h2 className="fzf-auth-panel__heading">{labels.heading}</h2>
      <p className="fzf-auth-panel__subtitle">
        {mode === 'signin' ? labels.signInSubtitle : labels.signUpSubtitle}
      </p>

      {error && (
        <Alert tone="error" title="Authentication Error" className="fzf-auth-panel__alert">
          {error}
        </Alert>
      )}
      {notice && (
        <Alert tone="info" className="fzf-auth-panel__alert">
          {notice}
        </Alert>
      )}

      {passwordEnabled && (
        <form onSubmit={handleSubmit} className="fzf-auth-panel__form">
          {mode === 'signup' && (
            <div className="fzf-auth-panel__name-row">
              <Input
                id="fzf-auth-firstName"
                label={labels.firstNameLabel}
                value={firstName}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFirstName(e.target.value)}
                autoComplete="given-name"
                style={{ flex: 1 }}
              />
              <Input
                id="fzf-auth-lastName"
                label={labels.lastNameLabel}
                value={lastName}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLastName(e.target.value)}
                autoComplete="family-name"
                style={{ flex: 1 }}
              />
            </div>
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
          <button
            type="button"
            className="fzf-auth-panel__google-button"
            onClick={handleGoogle}
            disabled={loading}
            aria-label={labels.googleCta}
          >
            <GoogleGlyph />
            {pending === 'google' ? labels.googlePending : labels.googleCta}
          </button>
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

  if (variant === 'compact') return form
  return <CenteredCard maxWidth="440px">{form}</CenteredCard>
}
