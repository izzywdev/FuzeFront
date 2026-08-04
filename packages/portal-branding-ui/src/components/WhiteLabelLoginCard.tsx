import React, { useCallback, useState } from 'react'
import { Alert, Button, Input } from '@fuzeone/design-system'
import type { NormalizedPortalContext } from '../types'
import { PortalBrandLockup } from './PortalBrandLockup'

export interface WhiteLabelLoginCardProps {
  context: NormalizedPortalContext
}

interface AuthRejection {
  code?: string
  message: string
}

const SESSION_ENDPOINT = '/api/v1/security/session'

/**
 * The white-label sign-in surface (frame 03, `[data-whitelabel="true"]`).
 * WHITE-LABEL INVARIANT: nothing in this component ever renders the literal
 * string "FuzeFront" — auth is served same-origin by the hidden platform, but
 * the tenant's user never sees its name.
 *
 * Submits to the same-origin `/api/v1/security/session` (the same endpoint
 * `frontend/src/services/api.ts`'s `authAPI.login` posts to). A 403 with
 * `code: 'cross_portal_rejected'` (FF-EPIC-10-S3 AC3 — the token's portal_id
 * doesn't match the resolved host) renders the fail-closed
 * `[data-state="cross-portal-reject"]` notice instead of a generic error.
 */
