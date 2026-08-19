import { useEffect, useMemo, useState } from 'react'
import { useLanguage } from '../contexts/LanguageContext'
import { useCurrentUser } from '../lib/shared'
import { authAPI } from '../services/api'
import type { SessionResult } from '../services/api'
import { Alert } from '@fuzefront/design-system'
import { AuthPanel } from '@fuzefront/auth-ui'
import type {
  AuthTransport,
  AuthPanelMode,
  AuthenticatedSession,
  MfaRequiredChallenge,
} from '@fuzefront/auth-ui'
import FuzeFrontLogo from '../assets/FuzeFrontLogo.svg'

/**
 * LoginPage — a thin adapter around `@fuzefront/auth-ui`'s `AuthPanel`.
 *
 * All email/password/signup/Google/MFA form markup + state now live ONCE in
 * AuthPanel (packages/auth-ui). This page only supplies:
 *   - the page chrome (FuzeFront logo + the `.auth-form` card wrapper),
 *   - the `AuthTransport` that wires AuthPanel to the existing `authAPI`,
 *   - i18n labels via `useLanguage()` (AuthPanel never imports useLanguage
 *     itself — it only renders injected strings),
 *   - the page-load social-callback exchange (`?code=`/`?error=` from the
 *     provider's redirect back to the app) — this is page-load ROUTING, not a
 *     form-submit concern, so it stays here rather than moving into AuthPanel.
 *
 * KNOWN GAP vs. the pre-refactor page (tracked for a fast-follow to
 * @fuzefront/auth-ui, not fixed here): AuthPanel v0.1.0 does not yet implement
 * the signup confirm-password field, the password-policy checklist gating
 * submit, or the inline email-availability check that the old LoginPage had.
 * Those are UI capabilities the reusable component does not yet expose — they
 * are NOT reintroduced as one-off LoginPage markup (that would refork the
 * logic AuthPanel is meant to own). See the PR description for the follow-up.
 */

// `variant="compact"` — `.auth-form` (frontend/src/index.css) is ALREADY the
// card chrome (max-width, padding, border, shadow, seam accent). AuthPanel's
// `variant="full"` would wrap the form in its own CenteredCard, nesting a card
// inside a card. `compact` renders just the form/social/toggle innards, which
// is what belongs inside the page's own card.
const PANEL_VARIANT = 'compact' as const

/**
 * Reproduces the previous `handleCredentialsSubmit` catch block's error-message
 * taxonomy (timeout / provider-outage 503 / rejected-credentials 401 / network
 * / 500 / fallback) so AuthPanel — which just surfaces `Error.message` as-is —
 * shows the exact same wording as before. Kept here (not in AuthPanel) because
 * it is a mapping of THIS app's axios/Security-API error shapes, not a
 * generic UI concern.
 */
function mapAuthError(err: any): string {
  const isTimeout = err?.code === 'ECONNABORTED' || err?.name === 'CanceledError'
  const isNetworkError = !isTimeout && (err?.code === 'NETWORK_ERROR' || !err?.response)
  const status = err?.response?.status

  if (isTimeout) {
    // The request was bounded and did not answer in time — this is NOT "you
    // typed the wrong password"; word it as a service condition.
    return 'Sign-in is taking longer than expected — the service may be busy. Please try again.'
  }
  if (status === 503) {
    // The Security API distinguishes a provider outage from a rejected
    // credential (503 PROVIDER_UNAVAILABLE vs 401) — say the true thing and
    // nothing else, never mention credentials.
    return err?.response?.data?.code === 'PROVIDER_UNAVAILABLE'
      ? 'The sign-in service is temporarily unavailable. Your details are fine — please try again in a moment.'
      : err?.response?.data?.error ||
          'The sign-in service is temporarily unavailable. Please try again in a moment.'
  }
  if (status === 401) {
    // Genuinely means "these credentials were rejected" (outage moved to 503
    // above). Deliberately doesn't name WHICH field is wrong.
    return 'Incorrect email or password. Please try again.'
  }
  if (isNetworkError) {
    return (
      (err?.message || 'Authentication failed') +
      ' (Network connection failed — check if the service is running)'
    )
  }
  if (status === 500) {
    return (
      (err?.response?.data?.error || err?.message || 'Authentication failed') +
      ' (Server error — please try again shortly)'
    )
  }
  return err?.response?.data?.error || err?.message || 'Authentication failed'
}

