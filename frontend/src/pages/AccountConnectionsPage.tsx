import { useCallback, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ConnectedAccountsPanel, type SocialProvider } from '@fuzefront/account-security-ui'
import { useFlag } from '../platform/featureFlags'
import { getActiveAuthToken } from '../lib/accounts'

/**
 * Same feature-flag gate as the hub (`fuzefront.account-security.hub`,
 * default OFF) — the connections page is a sibling surface of the hub it's
 * reached from, so it ships/rolls out together. See AccountSecurityPage.tsx.
 */
function useAccountSecurityHubFlag(): boolean {
  return useFlag('fuzefront.account-security.hub', false)
}

/** The only provider slug the Security contract currently supports. */
function asSocialProvider(value: string | null): SocialProvider | null {
  return value === 'google' ? value : null
}

/**
 * Host route wrapper for `/account/security/connections` (FFRNT-296). Mounts
 * the design-system-first @fuzefront/account-security-ui
 * `ConnectedAccountsPanel`, wiring host navigation + the same-origin bearer
 * token, and translates the social-link handshake's `?linked=` / `?error=`
 * return query params into the panel's props. The panel itself owns every
 * load/error/connect/guard state.
 */
export default function AccountConnectionsPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const enabled = useAccountSecurityHubFlag()

  const linkedProvider = useMemo(
    () => asSocialProvider(searchParams.get('linked')),
    [searchParams]
  )
  const errorProvider = useMemo(
    () => asSocialProvider(searchParams.get('error')),
    [searchParams]
  )

  const onNavigate = useCallback(
    (route: string) => {
      navigate(route)
    },
    [navigate]
  )

  const getToken = useCallback(() => getActiveAuthToken(), [])

  // Flag OFF (default): the surface is not exposed. A null render keeps the
  // route registered without shipping the surface until rollout.
  if (!enabled) {
    return (
      <div style={{ padding: 'var(--space-8)', color: 'var(--text-secondary)' }}>
        This area isn’t available yet.
      </div>
    )
  }

  return (
    <div style={{ padding: 'var(--space-8)' }}>
      <ConnectedAccountsPanel
        getToken={getToken}
        onNavigate={onNavigate}
        onSetPassword={() => navigate('/account/security/password')}
        linkedProvider={linkedProvider}
        errorProvider={errorProvider}
      />
    </div>
  )
}
