import { MasterAdminPortalsFlow } from '@fuzefront/portal-admin-ui'
import { useFlag } from '../platform/featureFlags'
import { getActiveAuthToken } from '../lib/accounts'

/**
 * Feature-flag gate for the master-admin portal fleet console
 * (`fuzefront.platform.multi-tenant-portals`, release flag, default OFF).
 *
 * This reuses the SAME master switch `Layout.tsx`/`App.tsx` already gate the
 * rest of the multi-tenant-portals surface behind, rather than minting a new
 * flag for this route — the fleet console has nothing to manage while the
 * platform-wide capability itself is off. Matches `design/frames/
 * portal-admin-consoles/manifest.json`'s declared `featureFlag` for the
 * `master-admin-portals` build flow.
 */
function useMasterAdminPortalsFlag(): boolean {
  return useFlag('fuzefront.platform.multi-tenant-portals', false)
}

/**
 * `/admin/portals` — the master-admin portal fleet console (FF-EPIC-14-S2).
 * Flag OFF (default): the route stays registered (never 404s mid-rollout)
 * but renders nothing of the surface, matching AccountSecurityPage's
 * convention. Access control for who may actually SEE the fleet (platform
 * admin only) is enforced by the flow itself via the real API's 403 —
 * this flag only controls whether the route ships at all.
 */
export default function MasterAdminPortalsPage() {
  const enabled = useMasterAdminPortalsFlag()

  if (!enabled) {
    return (
      <div style={{ padding: 'var(--space-8)', color: 'var(--text-secondary)' }}>
        This area isn’t available yet.
      </div>
    )
  }

  return (
    <div style={{ padding: 'var(--space-8)' }}>
      <MasterAdminPortalsFlow getToken={getActiveAuthToken} />
    </div>
  )
}
