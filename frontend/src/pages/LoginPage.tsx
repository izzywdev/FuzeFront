import { useEffect, useMemo, useState } from 'react'
import { useLanguage } from '../contexts/LanguageContext'
import { useCurrentUser } from '../lib/shared'
import { authAPI } from '../services/api'
import type { SessionResult } from '../services/api'
import { Alert, AuthCard } from '@fuzefront/design-system'
import { useT } from '@fuzefront/i18n'
import { AuthPanel, isAuthExperienceEnabled } from '@fuzefront/auth-ui'
import type {
  AuthenticatedMeta,
  AuthTransport,
  AuthPanelMode,
  AuthenticatedSession,
  MfaRequiredChallenge,
} from '@fuzefront/auth-ui'
import FuzeFrontLogo from '../assets/FuzeFrontLogo.svg'
import { authError, buildAuthLabels, buildSignupLabels, type TFn } from './authI18n'

/**
 * LoginPage — a thin adapter around `@fuzefront/auth-ui`'s `AuthPanel`.
 *
 * All email/password/signup/Google/MFA form markup + state now live ONCE in
 * AuthPanel (packages/auth-ui). This page only supplies:
 *   - the page chrome (FuzeFront logo + the `AuthCard` card wrapper),
 *   - the `AuthTransport` that wires AuthPanel to the existing `authAPI`,
 *   - i18n labels via `useLanguage()` (AuthPanel never imports useLanguage
 *     itself — it only renders injected strings),
 *   - the page-load social-callback exchange (`?code=`/`?error=` from the
 *     provider's redirect back to the app) — this is page-load ROUTING, not a
 *     form-submit concern, so it stays here rather than moving into AuthPanel.
 *
 * `fuzefront.auth.experience` (release flag, default OFF): when ON, signup mode renders
 * the redesigned `SignUpFlow` (optional full name, inline email availability, policy
 * checklist + strength meter from `AuthMethods.passwordPolicy`, confirm-match,
 * Turnstile when `AuthMethods.captcha` is present, explicit error states). When OFF the
 * current form is unchanged apart from the contract's single `name` field. All copy
 * is routed through i18n (`./authI18n` -> `locales/<lng>/common.json`, `auth.*`).
 */

// `variant="compact"` — the design-system `AuthCard` (design-system/components/layout)
// is ALREADY the card chrome (max-width, padding, border, shadow, seam accent).
// AuthPanel's `variant="full"` would wrap the form in its own CenteredCard,
// nesting a card inside a card. `compact` renders just the form/social/toggle
// innards, which is what belongs inside the page's own card.
const PANEL_VARIANT = 'compact' as const

/**
 * Reproduces the previous `handleCredentialsSubmit` catch block's error-message
 * taxonomy (timeout / provider-outage 503 / rejected-credentials 401 / network
 * / 500 / fallback) so AuthPanel — which just surfaces `Error.message` as-is —
 * shows the exact same wording as before. Kept here (not in AuthPanel) because
 * it is a mapping of THIS app's axios/Security-API error shapes, not a
 * generic UI concern. Every sentence is routed through i18n (`auth.error.*`).
 */
function mapAuthError(err: any, t: TFn): string {
  const isTimeout = err?.code === 'ECONNABORTED' || err?.name === 'CanceledError'
  const isNetworkError = !isTimeout && (err?.code === 'NETWORK_ERROR' || !err?.response)
  const status = err?.response?.status

  if (isTimeout) {
    // The request was bounded and did not answer in time — this is NOT "you
    // typed the wrong password"; word it as a service condition.
    return authError(t, 'timeout')
  }
  if (status === 503) {
    // The Security API distinguishes a provider outage from a rejected
    // credential (503 PROVIDER_UNAVAILABLE vs 401) — say the true thing and
    // nothing else, never mention credentials.
    return err?.response?.data?.code === 'PROVIDER_UNAVAILABLE'
      ? authError(t, 'providerUnavailable')
      : err?.response?.data?.error || authError(t, 'serviceUnavailable')
  }
  if (status === 401) {
    // Genuinely means "these credentials were rejected" (outage moved to 503
    // above). Deliberately doesn't name WHICH field is wrong.
    return authError(t, 'invalidCredentials')
  }
  if (isNetworkError) {
    return (err?.message || authError(t, 'failed')) + authError(t, 'networkSuffix')
  }
  if (status === 500) {
    return (
      (err?.response?.data?.error || err?.message || authError(t, 'failed')) +
      authError(t, 'serverSuffix')
    )
  }
  return err?.response?.data?.error || err?.message || authError(t, 'failed')
}

