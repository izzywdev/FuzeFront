import type { CSSProperties } from 'react';
import type { BillingSubscription, Plan } from '@fuzefront/billing-client';
import { Alert, Button, EmptyState, Skeleton, StatusPill, type StatusPillStatus } from '@fuzefront/design-system';
import { useBillingI18n } from '../../i18n';
import type { BillingStrings } from '../../i18n';

export type PlatformSubscriptionLoadState = 'loading' | 'ready' | 'error';

export interface PlatformSubscriptionCardProps {
  loadState: PlatformSubscriptionLoadState;
  subscription: BillingSubscription | null;
  /** The subscription's matched plan (by `priceId`), for name/amount display. */
  plan?: Plan;
  manageBusy?: boolean;
  manageError?: string | null;
  onManageSubscription: () => void;
  onViewInvoices?: () => void;
  onRetry: () => void;
}

const DEFS: CSSProperties = {
  margin: 0,
  display: 'grid',
  gridTemplateColumns: 'max-content 1fr',
  columnGap: 'var(--space-4)',
  rowGap: 'var(--space-2)',
};
const DT: CSSProperties = { color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' };
const DD: CSSProperties = { margin: 0, color: 'var(--text-primary)' };

/** Maps a billing subscription status onto the design-system StatusPill's
 * fixed vocabulary (which does not carry Stripe subscription statuses
 * natively) with an explicit label override — extension via the documented
 * `label` prop, never a fork of the primitive. */
function subscriptionPill(
  status: BillingSubscription['status'],
  strings: BillingStrings,
): { status: StatusPillStatus; label: string } {
  switch (status) {
    case 'active':
      return { status: 'active', label: strings.statusActive };
    case 'trialing':
      return { status: 'pending', label: strings.statusTrialing };
    case 'past_due':
      return { status: 'degraded', label: strings.statusPastDue };
    case 'unpaid':
      return { status: 'suspended', label: strings.statusUnpaid };
    case 'canceled':
      return { status: 'disabled', label: strings.statusCanceled };
    default:
      return { status: 'pending', label: strings.statusIncomplete };
  }
}

/**
 * "Your FuzeFront subscription" — the portal's own platform subscription
 * (design/frames/portal-admin-consoles 08-billing). REAL data: wired to
 * `@fuzefront/billing-client`'s subscription/plan contract via
 * `api/portalBillingClient.ts` (GET /plans, GET /subscriptions, POST
 * /portal — see that file's header comment for the exact endpoint shapes).
 */
export function PlatformSubscriptionCard({
  loadState,
  subscription,
  plan,
  manageBusy,
  manageError,
  onManageSubscription,
  onViewInvoices,
  onRetry,
}: PlatformSubscriptionCardProps) {
  const { strings, formatCurrency, formatDate } = useBillingI18n();

  return (
    <section
      data-panel="platform-subscription"
      data-state={loadState === 'loading' ? 'loading' : loadState === 'error' ? 'error' : undefined}
      aria-busy={loadState === 'loading' || undefined}
      aria-label={strings.platformSubscriptionHeading}
    >
      <div style={{ marginBlockEnd: 'var(--space-4)' }}>
        <h2 style={{ margin: 0 }}>{strings.platformSubscriptionHeading}</h2>
        <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{strings.platformSubscriptionSub}</p>
      </div>

      {loadState === 'loading' && (
        <div aria-hidden="true" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <Skeleton width="40%" />
          <Skeleton width="55%" />
          <Skeleton width="35%" />
        </div>
      )}

      {loadState === 'error' && (
        <>
          <Alert tone="error" title={strings.platformSubscriptionErrorHeading} role="alert" data-error-code="LOAD_FAILED">
            {strings.platformSubscriptionErrorBody}
          </Alert>
          <div style={{ marginTop: 'var(--space-4)' }}>
            <Button variant="secondary" onClick={onRetry} data-action="retry">
              {strings.retry}
            </Button>
          </div>
        </>
      )}

      {loadState === 'ready' && !subscription && (
        <EmptyState title={strings.noPlatformSubscriptionHeading} body={strings.noPlatformSubscriptionBody} />
      )}

      {loadState === 'ready' && subscription && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          <dl style={DEFS}>
            <dt style={DT}>{strings.planLabel}</dt>
            <dd style={DD} data-plan={plan?.tierName}>
              {plan?.displayName ?? subscription.planTier}
            </dd>
            <dt style={DT}>{strings.statusLabel}</dt>
            <dd style={DD}>
              {(() => {
                const p = subscriptionPill(subscription.status, strings);
                return (
                  <span data-subscription-status={subscription.status}>
                    <StatusPill status={p.status} label={p.label} />
                  </span>
                );
              })()}
            </dd>
            {subscription.currentPeriodEnd && (
              <>
                <dt style={DT}>{subscription.cancelAtPeriodEnd ? strings.endsOn : strings.renewsOn}</dt>
                <dd style={DD}>{formatDate(subscription.currentPeriodEnd)}</dd>
              </>
            )}
            {plan && (
              <>
                <dt style={DT}>{strings.amountLabel}</dt>
                <dd style={{ ...DD, fontFamily: 'var(--font-mono)' }}>
                  {formatCurrency(plan.unitAmount, plan.currency)}
                  {plan.billingInterval ? ` / ${plan.billingInterval === 'year' ? strings.perYear : strings.perMonth}` : ''}
                </dd>
              </>
            )}
          </dl>

          {manageError && (
            <Alert tone="error" role="alert">
              {manageError}
            </Alert>
          )}

          <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <Button variant="secondary" onClick={onManageSubscription} disabled={manageBusy} data-action="manage-subscription">
              {strings.manageSubscriptionAction}
            </Button>
            {onViewInvoices && (
              <Button variant="ghost" onClick={onViewInvoices} data-action="view-invoices">
                {strings.viewInvoicesAction}
              </Button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
