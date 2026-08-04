import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { AccountSecurityHub } from '@fuzeone/account-security-ui'
import { useFlag } from '../platform/featureFlags'
import { getActiveAuthToken } from '../lib/accounts'

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
 * @fuzeone/account-security-ui hub, wiring host navigation + the same-origin
 * bearer token. The hub itself owns all load/error/guard states.
 */
export default function AccountSecurityPage() {
  const navigate = useNavigate()
  const enabled = useAccountSecurityHubFlag()

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
      <AccountSecurityHub
        getToken={getToken}
        onNavigate={onNavigate}
        onSetPassword={() => navigate('/account/security/password')}
      />
    </div>
  )
}