export function WhiteLabelLoginCard({ context }: WhiteLabelLoginCardProps) {
  const { name, tagline } = context.branding
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [rejection, setRejection] = useState<AuthRejection | null>(null)

  const resetRejection = useCallback(() => setRejection(null), [])

  const handleSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault()
      setSubmitting(true)
      try {
        const res = await fetch(SESSION_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        })
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
          setRejection({
            code: typeof body.code === 'string' ? body.code : undefined,
            message:
              typeof body.message === 'string' ? body.message : 'Sign-in failed. Please try again.',
          })
          return
        }
        setRejection(null)
        const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
        if (typeof body.token === 'string') {
          // Write into the shell's ACCOUNT VAULT, not the bare `authToken` key.
          // The host namespaces every per-account value under
          // `ff.acct.<accountId>.<key>` (frontend/src/lib/accounts.ts), and this
          // provisional namespace is exactly where a first sign-in parks its
          // token until `/session` names the account — after the navigation
          // below, the shell adopts it onto the real account id.
          //
          // A bare `authToken` would survive only because the vault's ONE-TIME
          // legacy migration happens to sweep it at boot. Relying on an upgrade
          // path as an ongoing write channel is how this breaks silently the day
          // that migration is retired, so the key is written correctly here.
          //
          // The literal is duplicated rather than imported because this package
          // must not depend on host app code; frontend/src/__tests__/
          // e2e-account-vault-helper.test.ts pins the same format.
          localStorage.setItem('ff.acct.__provisional__.authToken', body.token)
        }
        window.location.href = '/dashboard'
      } catch {
        // Network failure — never an uncaught rejection reaching the console.
        setRejection({ message: 'Sign-in failed. Please try again.' })
      } finally {
        setSubmitting(false)
      }
    },
    [email, password]
  )

  const isCrossPortalRejection = rejection?.code === 'cross_portal_rejected'

  return (
    <div
      data-whitelabel="true"
      style={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: '1.05fr 0.95fr' }}
    >
      <section
        data-region="brand"
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 'var(--space-12)',
          borderInlineEnd: '1px solid var(--border-color)',
          background: 'var(--bg-primary)',
        }}
      >
        <PortalBrandLockup context={context} size="lg" />
        <div>
          <h1
            data-branding-copy="tagline"
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--text-3xl)',
              letterSpacing: 'var(--tracking-display)',
              margin: '0 0 var(--space-4)',
              color: 'var(--text-primary)',
            }}
          >
            {tagline || `Welcome to ${name}.`}
          </h1>
          <p
            data-branding-copy="subtitle"
            style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-lg)', margin: 0 }}
          >
            Sign in to the {name} workspace to reach your apps, docs, and reports.
          </p>
        </div>
        <div
          style={{
            display: 'flex',
            gap: 'var(--space-4)',
            fontSize: 'var(--text-xs)',
            color: 'var(--text-tertiary)',
          }}
        >
          <a href="#" style={{ color: 'inherit' }}>
            Terms
          </a>
          <a href="#" style={{ color: 'inherit' }}>
            Privacy
          </a>
          <a href="#" style={{ color: 'inherit' }}>
            Support
          </a>
        </div>
      </section>

      <section
        data-region="auth"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 'var(--space-10)',
        }}
      >
        <form
          data-form="login"
          onSubmit={handleSubmit}
          style={{
            width: '100%',
            maxWidth: '24rem',
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-lg)',
            padding: 'var(--space-8)',
            boxShadow: 'var(--shadow-md)',
          }}
        >
          <h2
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--text-xl)',
              margin: '0 0 var(--space-1)',
              color: 'var(--text-primary)',
            }}
          >
            Sign in
          </h2>
          <p
            data-branding-copy="welcome"
            style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)', margin: '0 0 var(--space-6)' }}
          >
            Welcome back to {name}.
          </p>

          {/* No native `required` — the RED spec (and the real cross-portal
              rejection flow) submits and lets the SERVER validate/reject;
              client-side `required` would block the native form submission
              before our onSubmit ever runs. */}
          <Input
            label="Email"
            type="email"
            id="portal-login-email"
            name="email"
            autoComplete="username"
            value={email}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
          />
          <div style={{ height: 'var(--space-4)' }} />
          <Input
            label="Password"
            type="password"
            id="portal-login-password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
          />
          <a
            data-action="forgot"
            href="#"
            style={{
              display: 'block',
              textAlign: 'end',
              fontSize: 'var(--text-xs)',
              marginTop: 'var(--space-2)',
              color: 'var(--accent-color)',
            }}
          >
            Forgot password?
          </a>

          <div style={{ height: 'var(--space-5)' }} />
          <Button type="submit" data-action="submit" fullWidth disabled={submitting}>
            {submitting ? 'Signing in…' : `Sign in to ${name}`}
          </Button>

          <div
            style={{
              textAlign: 'center',
              fontSize: 'var(--text-2xs)',
              color: 'var(--text-tertiary)',
              margin: 'var(--space-4) 0',
            }}
          >
            or
          </div>

          <button
            type="button"
            data-action="social-sso"
            style={{
              display: 'flex',
              width: '100%',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 'var(--space-2)',
              padding: 'var(--space-3)',
              background: 'var(--bg-quaternary)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--text-primary)',
              cursor: 'pointer',
            }}
          >
            <span aria-hidden="true">🏢</span>
            Continue with {name} SSO
          </button>

          <p
            style={{
              textAlign: 'center',
              marginTop: 'var(--space-5)',
              fontSize: 'var(--text-sm)',
              color: 'var(--text-tertiary)',
            }}
          >
            New here?{' '}
            <a data-nav="signup" href="#" style={{ color: 'var(--accent-color)' }}>
              Create a {name} account
            </a>
          </p>

          {rejection && (
            <Alert
              tone="error"
              data-state={isCrossPortalRejection ? 'cross-portal-reject' : 'login-error'}
              style={{ marginTop: 'var(--space-5)' }}
            >
              <p style={{ margin: isCrossPortalRejection ? '0 0 var(--space-3)' : 0 }}>
                <b>{rejection.message}</b>
              </p>
              {isCrossPortalRejection && (
                <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                  <Button type="button" size="sm" data-action="retry-login" onClick={resetRejection}>
                    Use a different account
                  </Button>
                  <Button type="button" size="sm" variant="ghost" data-action="go-home-portal">
                    Go to my portal
                  </Button>
                </div>
              )}
            </Alert>
          )}
        </form>
      </section>
    </div>
  )
}
