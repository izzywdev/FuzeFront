import { useEffect, useMemo, useState } from 'react'
import { useLanguage } from '../contexts/LanguageContext'
import { useCurrentUser } from '../lib/shared'
import { authAPI } from '../services/api'
import type { SessionResult, BrokerClient } from '../services/api'
import { Alert, AuthCard, BrandTokenScope } from '@fuzefront/design-system'
import { AuthPanel } from '@fuzefront/auth-ui'
import type {
  AuthTransport,
  AuthPanelMode,
  AuthenticatedSession,
  MfaRequiredChallenge,
} from '@fuzefront/auth-ui'
import FuzeFrontLogo from '../assets/FuzeFrontLogo.svg'

/**
 * Consumer-product sign-in handoff (marketplace token handoff, #238). A
 * registered broker client (e.g. the Mendys datasets marketplace) sends its
 * user here with `?client=<key>&redirect_uri=<its callback>`. Read ONCE on
 * module load (not inside the component) so it survives re-renders and is
 * stable for the lifetime of the page the same way `mode` above is.
 */
function readBrokerParamsFromLocation(): { client: string; redirectUri: string } | null {
  const params = new URLSearchParams(window.location.search)
  const client = params.get('client')
  const redirectUri = params.get('redirect_uri')
  if (!client || !redirectUri) return null
  return { client, redirectUri }
}

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
 * KNOWN GAP vs. the pre-refactor page (tracked for a fast-follow to
 * @fuzefront/auth-ui, not fixed here): AuthPanel v0.1.0 does not yet implement
 * the signup confirm-password field, the password-policy checklist gating
 * submit, or the inline email-availability check that the old LoginPage had.
 * Those are UI capabilities the reusable component does not yet expose — they
 * are NOT reintroduced as one-off LoginPage markup (that would refork the
 * logic AuthPanel is meant to own). See the PR description for the follow-up.
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

  // Broker handoff context (#238) — read once; `null` for the ordinary
  // (non-broker) sign-in path, which is unaffected by anything below.
  const [brokerParams] = useState(readBrokerParamsFromLocation)
  const [brokerClient, setBrokerClient] = useState<BrokerClient | null>(null)
  const [brokerError, setBrokerError] = useState('')

  // Resolve the broker client's public branding (name/logo/accent/tagline) up
  // front so the themed sign-in page can render it BEFORE the user
  // authenticates. Fails open to default FuzeFront branding on any error
  // (unknown client, network) — getBrokerClient() never throws.
  useEffect(() => {
    if (!brokerParams) return
    let cancelled = false
    authAPI.getBrokerClient(brokerParams.client).then(result => {
      if (!cancelled) setBrokerClient(result)
    })
    return () => {
      cancelled = true
    }
  }, [brokerParams])

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
    } catch (err) {
      console.error('Failed to hydrate user after sign-in:', err)
      setCallbackError('Signed in, but failed to load your profile. Please retry.')
      return
    }

    // Broker handoff (#238): a registered consumer product sent this user
    // here with `?client=&redirect_uri=`. Instead of landing on THIS app's
    // dashboard, mint a one-time code and send the browser back to the
    // product's own callback — its BACKEND redeems the code
    // server-to-server. A handoff failure (unknown client / redirectUri no
    // longer allowlisted / dead session) is surfaced in place; it never
    // silently falls through to the FuzeFront dashboard, which would strand
    // the product's user mid-flow with no way back to where they started.
    if (brokerParams) {
      try {
        const { redirectUri } = await authAPI.brokerHandoff(brokerParams)
        window.location.href = redirectUri
      } catch (err: any) {
        console.error('Broker handoff failed:', err)
        setBrokerError(
          err?.response?.data?.error ||
            'Signed in, but could not hand off to the requesting application. Please try again.'
        )
      }
      return
    }

    window.location.href = '/dashboard'
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

  const branding = brokerClient?.branding
  const pageContent = (
    <AuthCard>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: branding?.tagline ? 'var(--space-2, 8px)' : 'var(--space-6, 24px)',
        }}
      >
        {/* Per-product theming (FF-EPIC-13 PortalBranding semantics): a
            registered broker client's logo, or the default FuzeFront
            lockup — null/missing never renders a broken image. */}
        {branding?.logo ? (
          <img src={branding.logo} alt={branding.name} style={{ height: '48px', width: 'auto' }} />
        ) : (
          <img src={FuzeFrontLogo} alt="FuzeFront" style={{ height: '48px', width: 'auto' }} />
        )}
      </div>

      {branding?.tagline && (
        <p
          style={{
            textAlign: 'center',
            color: 'var(--text-secondary)',
            fontSize: 'var(--text-sm)',
            margin: '0 0 var(--space-6, 24px)',
          }}
        >
          {branding.tagline}
        </p>
      )}

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
      {brokerError && (
        <Alert tone="error" title="Could not complete sign-in" style={{ marginBottom: 'var(--space-4, 16px)' }}>
          {brokerError}
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
    </AuthCard>
  )

  // Scope the design-system `--accent-*` tokens to the broker client's
  // validated brand color (AA-contrast-checked, fail-closed to the base DS
  // accent on an invalid/missing color) — the SAME primitive the
  // authenticated white-label portal shell uses (`@fuzefront/portal-branding-ui`'s
  // `PortalThemeScope`), applied here directly since this pre-auth page has
  // no portal context to resolve, only the broker client's own branding.
  return branding?.accent ? (
    <BrandTokenScope accent={branding.accent} data-broker-client={brokerClient?.client}>
      {pageContent}
    </BrandTokenScope>
  ) : (
    pageContent
  )
}

export default LoginPage
