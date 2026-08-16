import { EmptyState } from '@fuzefront/design-system';
import { useBillingI18n } from '../../i18n';

/**
 * `fuzefront.billing.reseller-connect` OFF (default). Honest placeholder —
 * the Connect/price-book area renders NOTHING functional and the flow makes
 * ZERO calls to the anticipated endpoints (api/portalBillingClient.ts's
 * getConnectStatus/listPriceBook are never invoked while this is shown; see
 * PortalBillingFlow's effect gating). Backend is EPIC-15-S2/S3/S5, pending.
 */
export function ResellerNotEnabledNotice() {
  const { strings } = useBillingI18n();
  return (
    <div data-panel="connect-status" data-state="disabled">
      <EmptyState title={strings.resellerNotEnabledHeading} body={strings.resellerNotEnabledBody} />
    </div>
  );
}