function LoginPage() {
  const { t } = useLanguage()
  // Open in sign-up mode when the user arrived at /signup; sign-in otherwise.
  // Anchored to the start of the path: `includes('signup')` also matched things
  // like /apps/signup-widget. This only works because api.ts no longer redirects
  // /signup -> /login on the boot probe's 401 (see AUTH_ROUTE_RE) — that
  // redirect used to erase the path before this ever ran.
  const [mode] = useState<AuthPanelMode>(
    /^\/signup\b/.test(window.location.pathname) ? 'signup' : 'signin'
  )
  const { setUser } = useCurrentUser()

  // Page-load social-callback outcome (the OAuth provider redirecting back
  // with `?code=`/`?error=`) is a SEPARATE concern from AuthPanel's own
  // form-submit error/notice — AuthPanel has no prop to surface an
  // externally-sourced result, and this is page-load routing, not a panel
  // concern, per the refactor plan. Rendered as its own Alert above the panel.
  const [callbackError, setCallbackError] = useState('')
  const [callbackNotice, setCallbackNotice] = useState('')

  // Route an authenticated Security-API session into the app: hydrate the
  // current user then land on the dashboard. Always re-fetches via
  // getCurrentUser() rather than trusting a session's `user` field directly —
  // that field is typed `unknown` in the frozen security contract (both on the
  // callback-exchange SessionResult and on AuthPanel's AuthenticatedSession),
  // while getCurrentUser() already returns the shape this app's `User` expects.
  // A `SessionResult` may instead be an `mfa_required` challenge (step-up).
  const completeSession = async (result: SessionResult): Promise<void> => {
    if (result.status === 'mfa_required') {
      setCallbackNotice(
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
      setCallbackError('Signed in, but failed to load your profile. Please retry.')
    }
  }

  // Handle a social sign-in round-trip on page load. The provider callback
  // returns to the app with an opaque `?code=`; exchange it for a session.
  useEffect(() => {
    authAPI
      .handleAuthCallback()
      .then(({ result, error: callbackErr }) => {
        if (callbackErr) {
          setCallbackError(`Authentication failed: ${callbackErr}`)
          return
        }
        if (result) {
          void completeSession(result)
        }
      })
      .catch(err => {
        // Backstop: a rejected promise must never freeze the page.
        console.error('Unexpected error in auth-callback handler:', err)
        setCallbackError('Authentication encountered an unexpected error. Please try again.')
      })
    // Runs ONCE on mount — this is a page-load handler (social-callback
    // exchange only now; AuthPanel owns its own auth-methods fetch).
  }, [])

  // The AuthTransport injection seam — wraps the existing authAPI so AuthPanel
  // never imports an HTTP client directly. `login`/`signup` translate a
  // rejected axios call into the same friendly wording the old inline
  // catch block produced (see mapAuthError); AuthPanel just renders
  // `Error.message` as-is.
  const transport = useMemo<AuthTransport>(
    () => ({
      login: async req => {
        try {
          return await authAPI.login(req)
        } catch (err) {
          throw new Error(mapAuthError(err))
        }
      },
      signup: async req => {
        try {
          const res = await authAPI.signup(req)
          if (!res?.token || !res?.user) {
            throw new Error('Invalid response from server')
          }
          return {
            status: 'authenticated',
            token: res.token,
            sessionId: res.sessionId,
            user: res.user,
          }
        } catch (err) {
          throw new Error(mapAuthError(err))
        }
      },
      getAuthMethods: () => authAPI.getAuthMethods(),
      startSocial: provider => authAPI.startSocialLogin(provider),
    }),
    []
  )

  const handleAuthenticated = (session: AuthenticatedSession) => {
    void completeSession(session)
  }

  // AuthPanel already shows its own MFA notice (from `labels.mfaNotice`,
  // identical wording to the callback path above) when a form submit resolves
  // to a challenge — nothing further to surface here.
  const handleMfaRequired = (_challenge: MfaRequiredChallenge) => {}

  // Only the mode-toggle strings were ever routed through t() on this page —
  // the heading/subtitle were always literal English, which is exactly
  // AuthPanel's default copy, so no override is needed for those.
  const labels = useMemo(
    () => ({
      toggleToSignUpPrompt: t('signUpMessage'),
      toggleToSignUpCta: t('signUp'),
    }),
    [t]
  )

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
        <img src={FuzeFrontLogo} alt="FuzeFront" style={{ height: '48px', width: 'auto' }} />
      </div>

      {callbackError && (
        <Alert tone="error" title="Authentication Error" style={{ marginBottom: 'var(--space-4, 16px)' }}>
          {callbackError}
        </Alert>
      )}
      {callbackNotice && (
        <Alert tone="info" style={{ marginBottom: 'var(--space-4, 16px)' }}>
          {callbackNotice}
        </Alert>
      )}

      <AuthPanel
        variant={PANEL_VARIANT}
        mode={mode}
        transport={transport}
        onAuthenticated={handleAuthenticated}
        onMfaRequired={handleMfaRequired}
        labels={labels}
      />
    </div>
  )
}

export default LoginPage
