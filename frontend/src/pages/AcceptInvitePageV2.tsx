import { useCallback, useMemo } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { AuthCard, Center } from '@fuzefront/design-system'
import { AuthPanel } from '@fuzefront/auth-ui'
import type { AuthTransport } from '@fuzefront/auth-ui'
import {
  IdentityI18nProvider,
  InvitationAcceptFlow,
  InvitationErrorState,
  type SignupSlotContext,
} from '@fuzefront/identity-ui'
import { useCurrentUser } from '../lib/shared'
import { useLanguage } from '../contexts/LanguageContext'
import { getActiveAuthToken } from '../lib/accounts'
import { authAPI } from '../services/api'
import type { SocialProvider } from '../services/api'
import {
  clearPendingInvite,
  isSafeInviteToken,
  readPendingInvite,
  savePendingInvite,
} from '../lib/pendingInvite'
import { mapAuthError } from './LoginPage'

/**
 * The invitation token for this URL. The emailed link is `/invitations/<token>`;
 * `AppContent` renders this page outside a `<Route>`, so `useParams()` is empty
 * in production — read the path (and the frames' `?token=`) as the source of
 * truth and keep `useParams` as the in-router fast path.
 */
export function tokenFromLocation(
  param: string | undefined,
  pathname: string,
  search: string
): string | null {
  if (isSafeInviteToken(param) && param !== 'accept') return param
  const seg = /^\/invitations\/([^/?#]+)/.exec(pathname)?.[1]
  if (seg) {
    const decoded = decodeURIComponent(seg)
    if (decoded !== 'accept' && isSafeInviteToken(decoded)) return decoded
  }
  const q = new URLSearchParams(search).get('token')
  return isSafeInviteToken(q) ? q : null
}

/**
 * AcceptInvitePageV2 — `/invitations/:token` behind `fuzefront.identity.invite-v2`
 * (design/frames/org-invitations-v2, flow `accept-bind`).
 *
 * A thin host adapter around `InvitationAcceptFlow` (identity-ui). It supplies:
 *   - the token (from the URL), the signed-in identity and the bearer-token
 *     accessor;
 *   - the sign-up form: `@fuzefront/auth-ui`'s `AuthPanel` (Google / Facebook /
 *     email) wired to the existing `authAPI`, signup-only, with the invitation
 *     `bindToken` forwarded so the server auto-binds on signup;
 *   - the carry across the sign-in / social round trip: the opaque token is
 *     parked in `pendingInvite` before leaving, `LoginPage` returns the user
 *     here, and `autoAccept` binds without a second click (closes the v1
 *     token-drop gap).
 */
function AcceptInvitePageV2() {
  const params = useParams<{ token: string }>()
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  const { language } = useLanguage()
  const { isAuthenticated, user, setUser } = useCurrentUser()

  const token = tokenFromLocation(params.token, pathname, search)
  const autoAccept = isAuthenticated && token !== null && readPendingInvite() === token

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
          if (!res?.token || !res?.user) throw new Error('Invalid response from server')
          return { status: 'authenticated', token: res.token, sessionId: res.sessionId, user: res.user }
        } catch (err) {
          throw new Error(mapAuthError(err))
        }
      },
      getAuthMethods: () => authAPI.getAuthMethods(),
      // Leaving for a provider: park the opaque token so the user is returned
      // here (by LoginPage's callback exchange) and the invite auto-binds.
      startSocial: provider => {
        if (token) savePendingInvite(token)
        return authAPI.startSocialLogin(provider as SocialProvider)
      },
    }),
    [token]
  )

  const handleSignIn = useCallback(() => {
    if (token) savePendingInvite(token)
    navigate('/login')
  }, [token, navigate])

  const handleSwitchAccount = useCallback(async () => {
    if (token) savePendingInvite(token)
    try {
      await authAPI.logout()
    } finally {
      window.location.href = '/login'
    }
  }, [token])

  const handleGoToOrg = useCallback((organizationId: string) => {
    clearPendingInvite()
    // Full navigation: the shell was in its public-route branch; remount it as
    // the freshly authenticated app.
    window.location.assign(`/organizations/${encodeURIComponent(organizationId)}`)
  }, [])

  const renderSignup = useCallback(
    (ctx: SignupSlotContext) => (
      <AuthPanel
        variant="compact"
        mode="signup"
        hideModeToggle
        transport={transport}
        bindToken={ctx.bindToken}
        emailHint={
          ctx.channel === 'email'
            ? `Use the address this invitation was sent to (${ctx.maskedContact}) — it's how we bind you to ${ctx.orgName}.`
            : `This invitation was sent to ${ctx.maskedContact}. Use the email you want for your account.`
        }
        labels={{
          heading: 'Your details',
          signUpSubtitle: `Join ${ctx.orgName} on FuzeFront`,
          signUpCta: 'Create account & join',
          googleCta: 'Continue with Google',
          facebookCta: 'Continue with Facebook',
        }}
        onAuthenticated={async () => {
          try {
            // `authAPI.signup` already persisted the session; hydrate the shell user.
            setUser(await authAPI.getCurrentUser())
          } catch (err) {
            console.error('Failed to hydrate user after invitation sign-up:', err)
          }
          ctx.onSignedUp()
        }}
      />
    ),
    [transport, setUser]
  )

  return (
    <IdentityI18nProvider locale={language === 'he' ? 'he' : 'en'}>
      <Center style={{ minBlockSize: '100vh', padding: 'var(--space-4)' }}>
        {token ? (
          <InvitationAcceptFlow
            token={token}
            getToken={getActiveAuthToken}
            session={isAuthenticated ? { email: user?.email } : null}
            autoAccept={autoAccept}
            renderSignup={renderSignup}
            onEnroll={() => savePendingInvite(token)}
            onSignIn={handleSignIn}
            onSwitchAccount={handleSwitchAccount}
            onGoToOrg={handleGoToOrg}
            onBound={() => clearPendingInvite()}
          />
        ) : (
          // No usable token in the URL: nothing to resolve — render the
          // fail-closed not-found state in place (never a redirect).
          <AuthCard maxWidth="30rem" data-panel="accept-resolve">
            <InvitationErrorState failure="not-found" />
          </AuthCard>
        )}
      </Center>
    </IdentityI18nProvider>
  )
}

export default AcceptInvitePageV2
