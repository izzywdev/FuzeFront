import { useState, type ReactNode } from 'react'
import { Alert } from '@fuzefront/design-system'
import { EmailVerificationFlow, PasswordResetFlow } from '@fuzefront/auth-ui'
import type { VerifyResetTransport } from '@fuzefront/auth-ui'
import { authAPI } from '../services/api'
import { useCurrentUser } from '../lib/shared'
import { takeSingleUseParam } from '../lib/singleUseParams'
import {
  beginAddAccount,
  canAddAccount,
  getActiveAccountId,
  getActiveAuthToken,
  listAccounts,
} from '../lib/accounts'
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
  startEmailVerification: accountId =>
    accountId ? authAPI.startEmailVerification(accountId) : authAPI.startEmailVerification(),
  confirmEmailVerification: req => authAPI.confirmEmailVerification(req),
  requestPasswordReset: email => authAPI.requestPasswordReset(email),
  confirmPasswordReset: req => authAPI.confirmPasswordReset(req),
}

/**
 * "Sign in as another account" (Back to sign in from /reset, "Not you?" on an
 * expired verify link). If an account is signed in in this tab a plain /login
 * would find that session and bounce to /dashboard, so route through the repo's
 * add-account (provisional-session) flow: the shell boots unauthenticated in
 * this tab only and the other accounts keep their sessions. When the roster is
 * FULL that flow is unavailable and a plain /login would bounce too, so do NOT
 * navigate; show an inline notice instead.
 */
function useSignInAsAnotherAccount() {
  const [rosterFull, setRosterFull] = useState(false)
  const go = () => {
    if (!getActiveAuthToken()) {
      window.location.href = '/login'
      return
    }
    if (!canAddAccount()) {
      setRosterFull(true)
      return
    }
    beginAddAccount()
    window.location.href = '/login'
  }
  const notice = rosterFull ? (
    <Alert tone="warning" data-state="account-limit" style={{ marginTop: 'var(--space-4)' }}>
      You're signed in to the maximum number of accounts. Sign out of one to sign in as another.{' '}
      {/* The account switcher / sign-out live in the user menu inside the app shell. */}
      <a href="/dashboard" data-action="open-account-menu">
        Open FuzeFront to sign out or switch accounts
      </a>
    </Alert>
  ) : null
  return { go, notice }
}

/** Only the fuzepicker mention deep link survives the verification detour (same allowlist as LoginPage). */
function safeNext(raw: string | null): string | undefined {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return undefined
  // Check the path the browser will actually navigate to: `../` segments and
  // percent-encoded dots are resolved by URL, so a prefix match on the raw
  // string would let `/fuzepicker/mentions/../../admin` escape the allowlist.
  let url: URL
  try {
    url = new URL(raw, window.location.origin)
  } catch {
    return undefined
  }
  if (url.origin !== window.location.origin) return undefined
  const ok = url.pathname === '/fuzepicker/mentions' || url.pathname.startsWith('/fuzepicker/mentions/')
  return ok ? `${url.pathname}${url.search}${url.hash}` : undefined
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
  const anotherAccount = useSignInAsAnotherAccount()
  // Signed-in accounts the server could target, ACTIVE FIRST. An expired token does
  // not say which account it was for, so the UI must name the target (or ask).
  const activeId = getActiveAccountId()
  const accounts = listAccounts()
    .filter(a => !a.expired)
    .sort((x, y) => Number(y.id === activeId) - Number(x.id === activeId))
    .map(a => ({ id: a.id, email: a.email }))
  return (
    <PageChrome>
      <EmailVerificationFlow
        view="landing"
        transport={transport}
        token={token}
        canResend={isAuthenticated}
        accounts={accounts}
        onUseAnotherAccount={anotherAccount.go}
        signInForLinkHref="/login?next=/signup/verify"
        signInHref="/login"
        onContinue={() => {
          window.location.href = '/dashboard'
        }}
      />
      {anotherAccount.notice}
    </PageChrome>
  )
}

export function ResetPage() {
  const token = takeSingleUseParam('token')
  const anotherAccount = useSignInAsAnotherAccount()
  return (
    <PageChrome>
      <PasswordResetFlow
        transport={transport}
        token={token}
        signInHref="/login"
        onBackToSignIn={anotherAccount.go}
      />
      {anotherAccount.notice}
    </PageChrome>
  )
}
