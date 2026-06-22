import type { BillingSubscription, SubscriptionStatus } from '@fuzefront/billing-client'
import { Card, Button, StatusPill } from '@fuzefront/design-system'
import { useI18n } from '@fuzefront/i18n'
import { formatDate } from '../format'

export interface SubscriptionManagerProps {
  subscription: BillingSubscription
  onChangePlan?: () => void
  onCancel?: () => void
  /** Disables actions while a mutation is in flight. */
  busy?: boolean
}

/** Maps Stripe subscription status to the DS StatusPill health buckets. */
function pillStatus(status: SubscriptionStatus): 'online' | 'degraded' | 'offline' {
  if (status === 'active' || status === 'trialing') return 'online'
  if (status === 'past_due' || status === 'unpaid' || status === 'incomplete') return 'degraded'
  return 'offline'
}

/**
 * Current-subscription panel with change-plan / cancel actions. Design-system-
 * first (Card + Button + StatusPill, tokens only). RTL-safe via logical
 * properties; the seam Card edge marks the active subscription surface.
 */
export function SubscriptionManager({
  subscription,
  onChangePlan,
  onCancel,
  busy = false,
}: SubscriptionManagerProps) {
  const { t, language } = useI18n()
  const { status, planTier, seatQuantity, cancelAtPeriodEnd, currentPeriodEnd } = subscription

  return (
    <Card seam style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--space-2)',
        }}
      >
        <h3
          style={{
            margin: 0,
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--text-lg)',
            fontWeight: 'var(--weight-semibold)',
            color: 'var(--text-primary)',
            textTransform: 'capitalize',
          }}
        >
          {planTier}
        </h3>
        <StatusPill status={pillStatus(status)} label={status} />
      </div>

      <dl style={{ margin: 0, display: 'grid', gap: 'var(--space-2)' }}>
        {seatQuantity > 1 && (
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <dt style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>
              {t('billing.subscription.seats', { count: seatQuantity })}
            </dt>
          </div>
        )}
        {currentPeriodEnd && (
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
            {cancelAtPeriodEnd
              ? t('billing.subscription.endsOn', { date: formatDate(currentPeriodEnd, language) })
              : t('billing.subscription.renews', { date: formatDate(currentPeriodEnd, language) })}
          </div>
        )}
      </dl>

      <div style={{ display: 'flex', gap: 'var(--space-3)', marginBlockStart: 'var(--space-2)' }}>
        <Button variant="secondary" disabled={busy} onClick={onChangePlan}>
          {t('billing.subscription.changePlan')}
        </Button>
        {cancelAtPeriodEnd ? (
          <Button variant="ghost" disabled>
            {t('billing.subscription.canceling')}
          </Button>
        ) : (
          <Button variant="danger" disabled={busy} onClick={onCancel}>
            {t('billing.subscription.cancel')}
          </Button>
        )}
      </div>
    </Card>
  )
}
