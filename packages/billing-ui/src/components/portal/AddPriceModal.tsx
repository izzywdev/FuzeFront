import { useId, useState } from 'react';
import { Alert, Button, Input, Modal, Select } from '@fuzefront/design-system';
import { useBillingI18n } from '../../i18n';
import type { CreatePriceInput } from '../../api/portalBillingClient';

export interface AddPriceModalProps {
  open: boolean;
  onClose: () => void;
  /** Fail-closed gate (09-portal-states i10): a price cannot be published
   * while Stripe has not enabled charges on the account. */
  chargesEnabled: boolean;
  busy?: boolean;
  error?: string | null;
  onSubmit: (input: CreatePriceInput) => void;
}

const CURRENCIES = [
  { value: 'usd', label: 'USD' },
  { value: 'eur', label: 'EUR' },
  { value: 'gbp', label: 'GBP' },
];

/**
 * Add-a-price dialog. When `chargesEnabled` is false this renders ONLY the
 * fail-closed notice from 09-portal-states (i10) — no form, a disabled
 * "Publish price" — matching "creating a price is fail-closed on
 * charges_enabled=false". When true, a minimal price form posts to the
 * anticipated `POST /api/v1/portal/price-book` (FF-EPIC-15-S3).
 */
export function AddPriceModal({ open, onClose, chargesEnabled, busy, error, onSubmit }: AddPriceModalProps) {
  const { strings } = useBillingI18n();
  const formId = useId();
  const [planName, setPlanName] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('usd');
  const [interval, setInterval] = useState<'month' | 'year'>('month');

  if (!chargesEnabled) {
    return (
      <Modal open={open} onClose={onClose} title={strings.addPriceModalHeading}>
        <div data-panel="add-price" data-state="charges-disabled">
          <Alert tone="warning" title={strings.chargesNotEnabledTitle} data-error-code="CHARGES_NOT_ENABLED">
            {strings.chargesNotEnabledBody}
          </Alert>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)', marginTop: 'var(--space-5)' }}>
            <Button variant="secondary" onClick={onClose} data-action="cancel">
              {strings.cancelLabel}
            </Button>
            <Button variant="primary" disabled data-action="submit-price">
              {strings.publishPriceAction}
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  const amountCents = Math.round(Number(amount) * 100);
  const canSubmit = planName.trim().length > 0 && Number.isFinite(amountCents) && amountCents > 0;

  return (
    <Modal open={open} onClose={onClose} title={strings.addPriceModalHeading}>
      <form
        id={formId}
        data-panel="add-price"
        onSubmit={(e) => {
          e.preventDefault();
          if (!canSubmit || busy) return;
          onSubmit({ planName: planName.trim(), amountCents, currency, interval });
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}
      >
        {error && (
          <Alert tone="error" role="alert">
            {error}
          </Alert>
        )}
        <Input
          label={strings.priceNameLabel}
          value={planName}
          onChange={(e) => setPlanName(e.target.value)}
          data-input="price-name"
          required
        />
        <Input
          label={strings.priceAmountLabel}
          type="number"
          min="0"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          data-input="price-amount"
          required
        />
        <Select
          label={strings.priceCurrencyLabel}
          options={CURRENCIES}
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          data-input="price-currency"
        />
        <Select
          label={strings.priceIntervalLabel}
          options={[
            { value: 'month', label: strings.intervalMonth },
            { value: 'year', label: strings.intervalYear },
          ]}
          value={interval}
          onChange={(e) => setInterval(e.target.value as 'month' | 'year')}
          data-input="price-interval"
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy} data-action="cancel">
            {strings.cancelLabel}
          </Button>
          <Button type="submit" variant="primary" disabled={!canSubmit || busy} data-action="submit-price">
            {strings.publishPriceAction}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
