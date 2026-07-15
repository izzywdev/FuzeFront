import { useMemo, useState } from 'react';
import type { Plan } from '@fuzefront/billing-client';
import { useBillingI18n } from '../i18n';
import { PlanCard } from './PlanCard';

export type BillingInterval = 'month' | 'year';

export interface PlanPickerProps {
  plans: Plan[];
  /** priceId of the entity's current plan, if any. */
  currentPriceId?: string | null;
  /** priceId to highlight as recommended. */
  featuredPriceId?: string | null;
  /** Controlled selection (priceId). */
  selectedPriceId?: string | null;
  onSelect?: (plan: Plan) => void;
  /** Show the monthly/yearly toggle (only when both intervals exist). */
  showIntervalToggle?: boolean;
  disabled?: boolean;
}

/**
 * Plan catalogue with an optional monthly/yearly interval toggle. Plans are
 * sorted by their `sortOrder` and filtered to the active interval. Purely
 * presentational over the contract `Plan[]` — fetching is the caller's job.
 */
export function PlanPicker({
  plans,
  currentPriceId,
  featuredPriceId,
  selectedPriceId,
  onSelect,
  showIntervalToggle = true,
  disabled,
}: PlanPickerProps) {
  const { strings } = useBillingI18n();

  const intervals = useMemo(
    () => new Set(plans.map((p) => p.billingInterval)),
    [plans],
  );
  const hasBothIntervals = intervals.has('month') && intervals.has('year');
  const [interval, setInterval] = useState<BillingInterval>('month');

  const visiblePlans = useMemo(() => {
    const active = plans.filter((p) => p.isActive !== false);
    const scoped =
      showIntervalToggle && hasBothIntervals
        ? active.filter((p) => p.billingInterval === interval)
        : active;
    return [...scoped].sort((a, b) => a.sortOrder - b.sortOrder);
  }, [plans, interval, hasBothIntervals, showIntervalToggle]);

  return (
    <div className="ffb-plans">
      <div className="ffb-plans__head">
        <h2 className="ffb-plans__title">{strings.plansHeading}</h2>
        <p className="ffb-plans__subtitle">{strings.plansSubheading}</p>

        {showIntervalToggle && hasBothIntervals && (
          <div
            className="ffb-plans__interval"
            role="group"
            aria-label={strings.plansHeading}
          >
            <button
              type="button"
              className="ffb-plans__interval-btn"
              aria-pressed={interval === 'month'}
              onClick={() => setInterval('month')}
            >
              {strings.intervalMonthly}
            </button>
            <button
              type="button"
              className="ffb-plans__interval-btn"
              aria-pressed={interval === 'year'}
              onClick={() => setInterval('year')}
            >
              {strings.intervalYearly}
            </button>
          </div>
        )}
      </div>

      <div className="ffb-plans__grid">
        {visiblePlans.map((plan) => (
          <PlanCard
            key={plan.priceId}
            plan={plan}
            current={plan.priceId === currentPriceId}
            featured={plan.priceId === featuredPriceId}
            selected={plan.priceId === selectedPriceId}
            onSelect={onSelect}
            disabled={disabled}
          />
        ))}
      </div>
    </div>
  );
}
