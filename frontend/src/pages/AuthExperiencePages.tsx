import type { ReactNode } from 'react'
import { EmailVerificationFlow, PasswordResetFlow } from '@fuzefront/auth-ui'
import type { VerifyResetTransport } from '@fuzefront/auth-ui'
import { authAPI } from '../services/api'
import { useCurrentUser } from '../lib/shared'
import { takeSingleUseParam } from '../lib/singleUseParams'
import { beginAddAccount, canAddAccount, getActiveAuthToken } from '../lib/accounts'
import FuzeFrontLogo from '../assets/FuzeFrontLogo.svg'

/**
 * Public auth-experience routes (FFRNT-360, flag `fuzefront.auth.experience`):
 *   /signup/verify  — "check your inbox" after signup   (frame 03-check-inbox)
 *   /verify/email   — the emailed verify-link landing    (frame 04-verify-landing)
 *   /reset          — password reset request + confirm   (frame 05-password-reset)
 *
 * Thin adapters: all UI + state lives in `@fuzefront/auth-ui`; this file only
 * supplies the transport (authAPI, same-origin /api/v1/security), reads the
 * query string, and wires navigation.
 */

const transport: VerifyResetTransport = {
  // No address is ever sent: the server derives it from the session.
  startEmailVerification: () => authAPI.startEmailVerification(),
  confirmEmailVerification: req => authAPI.confirmEmailVerification(req),
  requestPasswordReset: email => authAPI.requestPasswordReset(email),
  confirmPasswordReset: req => authAPI.confirmPasswordReset(req),
}

/**
 * "Back to sign in" from /reset. If ANOTHER account is signed in in this tab,
 * a plain /login reload would find that session and bounce to /dashboard — so the
 * user would never reach a sign-in form for the account they just reset. Route
 * through the repo's add-account (provisional-session) flow so the shell boots
 * unauthenticated in this tab only; other accounts keep their sessions.
 */
function goToSignIn() {
  if (getActiveAuthToken() && canAddAccount()) beginAddAccount()
  window.location.href = '/login'
}

/** Only the fuzepicker mention deep link survives the verification detour (same allowlist as LoginPage). */
function safeNext(raw: string | null): string | undefined {
  return raw && raw.startsWith('/fuzepicker/mentions') && !raw.startsWith('//') ? raw : undefined
}

function PageChrome({ children }: { children: ReactNode }) {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-8) var(--space-4)',
        background: 'var(--bg-primary)',
      }}
    >
      <img
        src={FuzeFrontLogo}
        alt="FuzeFront"
        style={{ height: 'var(--space-12)', width: 'auto', marginBottom: 'var(--space-6)' }}
      />
      {/* The DS AuthCard inside each flow is the width-bounded, self-centring card. */}
      <div style={{ width: '100%' }}>{children}</div>
    </main>
  )
}

export function VerifyCheckInboxPage() {
  const { user, isAuthenticated } = useCurrentUser()
  // Display only: prefer the session's own address over the (spoofable) query.
  const params = new URLSearchParams(window.location.search)
  const email = user?.email ?? params.get('email') ?? undefined
  const next = safeNext(params.get('next')) ?? '/dashboard'
  return (
    <PageChrome>
      <EmailVerificationFlow
        view="check-inbox"
        transport={transport}
        email={email}
        continueHref={next}
        canResend={isAuthenticated}
      />
    </PageChrome>
  )
}

export function VerifyLandingPage() {
  const token = takeSingleUseParam('token')
  const { isAuthenticated } = useCurrentUser()
  return (
    <PageChrome>
      <EmailVerificationFlow
        view="landing"
        transport={transport}
        token={token}
        canResend={isAuthenticated}
        signInForLinkHref="/login?next=/signup/verify"
        signInHref="/login"
        onContinue={() => {
          window.location.href = '/dashboard'
        }}
      />
    </PageChrome>
  )
}

export function ResetPage() {
  const token = takeSingleUseParam('token')
  return (
    <PageChrome>
      <PasswordResetFlow
        transport={transport}
        token={token}
        signInHref="/login"
        onBackToSignIn={goToSignIn}
      />
    </PageChrome>
  )
}
