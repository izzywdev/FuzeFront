import { useState } from 'react';
import type { BillingSubscription } from '@fuzefront/billing-client';
import { useBillingI18n } from '../i18n';
import { Button, Notice, StatusPill } from './primitives';
import { Modal } from './Modal';

export interface SubscriptionManagerProps {
  /** The entity's current subscription mirror, or null when none exists. */
  subscription: BillingSubscription | null;
  /** Display name of the active plan (resolve from the catalogue by priceId). */
  planName?: string;
  onChangePlan?: () => void;
  onCancel?: () => Promise<void> | void;
  onResume?: () => Promise<void> | void;
  /** Render the empty-state CTA when there is no subscription. */
  onPickPlan?: () => void;
  busy?: boolean;
}

/**
 * Current-plan summary with status, trial/renewal dates, and change/cancel
 * controls. Cancellation routes through a confirmation dialog. All dates and
 * status labels are localized; nothing is hard-coded.
 */
export function SubscriptionManager({
  subscription,
  planName,
  onChangePlan,
  onCancel,
  onResume,
  onPickPlan,
  busy,
}: SubscriptionManagerProps) {
  const { strings, formatDate } = useBillingI18n();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!subscription) {
    return (
      <section className="ffb-panel" aria-labelledby="ffb-sub-empty">
        <div className="ffb-panel__header">
          <h3 id="ffb-sub-empty" className="ffb-panel__title">
            {strings.noSubscriptionHeading}
          </h3>
        </div>
        <p className="ffb-panel__empty">{strings.noSubscriptionBody}</p>
        {onPickPlan && (
          <div className="ffb-panel__actions">
            <Button variant="primary" onClick={onPickPlan}>
              {strings.changePlan}
            </Button>
          </div>
        )}
      </section>
    );
  }

  const { status, trialEnd, currentPeriodEnd, cancelAtPeriodEnd } = subscription;
  const isTrialing = status === 'trialing';

  const runCancel = async () => {
    setError(null);
    try {
      await onCancel?.();
      setConfirmOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : strings.errorPrefix);
    }
  };

  const runResume = async () => {
    setError(null);
    try {
      await onResume?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : strings.errorPrefix);
    }
  };

  return (
    <section className="ffb-panel" aria-labelledby="ffb-sub-title">
      <div className="ffb-panel__header">
        <h3 id="ffb-sub-title" className="ffb-panel__title">
          {strings.subscriptionHeading}
        </h3>
        <StatusPill status={status} strings={strings} />
      </div>

      <div className="ffb-panel__row">
        <span className="ffb-panel__key">{planName ?? strings.subscriptionHeading}</span>
        {subscription.seatQuantity > 1 && (
          <span className="ffb-panel__value">
            {subscription.seatQuantity} × {strings.seatsLabel}
          </span>
        )}
      </div>

      {isTrialing && trialEnd && (
        <div className="ffb-panel__row">
          <span className="ffb-panel__key">{strings.trialEndsOn}</span>
          <span className="ffb-panel__value">{formatDate(trialEnd)}</span>
        </div>
      )}

      {currentPeriodEnd && (
        <div className="ffb-panel__row">
          <span className="ffb-panel__key">
            {cancelAtPeriodEnd ? strings.endsOn : strings.renewsOn}
          </span>
          <span className="ffb-panel__value">{formatDate(currentPeriodEnd)}</span>
        </div>
      )}

      {cancelAtPeriodEnd && <Notice tone="info">{strings.cancelScheduledNotice}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}

      <div className="ffb-panel__actions">
        {onChangePlan && (
          <Button variant="secondary" onClick={onChangePlan} disabled={busy}>
            {strings.changePlan}
          </Button>
        )}
        {cancelAtPeriodEnd
          ? onResume && (
              <Button variant="primary" onClick={runResume} loading={busy}>
                {strings.resumeSubscription}
              </Button>
            )
          : onCancel && (
              <Button variant="danger" onClick={() => setConfirmOpen(true)} disabled={busy}>
                {strings.cancelSubscription}
              </Button>
            )}
      </div>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={strings.confirmCancelHeading}
        subtitle={strings.confirmCancelBody}
        dismissable={!busy}
      >
        <div className="ffb-panel__actions">
          <Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={busy}>
            {strings.keepSubscription}
          </Button>
          <Button variant="danger" onClick={runCancel} loading={busy}>
            {strings.cancelSubscription}
          </Button>
        </div>
      </Modal>
    </section>
  );
}
