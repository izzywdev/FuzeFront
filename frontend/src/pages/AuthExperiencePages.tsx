import type { ReactNode } from 'react'
import { EmailVerificationFlow, PasswordResetFlow } from '@fuzefront/auth-ui'
import type { VerifyResetTransport } from '@fuzefront/auth-ui'
import { authAPI } from '../services/api'
import { useCurrentUser } from '../lib/shared'
import { takeSingleUseParam } from '../lib/singleUseParams'
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
  const { user } = useCurrentUser()
  // Display only: prefer the session's own address over the (spoofable) query.
  const email = user?.email ?? new URLSearchParams(window.location.search).get('email') ?? undefined
  return (
    <PageChrome>
      <EmailVerificationFlow
        view="check-inbox"
        transport={transport}
        email={email}
        continueHref="/dashboard"
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
      <PasswordResetFlow transport={transport} token={token} signInHref="/login" />
    </PageChrome>
  )
}
