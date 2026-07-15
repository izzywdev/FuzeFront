import React, { useState, useEffect, useRef } from 'react'
import { useLanguage } from '../contexts/LanguageContext'
import { useCurrentUser } from '../lib/shared'
import { authAPI } from '../services/api'
import type { AuthMethods, SessionResult } from '../services/api'
import { Button, Input, Alert, SeamDivider } from '@fuzefront/design-system'
import FuzeFrontLogo from '../assets/FuzeFrontLogo.svg'

// Official Google "G" mark palette — these exact values are mandated by
// Google's brand identity guidelines for third-party sign-in buttons and must
// NOT be themed or tokenized (they are a trademark asset, not UI styling).
const GOOGLE_BRAND = {
  red: '#EA4335', // ds-conformance-allow: third-party brand mark (Google identity guidelines)
  blue: '#4285F4', // ds-conformance-allow: third-party brand mark (Google identity guidelines)
  yellow: '#FBBC05', // ds-conformance-allow: third-party brand mark (Google identity guidelines)
  green: '#34A853', // ds-conformance-allow: third-party brand mark (Google identity guidelines)
}

// Neutral fallback capability descriptor — password-only. Used when the Security
// API can't be reached so the form is still usable. No provider is named: the
// browser only ever knows FuzeFront's own /api/v1/security surface.
const FALLBACK_METHODS: AuthMethods = {
  password: true,
  social: [],
  mfa: { enabled: false, types: [] },
  verification: { email: false, sms: false },
}

/** Which sign-in action is in flight. Per-action (not a single boolean) so the
 * button the user clicked shows ITS progress label while the others merely
 * disable — a shared flag made every button flip to "Redirecting…" at once. */
type PendingAction = 'credentials' | 'google' | 'signup' | null

type FormMode = 'signin' | 'signup'

