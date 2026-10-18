import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { AccountSecurityHub, SecurityStatusMobileFlow } from '@fuzefront/account-security-ui'
import { useFlag } from '../platform/featureFlags'
import { getActiveAuthToken } from '../lib/accounts'
import { ACCOUNT_SECURITY_FLAGS } from '../components/account-security/FlaggedSurface'
import { useCompactViewport } from '../lib/compactViewport'

/**
 * Feature-flag gate for the account-security hub
 * (`fuzefront.account-security.hub`, default OFF).
 *
 * Reads the per-user evaluation served by the backend (`GET /api/flags`), which
 * resolves the flag through Unleash against the authenticated session — so the
 * `developers` segment actually applies. This previously read the build-time
 * constant `import.meta.env.VITE_FF_ACCOUNT_SECURITY_HUB`, which was baked at
 * build time and identical for every user, making per-user targeting impossible.
 * Key and default are unchanged.
 */
function useAccountSecurityHubFlag(): boolean {
  return useFlag('fuzefront.account-security.hub', false)
}

/**
 * Host route wrapper for `/account/security`. Mounts the design-system-first
 * @fuzefront/account-security-ui hub, wiring host navigation + the same-origin
 * bearer token. The hub itself owns all load/error/guard states.
 */
export default function AccountSecurityPage() {
  const navigate = useNavigate()
  const enabled = useAccountSecurityHubFlag()
  // FFRNT-141 / FFRNT-362 — both default OFF. Flag OFF = the hub exactly as before.
  const mfaManagement = useFlag(ACCOUNT_SECURITY_FLAGS.mfaManagement, false)
  const mfaStepUpMobile = useFlag(ACCOUNT_SECURITY_FLAGS.mfaStepUpMobile, false)
  const compact = useCompactViewport()

  const onNavigate = useCallback(
    (route: string) => {
      navigate(route)
    },
    [navigate]
  )

  const getToken = useCallback(() => getActiveAuthToken(), [])

  // Flag OFF (default): the hub is not exposed. A null render keeps the route
  // registered without shipping the surface until rollout.
  if (!enabled) {
    return (
      <div style={{ padding: 'var(--space-8)', color: 'var(--text-secondary)' }}>
        This area isn’t available yet.
      </div>
    )
  }

  return (
    <div style={{ padding: 'var(--space-8)' }}>
      {/* Mobile combined 2FA + contact-verification status — additive to the hub,
          small screens only, behind fuzefront.security.mfa-stepup-mobile. */}
      {mfaStepUpMobile && compact && (
        <div style={{ marginBottom: 'var(--space-6)' }}>
          <SecurityStatusMobileFlow getToken={getToken} onNavigate={onNavigate} />
        </div>
      )}
      <AccountSecurityHub
        getToken={getToken}
        onNavigate={onNavigate}
        onSetPassword={() => navigate('/account/security/password')}
        routes={mfaManagement ? { twoFactor: '/account/security/mfa' } : undefined}
      />
    </div>
  )
}
