import type { BillingSubscription, Plan } from '@fuzefront/billing-client';
import { useBillingI18n } from '../../i18n';
import type { ConnectStatus, PriceBookEntry } from '../../api/portalBillingClient';
import { PlatformSubscriptionCard, type PlatformSubscriptionLoadState } from './PlatformSubscriptionCard';
import { ConnectOnboardingCard, type ConnectLoadState } from './ConnectOnboardingCard';
import { PriceBookTable, type PriceBookLoadState } from './PriceBookTable';
import { ResellerNotEnabledNotice } from './ResellerNotEnabledNotice';

export interface BillingConsolePanelProps {
  portalName?: string;
  // Platform subscription (real)
  subscriptionLoadState: PlatformSubscriptionLoadState;
  subscription: BillingSubscription | null;
  plan?: Plan;
  manageBusy?: boolean;
  manageError?: string | null;
  onManageSubscription: () => void;
  onViewInvoices?: () => void;
  onRetrySubscription: () => void;
  // Reseller Connect / price book (anticipated, flag-gated)
  resellerConnectEnabled: boolean;
  connectLoadState: ConnectLoadState;
  connectStatus: ConnectStatus | null;
  connectBusy?: boolean;
  onStartOnboarding: () => void;
  onContinueOnboarding: () => void;
  onReonboard: () => void;
  onOpenConnectDashboard?: () => void;
  onRetryConnect: () => void;
  priceBookLoadState: PriceBookLoadState;
  prices: PriceBookEntry[];
  onAddPrice: () => void;
  onEditPrice?: (id: string) => void;
  onRetryPriceBook: () => void;
}

/**
 * Composes the three sections of the portal-billing console
 * (design/frames/portal-admin-consoles/08-billing.html): the reseller
 * Connect status, the price book, and the portal's own platform
 * subscription. Pure presentation — all data/state comes from
 * `PortalBillingFlow`.
 */
export function BillingConsolePanel(props: BillingConsolePanelProps) {
  const { strings } = useBillingI18n();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      {props.portalName && <h1 style={{ margin: 0 }}>{props.portalName} · Console</h1>}
      <p style={{ margin: 0, color: 'var(--text-secondary)', maxWidth: '68ch' }}>{strings.portalBillingIntro}</p>

      {props.resellerConnectEnabled ? (
        <ConnectOnboardingCard
          loadState={props.connectLoadState}
          status={props.connectStatus}
          busy={props.connectBusy}
          onStartOnboarding={props.onStartOnboarding}
          onContinueOnboarding={props.onContinueOnboarding}
          onReonboard={props.onReonboard}
          onOpenDashboard={props.onOpenConnectDashboard}
          onRetry={props.onRetryConnect}
        />
      ) : (
        <ResellerNotEnabledNotice />
      )}

      {props.resellerConnectEnabled && (
        <PriceBookTable
          loadState={props.priceBookLoadState}
          prices={props.prices}
          onAddPrice={props.onAddPrice}
          onEditPrice={props.onEditPrice}
          onRetry={props.onRetryPriceBook}
        />
      )}

      <PlatformSubscriptionCard
        loadState={props.subscriptionLoadState}
        subscription={props.subscription}
        plan={props.plan}
        manageBusy={props.manageBusy}
        manageError={props.manageError}
        onManageSubscription={props.onManageSubscription}
        onViewInvoices={props.onViewInvoices}
        onRetry={props.onRetrySubscription}
      />
    </div>
  );
}