function LoginPage() {
  const { t } = useLanguage()
  // Open in sign-up mode when the user arrived at /signup; sign-in otherwise.
  const [mode, setMode] = useState<FormMode>(
    window.location.pathname.includes('signup') ? 'signup' : 'signin'
  )
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [pending, setPending] = useState<PendingAction>(null)
  const loading = pending !== null
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [authMethods, setAuthMethods] = useState<AuthMethods | null>(null)
  const { setUser } = useCurrentUser()

  // Route an authenticated Security-API session into the app: hydrate the
  // current user then land on the dashboard. A `SessionResult` may instead be an
  // `mfa_required` challenge (step-up) — surfaced as a notice here; the full
  // step-up UI is a separate, flagged screen.
  const completeSession = async (result: SessionResult): Promise<void> => {
    if (result.status === 'mfa_required') {
      setNotice(
        'Additional verification is required to finish signing in. Please complete the verification step to continue.'
      )
      return
    }
    try {
      const user = await authAPI.getCurrentUser()
      setUser(user)
      window.location.href = '/dashboard'
    } catch (err) {
      console.error('Failed to hydrate user after sign-in:', err)
      setError('Signed in, but failed to load your profile. Please retry.')
    }
  }

  // Handle a social sign-in round-trip on page load. The provider callback
  // returns to the app with an opaque `?code=`; exchange it for a session.
  useEffect(() => {
    authAPI
      .handleAuthCallback()
      .then(({ result, error: callbackError }) => {
        if (callbackError) {
          setError(`Authentication failed: ${callbackError}`)
          loadAuthMethods()
          return
        }
        if (result) {
          void completeSession(result)
          return
        }
        loadAuthMethods()
      })
      .catch(err => {
        // Backstop: a rejected promise must never freeze the page.
        console.error('Unexpected error in auth-callback handler:', err)
        setError('Authentication encountered an unexpected error. Please try again.')
        loadAuthMethods()
      })
    // Runs ONCE on mount — this is a page-load handler (social-callback exchange
    // + auth-method fetch). setUser is a stable ref; a mount-only effect is the
    // correct shape for a page-load handler regardless.
  }, [])

  const loadAuthMethods = async () => {
    try {
      const methods = await authAPI.getAuthMethods()
      setAuthMethods(methods)
    } catch (err) {
      console.error('Failed to load auth methods:', err)
      setAuthMethods(FALLBACK_METHODS)
    }
  }

  // Credentials submit — password sign-in OR account creation, both brokered by
  // FuzeFront's own Security API. The user only ever sees FuzeFront-branded UI;
  // the identity engine behind it is a swappable server-side adapter.
  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setPending('credentials')
    setError('')
    setNotice('')

    try {
      if (mode === 'signup') {
        const { token, user } = await authAPI.signup({
          email,
          password,
          firstName: firstName || undefined,
          lastName: lastName || undefined,
        })
        if (token && user) {
          setUser(user)
          window.location.href = '/dashboard'
        } else {
          throw new Error('Invalid response from server')
        }
        return
      }

      const result = await authAPI.login({ email, password })
      await completeSession(result)
    } catch (err: any) {
      console.error('Authentication error:', err)
      let errorMessage =
        err.response?.data?.error || err.message || 'Authentication failed'
      if (err.code === 'NETWORK_ERROR' || !err.response) {
        errorMessage += ' (Network connection failed — check if the service is running)'
      } else if (err.response?.status === 500) {
        errorMessage += ' (Server error — please try again shortly)'
      }
      setError(errorMessage)
    } finally {
      setPending(null)
    }
  }

  // The social redirect leaves the page, so `pending` normally never resets. If
  // the navigation target hangs (the sign-in service isn't answering), the page
  // would sit on "Redirecting…" forever — recover after a grace period.
  const redirectWatchdog = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    return () => {
      if (redirectWatchdog.current) clearTimeout(redirectWatchdog.current)
    }
  }, [])

  const handleGoogleLogin = () => {
    setPending('google')
    setError('')
    setNotice('')
    Promise.resolve()
      .then(() => authAPI.startSocialLogin('google'))
      .then(() => {
        if (redirectWatchdog.current) clearTimeout(redirectWatchdog.current)
        redirectWatchdog.current = setTimeout(() => {
          setPending(null)
          setError('The sign-in service is not responding. Please try again in a moment.')
        }, 12000)
      })
      .catch((err: any) => {
        console.error('Social sign-in redirect error:', err)
        setError('Failed to start sign-in')
        setPending(null)
      })
  }

  const toggleMode = () => {
    setMode(m => (m === 'signin' ? 'signup' : 'signin'))
    setError('')
    setNotice('')
  }

  const socialEnabled = Boolean(authMethods?.social?.includes('google'))
  const passwordEnabled = authMethods?.password !== false

  return (
    <div className="auth-form">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 'var(--space-6, 24px)',
        }}
      >
        <img
          src={FuzeFrontLogo}
          alt="FuzeFront"
          style={{ height: '48px', width: 'auto', marginRight: 'var(--space-3, 12px)' }}
        />
        <h2 style={{ margin: 0 }}>Welcome to FuzeFront</h2>
      </div>
      <p style={{ color: 'var(--text-secondary)' }}>
        {mode === 'signin'
          ? 'Sign in to access your microfrontend platform'
          : 'Create your account to get started'}
      </p>

      {error && (
        <Alert tone="error" title="Authentication Error" style={{ marginBottom: 'var(--space-4, 16px)' }}>
          {error}
        </Alert>
      )}
      {notice && (
        <Alert tone="info" style={{ marginBottom: 'var(--space-4, 16px)' }}>
          {notice}
        </Alert>
      )}

      {/* Credentials form — the DEFAULT sign-in/sign-up UI, brokered entirely by
          FuzeFront's own Security API (same-origin /api/v1/security). No identity
          provider is named or contacted by the browser. */}
      {authMethods && passwordEnabled && (
        <form onSubmit={handleCredentialsSubmit}>
          {mode === 'signup' && (
            <div style={{ display: 'flex', gap: 'var(--space-3, 12px)' }}>
              <Input
                id="firstName"
                label="First name"
                value={firstName}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFirstName(e.target.value)}
                autoComplete="given-name"
                style={{ flex: 1 }}
              />
              <Input
                id="lastName"
                label="Last name"
                value={lastName}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLastName(e.target.value)}
                autoComplete="family-name"
                style={{ flex: 1 }}
              />
            </div>
          )}

          <Input
            id="email"
            label="Email"
            type="email"
            value={email}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />

          <Input
            id="password"
            label="Password"
            type="password"
            value={password}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            required
          />

          <Button type="submit" variant="primary" fullWidth disabled={loading}>
            {pending === 'credentials'
              ? mode === 'signup'
                ? 'Creating account…'
                : 'Signing in…'
              : mode === 'signup'
                ? 'Create account'
                : 'Sign In'}
          </Button>
        </form>
      )}

      {/* Social sign-in — brokered through FuzeFront's Security API; the platform
          starts a same-host authorize flow and the browser never talks to any
          provider directly. Shown only when the capability descriptor advertises
          the provider. */}
      {socialEnabled && (
        <div style={{ marginTop: 'var(--space-4, 16px)' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-3, 12px)',
              margin: 'var(--space-4, 16px) 0',
            }}
          >
            <SeamDivider style={{ flex: 1 }} />
            <span style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-sm, 14px)' }}>or</span>
            <SeamDivider style={{ flex: 1 }} />
          </div>
          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={loading}
            aria-label="Sign in with Google"
            style={{
              width: '100%',
              padding: 'var(--space-3, 12px)',
              backgroundColor: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-md, 6px)',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: 'var(--text-md, 16px)',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 'var(--space-2, 10px)',
            }}
          >
            {/* Official Google "G" mark — see GOOGLE_BRAND above. */}
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
              <path fill={GOOGLE_BRAND.red} d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
              <path fill={GOOGLE_BRAND.blue} d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
              <path fill={GOOGLE_BRAND.yellow} d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
              <path fill={GOOGLE_BRAND.green} d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
            </svg>
            {pending === 'google' ? 'Redirecting to Google…' : 'Sign in with Google'}
          </button>
        </div>
      )}

      {/* Mode toggle — sign-up / sign-in both happen on this page, brokered by
          the Security API (no external enrollment redirect). */}
      <div
        style={{
          marginTop: 'var(--space-6, 24px)',
          paddingTop: 'var(--space-6, 24px)',
          borderTop: '1px solid var(--border-color)',
          textAlign: 'center',
        }}
      >
        <p style={{ margin: '0 0 var(--space-3, 12px)', color: 'var(--text-secondary)', fontSize: 'var(--text-base, 0.9rem)' }}>
          {mode === 'signin' ? t('signUpMessage') : 'Already have an account?'}
        </p>
        <Button type="button" variant="secondary" fullWidth disabled={loading} onClick={toggleMode}>
          {mode === 'signin' ? t('signUp') : 'Back to sign in'}
        </Button>
      </div>
    </div>
  )
}

export default LoginPage
