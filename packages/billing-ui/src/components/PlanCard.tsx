import type { Plan } from '@fuzefront/billing-client';
import { useBillingI18n } from '../i18n';
import { Button, CheckIcon } from './primitives';

export interface PlanCardProps {
  plan: Plan;
  /** Marks this plan as the entity's current subscription. */
  current?: boolean;
  /** Visually highlight as the recommended plan (fuse-seam treatment). */
  featured?: boolean;
  /** Currently selected in the picker (controls button affordance). */
  selected?: boolean;
  onSelect?: (plan: Plan) => void;
  disabled?: boolean;
}

/**
 * A single plan in the picker. Free plans (unitAmount 0) render "Free"; paid
 * plans render the localized currency + interval suffix. The seam strip + badge
 * carry the brand treatment for the featured/current plan.
 */
export function PlanCard({
  plan,
  current,
  featured,
  selected,
  onSelect,
  disabled,
}: PlanCardProps) {
  const { strings, formatCurrency } = useBillingI18n();

  const isFree = plan.unitAmount === 0;
  const intervalSuffix =
    plan.billingInterval === 'year' ? strings.perYear : strings.perMonth;

  const classes = [
    'ffb-plan-card',
    featured ? 'ffb-plan-card--featured' : '',
    current ? 'ffb-plan-card--current' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const headingId = `ffb-plan-${plan.priceId}`;

  return (
    <section className={classes} aria-labelledby={headingId}>
      {featured && <span className="ffb-plan-card__seam" aria-hidden="true" />}
      {current ? (
        <span className="ffb-plan-card__badge ffb-plan-card__badge--current">
          {strings.currentPlanBadge}
        </span>
      ) : featured ? (
        <span className="ffb-plan-card__badge">{strings.mostPopularBadge}</span>
      ) : null}

      <h3 id={headingId} className="ffb-plan-card__name">
        {plan.displayName}
      </h3>

      <div className="ffb-plan-card__price">
        {isFree ? (
          <span className="ffb-plan-card__amount">{strings.freeLabel}</span>
        ) : (
          <>
            <span className="ffb-plan-card__amount">
              {formatCurrency(plan.unitAmount, plan.currency)}
            </span>
            <span className="ffb-plan-card__interval">
              {intervalSuffix}
              {plan.seatBased ? ` · ${strings.seatsLabel}` : ''}
            </span>
          </>
        )}
      </div>

      {plan.features.length > 0 && (
        <ul className="ffb-plan-card__features" aria-label={strings.featuresHeading}>
          {plan.features.map((feature) => (
            <li key={feature} className="ffb-plan-card__feature">
              <CheckIcon />
              <span>{feature}</span>
            </li>
          ))}
        </ul>
      )}

      <Button
        variant={featured ? 'primary' : 'secondary'}
        block
        disabled={disabled || current}
        aria-pressed={selected}
        onClick={() => onSelect?.(plan)}
      >
        {current ? strings.currentPlanBadge : selected ? strings.selectedPlan : strings.selectPlan}
      </Button>
    </section>
  );
}
