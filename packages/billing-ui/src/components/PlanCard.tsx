import type { Plan } from '@fuzefront/billing-client'
import { Card, Button, Badge } from '@fuzefront/design-system'
import { useI18n } from '@fuzefront/i18n'
import { formatMoney } from '../format'

export interface PlanCardProps {
  plan: Plan
  /** Marks this card as the entity's current plan (disables the CTA). */
  current?: boolean
  /** Visually highlight via the fuse seam (e.g. the recommended tier). */
  recommended?: boolean
  /** Called with the plan's stripePriceId when the CTA is pressed. */
  onSelect?: (stripePriceId: string) => void
}

/**
 * A single pricing tier. Design-system-first: built from Card + Button + Badge
 * and CSS-variable tokens only. RTL-safe via logical properties; the CTA
 * carries a visible fuse-seam focus ring (inherited from the DS Button).
 */
export function PlanCard({ plan, current = false, recommended = false, onSelect }: PlanCardProps) {
  const { t, language } = useI18n()

  const interval =
    plan.billingInterval === 'year'
      ? t('billing.plan.perYear')
      : t('billing.plan.perMonth')
  const price =
    plan.unitAmount === 0
      ? t('billing.plan.free')
      : formatMoney(plan.unitAmount, plan.currency, language)

  return (
    <Card
      seam={recommended}
      interactive={!current}
      aria-current={current ? 'true' : undefined}
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}
    >
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
          }}
        >
          {plan.displayName}
        </h3>
        {recommended && <Badge tone="accent">{t('billing.plan.recommended')}</Badge>}
        {current && <Badge>{t('billing.plan.current')}</Badge>}
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)' }}>
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--text-2xl)',
            fontWeight: 'var(--weight-bold)',
            color: 'var(--text-primary)',
          }}
        >
          {price}
        </span>
        {plan.unitAmount > 0 && (
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>
            {interval}
            {plan.seatBased ? ` · ${t('billing.plan.perSeat')}` : ''}
          </span>
        )}
      </div>

      {plan.features.length > 0 && (
        <ul
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-2)',
          }}
        >
          {plan.features.map(feature => (
            <li
              key={feature}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                fontSize: 'var(--text-sm)',
                color: 'var(--text-secondary)',
              }}
            >
              <span aria-hidden="true" style={{ color: 'var(--accent-2)' }}>
                ✓
              </span>
              {feature}
            </li>
          ))}
        </ul>
      )}

      <div style={{ marginBlockStart: 'auto' }}>
        <Button
          variant={recommended ? 'primary' : 'secondary'}
          fullWidth
          disabled={current}
          onClick={() => onSelect?.(plan.stripePriceId)}
        >
          {current ? t('billing.plan.currentCta') : t('billing.plan.select', { plan: plan.displayName })}
        </Button>
      </div>
    </Card>
  )
}
