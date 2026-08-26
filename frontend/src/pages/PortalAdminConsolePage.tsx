import { PortalAdminConsoleFlow } from '@fuzefront/portal-admin-ui'
import { useCurrentUser } from '../lib/shared'
import { useFlag } from '../platform/featureFlags'
import { getActiveAuthToken } from '../lib/accounts'

/**
 * Feature-flag gates for the portal-admin console (FF-EPIC-14-S3), per
 * `design/frames/portal-admin-consoles/manifest.json`'s declared
 * `featureFlag` array for the `portal-console` build flow:
 *   - `fuzefront.identity.portal-scoped-users` — gates the WHOLE console
 *     (portal identity + Users tab depend on portal scoping being live).
 *   - `fuzefront.apps.portal-catalog` — gates the App-catalog TAB only; the
 *     Overview/Users tabs work with it off, so it is passed through to the
 *     flow rather than gating the route.
 */
function usePortalConsoleFlag(): boolean {
  return useFlag('fuzefront.identity.portal-scoped-users', false)
}
function usePortalCatalogFlag(): boolean {
  return useFlag('fuzefront.apps.portal-catalog', false)
}

/**
 * `/portal/admin` — the portal-admin console (FF-EPIC-14-S3). Flag OFF
 * (default): the route stays registered but renders nothing of the surface,
 * matching AccountSecurityPage/MasterAdminPortalsPage's convention.
 */
export default function PortalAdminConsolePage() {
  const enabled = usePortalConsoleFlag()
  const catalogEnabled = usePortalCatalogFlag()
  const { user } = useCurrentUser()

  if (!enabled) {
    return (
      <div style={{ padding: 'var(--space-8)', color: 'var(--text-secondary)' }}>
        This area isn’t available yet.
      </div>
    )
  }

  return (
    <div style={{ padding: 'var(--space-8)' }}>
      <PortalAdminConsoleFlow getToken={getActiveAuthToken} currentUserId={user?.id} catalogEnabled={catalogEnabled} />
    </div>
  )
}