/**
 * The Error the AuthTransport throws: the friendly message PLUS the HTTP `status`
 * and contract `code`, so the redesigned signup can tell a 409 (account exists), a
 * weak-password 400/422, a 503 (provider down) and a 429 apart without parsing copy.
 */
function toAuthError(err: any, t: TFn): Error {
  return Object.assign(new Error(mapAuthError(err, t)), {
    status: err?.response?.status as number | undefined,
    code: (err?.response?.data?.code as string | undefined) ?? (err?.code as string | undefined),
  })
}

function LoginPage() {
  const { t } = useLanguage()
  // i18next `t` (locales/<lng>/common.json, `auth.*`) for the auth copy; the legacy
  // `useLanguage().t` above still supplies the two sign-in/sign-up toggle strings.
  const { t: tr } = useT()
  const ti = tr as unknown as TFn
  const experience = isAuthExperienceEnabled()
  // Open in sign-up mode when the user arrived at /signup; sign-in otherwise.
  // Anchored to the start of the path: `includes('signup')` also matched things
  // like /apps/signup-widget. This only works because api.ts no longer redirects
  // /signup -> /login on the boot probe's 401 (see AUTH_ROUTE_RE) — that
  // redirect used to erase the path before this ever ran.
  const [mode] = useState<AuthPanelMode>(
    /^\/signup\b/.test(window.location.pathname) ? 'signup' : 'signin'
  )
  const { setUser } = useCurrentUser()

  // A FuzePicker email opens its protected mentions route first. Preserve only
  // that same-origin path across sign-in/sign-up so a new recipient lands on
  // the mention they were sent, rather than being dropped on the dashboard.
  // This is intentionally an allowlist rather than a generic redirect query:
  // authentication must never become an open-redirect primitive.
  useEffect(() => {
    const current = `${window.location.pathname}${window.location.search}`
    if (current.startsWith('/fuzepicker/mentions')) {
      window.sessionStorage.setItem('fuzepicker:return-path', current)
    }
    // fuzefront.auth.experience: an expired verify link sends a signed-out user
    // here with `?next=/signup/verify`. EXACT-match allowlist (never a generic
    // redirect param) so this cannot become an open redirect.
    if (
      isAuthExperienceEnabled() &&
      new URLSearchParams(window.location.search).get('next') === '/signup/verify'
    ) {
      window.sessionStorage.setItem('auth:return-path', '/signup/verify')
    }
  }, [])

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
      setCallbackNotice(buildAuthLabels(ti).mfaNotice ?? '')
      return
    }
    try {
      const user = await authAPI.getCurrentUser()
      setUser(user)
      const returnPath = window.sessionStorage.getItem('fuzepicker:return-path')
      window.sessionStorage.removeItem('fuzepicker:return-path')
      const authReturn = window.sessionStorage.getItem('auth:return-path')
      window.sessionStorage.removeItem('auth:return-path')
      window.location.href = returnPath?.startsWith('/fuzepicker/mentions')
        ? returnPath
        : authReturn === '/signup/verify'
          ? authReturn
          : '/dashboard'
    } catch (err) {
      console.error('Failed to hydrate user after sign-in:', err)
      setCallbackError(authError(ti, 'profileLoad'))
    }
  }

  // Handle a social sign-in round-trip on page load. The provider callback
  // returns to the app with an opaque `?code=`; exchange it for a session.
  useEffect(() => {
    authAPI
      .handleAuthCallback()
      .then(({ result, error: callbackErr }) => {
        if (callbackErr) {
          setCallbackError(authError(ti, 'callbackFailed', { error: callbackErr }))
          return
        }
        if (result) {
          void completeSession(result)
        }
      })
      .catch(err => {
        // Backstop: a rejected promise must never freeze the page.
        console.error('Unexpected error in auth-callback handler:', err)
        setCallbackError(authError(ti, 'callbackUnexpected'))
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
          throw toAuthError(err, ti)
        }
      },
      signup: async req => {
        try {
          const res = await authAPI.signup(req)
          if (!res?.token || !res?.user) {
            throw new Error(authError(ti, 'invalidResponse'))
          }
          return {
            status: 'authenticated',
            token: res.token,
            sessionId: res.sessionId,
            user: res.user,
          }
        } catch (err) {
          throw toAuthError(err, ti)
        }
      },
      getAuthMethods: () => authAPI.getAuthMethods(),
      startSocial: provider => authAPI.startSocialLogin(provider),
      // GET /v1/security/signup/email-available — the new signup's debounced inline
      // check. Offered only with `fuzefront.auth.experience` ON; it rejects on any
      // failure and the form renders that as "couldn't check" (fail-open).
      ...(experience
        ? {
            checkEmailAvailable: (email: string, signal?: AbortSignal) =>
              authAPI.checkSignupEmailAvailable(email, signal),
          }
        : {}),
    }),
    // `tr` changes with the active language so error copy follows it.
    [tr, experience]
  )

  // `fuzefront.auth.experience` (default OFF): a fresh signup whose email is not
  // yet verified is sent to the check-inbox screen instead of straight into the
  // app. The signup response carries only the session, so "verification pending"
  // is derived from the contract: AuthMethods.verification.email (the platform
  // verifies email) AND GET /verify/status → emailVerified:false. Fail-open: any
  // error here falls through to today's behaviour rather than blocking sign-up.
  const routeAfterSignup = async (
    session: AuthenticatedSession,
    email: string
  ): Promise<void> => {
    try {
      const methods = await authAPI.getAuthMethods()
      if (methods.verification?.email) {
        // Ask with the session this signup just returned, so the check never
        // depends on which account the vault resolves as active.
        const status = await authAPI.getVerificationStatus(session.token)
        if (!status.emailVerified) {
          // Carry the saved deep link (fuzepicker mention) THROUGH the verification
          // detour as an allowlisted `next=`, and clear the stash so it can't
          // hijack a later, unrelated sign-in.
          const saved = window.sessionStorage.getItem('fuzepicker:return-path')
          window.sessionStorage.removeItem('fuzepicker:return-path')
          const next = saved?.startsWith('/fuzepicker/mentions')
            ? `&next=${encodeURIComponent(saved)}`
            : ''
          window.location.href = `/signup/verify?email=${encodeURIComponent(email)}${next}`
          return
        }
      }
    } catch (err) {
      console.warn('Could not determine email-verification status after signup:', err)
    }
    await completeSession(session)
  }

  const handleAuthenticated = (session: AuthenticatedSession, meta?: AuthenticatedMeta) => {
    if (isAuthExperienceEnabled() && meta?.mode === 'signup') {
      void routeAfterSignup(session, meta.email)
      return
    }
    void completeSession(session)
  }

  // AuthPanel already shows its own MFA notice (from `labels.mfaNotice`,
  // identical wording to the callback path above) when a form submit resolves
  // to a challenge — nothing further to surface here.
  const handleMfaRequired = (_challenge: MfaRequiredChallenge) => {}

  // Every auth label goes through i18n: the panel/sign-in copy and the redesigned
  // signup copy come from `locales/<lng>/common.json` (`auth.*`, see ./authI18n);
  // the sign-in <-> sign-up toggle strings still come from the legacy translations
  // table (`useLanguage().t`), which already carries their en/he wording.
  const labels = useMemo(
    () => ({
      ...buildAuthLabels(ti),
      toggleToSignUpPrompt: t('signUpMessage'),
      toggleToSignUpCta: t('signUp'),
    }),
    [t, tr]
  )
  const signupLabels = useMemo(
    () => buildSignupLabels(ti),
    [tr]
  )

  return (
    <AuthCard>
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
        <Alert tone="error" title={labels.errorTitle} style={{ marginBottom: 'var(--space-4, 16px)' }}>
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
        forgotPasswordHref={experience ? '/reset' : undefined}
        experience={experience}
        signupLabels={signupLabels}
        labels={labels}
      />
    </AuthCard>
  )
}

export default LoginPage
