import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { PortalBillingFlow } from '@fuzefront/billing-ui'
// The billing-ui stylesheet (design-system tokens only). Imported from source
// here because the frontend build resolves @fuzefront/billing-ui from source
// (see frontend/vite.config.ts) and the published `./styles.css` subpath is not
// aliased for dev — same reasoning as BillingPage.tsx's import of this file.
import '../../../packages/billing-ui/src/styles/billing-ui.css'
import { useOrganizations } from '../lib/shared'
import { useFlag } from '../platform/featureFlags'
import { getActiveAuthToken } from '../lib/accounts'

/**
 * Gate for the reseller Connect / price-book section
 * (`fuzefront.billing.reseller-connect`, release flag, default OFF).
 *
 * Reads the per-user evaluation served by the backend (`GET /api/flags`),
 * matching AccountSecurityPage/BillingPage/PortalsDirectory's convention.
 *
 * This does NOT gate the whole page: the "Your FuzeFront subscription"
 * section is REAL and always renders once the caller is authorized — only
 * the Stripe Connect onboarding + price book area (FF-EPIC-15, not built
 * yet) is behind this flag. See PortalBillingFlow's doc comment.
 */
function useResellerConnectFlag(): boolean {
  return useFlag('fuzefront.billing.reseller-connect', false)
}

/**
 * Host route wrapper for `/portal/admin/billing`
 * (design/frames/portal-admin-consoles, flow `portal-billing`, FF-EPIC-14-S4).
 *
 * A portal IS an organization (see that manifest's model-reconciliation
 * note: "a portal is an ORG that is a direct child of the platform root") —
 * so the portal's own platform subscription is scoped by the ACTIVE
 * organization context, exactly like the org BillingPage. The flow itself
 * owns the fail-closed access-denied state: a caller without 'read'
 * authority on the active org's billing gets a REAL 403 from the platform-
 * subscription load, which PortalBillingFlow renders in place rather than
 * this wrapper trying to pre-compute authorization.
 */
export default function PortalBillingPage() {
  const navigate = useNavigate()
  const { activeOrganizationId, activeOrganization } = useOrganizations()
  const resellerConnectEnabled = useResellerConnectFlag()
  const getToken = useCallback(() => getActiveAuthToken(), [])

  return (
    <div style={{ padding: 'var(--space-8)' }}>
      <PortalBillingFlow
        organizationId={activeOrganizationId}
        portalName={activeOrganization?.name}
        resellerConnectEnabled={resellerConnectEnabled}
        getToken={getToken}
        onViewInvoices={() => navigate('/billing/invoices')}
      />
    </div>
  )
}
