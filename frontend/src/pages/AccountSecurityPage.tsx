import React, { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { AccountSecurityHub } from '@fuzefront/account-security-ui'

/**
 * Feature-flag gate for the account-security hub
 * (`fuzefront.account-security.hub`, default OFF). The family flag standard is
 * Unleash via `@fuzefront/feature-flags`; until the web flag client is wired
 * into the shell bootstrap this reads a build-time override and defaults OFF, so
 * production behavior is unchanged. Swap the body for
 * `getBoolean('fuzefront.account-security.hub', false)` once the web client is
 * initialized — the flag key and default stay identical.
 */
function useAccountSecurityHubFlag(): boolean {
  return import.meta.env.VITE_FF_ACCOUNT_SECURITY_HUB === 'true'
}

/**
 * Host route wrapper for `/account/security`. Mounts the design-system-first
 * @fuzefront/account-security-ui hub, wiring host navigation + the same-origin
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

  const getToken = useCallback(() => localStorage.getItem('authToken'), [])

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
