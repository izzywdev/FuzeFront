import { useBillingI18n } from '../i18n';
import { Button } from './primitives';

/** Minimal card summary the caller resolves (Stripe never sends the PAN). */
export interface CardSummary {
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  isDefault?: boolean;
}

export interface PaymentMethodPanelProps {
  /** The card on file, or null when none is saved. */
  card?: CardSummary | null;
  /**
   * Open the add/update flow. The caller is expected to create a SetupIntent
   * (billing-client.createSetupIntent) and present a CheckoutModal in 'setup'
   * mode with the returned clientSecret.
   */
  onManage?: () => void;
  busy?: boolean;
}

/**
 * Payment-method summary + manage action. Pure display over a CardSummary the
 * caller resolves; collecting/saving a card is delegated to CheckoutModal in
 * setup mode (Stripe Payment Element), so no card data lives here.
 */
export function PaymentMethodPanel({ card, onManage, busy }: PaymentMethodPanelProps) {
  const { strings } = useBillingI18n();

  return (
    <section className="ffb-panel" aria-labelledby="ffb-pm-title">
      <div className="ffb-panel__header">
        <h3 id="ffb-pm-title" className="ffb-panel__title">
          {strings.paymentMethodHeading}
        </h3>
      </div>

      {card ? (
        <div className="ffb-pm">
          <span className="ffb-pm__brand">{card.brand}</span>
          <span className="ffb-pm__digits">
            {strings.cardEndingIn} {card.last4}
          </span>
          <span className="ffb-pm__exp">
            {strings.expiresLabel} {String(card.expMonth).padStart(2, '0')}/{card.expYear}
          </span>
        </div>
      ) : (
        <p className="ffb-panel__empty">{strings.noPaymentMethod}</p>
      )}

      {onManage && (
        <div className="ffb-panel__actions">
          <Button variant="secondary" onClick={onManage} disabled={busy}>
            {card ? strings.updatePaymentMethod : strings.addPaymentMethod}
          </Button>
        </div>
      )}
    </section>
  );
}
