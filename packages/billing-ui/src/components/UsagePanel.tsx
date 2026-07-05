import { useBillingI18n } from '../i18n';

export interface UsagePanelProps {
  /**
   * Customer balance in minor units (cents) as Stripe reports it: negative
   * means credit on the account, positive means amount owed. Optional — when
   * undefined the credit metric is hidden.
   */
  customerBalance?: number | null;
  /** Currency for the balance display. */
  currency?: string;
  /** Seats currently consumed against a seat-based plan. */
  seatsInUse?: number | null;
  /** Total seats provisioned, for an "x of y" readout. */
  seatsTotal?: number | null;
}

/**
 * Read-only usage & credits summary. The billing contract exposes credits only
 * as an admin write (POST /credits → endingBalance); this panel renders the
 * balance the caller already holds (e.g. from the subscription/customer read)
 * and degrades to an empty state when no usage data is available.
 */
export function UsagePanel({
  customerBalance,
  currency = 'usd',
  seatsInUse,
  seatsTotal,
}: UsagePanelProps) {
  const { strings, formatCurrency } = useBillingI18n();

  const hasCredit = typeof customerBalance === 'number';
  // Stripe convention: negative customer balance is available credit.
  const creditMinor = hasCredit ? Math.max(0, -(customerBalance as number)) : 0;
  const hasSeats = typeof seatsInUse === 'number';
  const hasAny = hasCredit || hasSeats;

  return (
    <section className="ffb-panel" aria-labelledby="ffb-usage-title">
      <div className="ffb-panel__header">
        <h3 id="ffb-usage-title" className="ffb-panel__title">
          {strings.usageHeading}
        </h3>
      </div>

      {!hasAny && <p className="ffb-panel__empty">{strings.noUsageData}</p>}

      {hasCredit && (
        <div className="ffb-metric ffb-metric--credit">
          <span className="ffb-metric__value">{formatCurrency(creditMinor, currency)}</span>
          <span className="ffb-metric__label">{strings.creditsLabel}</span>
        </div>
      )}

      {hasSeats && (
        <div className="ffb-metric">
          <span className="ffb-metric__value">
            {seatsInUse}
            {typeof seatsTotal === 'number' ? ` / ${seatsTotal}` : ''}
          </span>
          <span className="ffb-metric__label">{strings.seatsInUse}</span>
        </div>
      )}
    </section>
  );
}
