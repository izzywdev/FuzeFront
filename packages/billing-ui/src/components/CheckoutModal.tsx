import { useState, type ReactNode } from 'react';
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from '@stripe/react-stripe-js';
import type { Stripe, StripeElementsOptions } from '@stripe/stripe-js';
import type { Plan } from '@fuzefront/billing-client';
import { useBillingI18n } from '../i18n';
import { Modal } from './Modal';
import { Button, Notice } from './primitives';

export type CheckoutMode = 'payment' | 'setup';

export interface CheckoutModalProps {
  open: boolean;
  onClose: () => void;
  /** Loaded Stripe instance (loadStripe(...)). Provided by the host shell. */
  stripe: Promise<Stripe | null> | Stripe | null;
  /**
   * Stripe client secret driving the Payment Element. For a new subscription
   * this is the PaymentIntent secret from createSubscription; for adding a card
   * it is the SetupIntent secret from createSetupIntent.
   */
  clientSecret: string;
  /** 'payment' confirms a charge; 'setup' saves a card with no charge. */
  mode?: CheckoutMode;
  /** Plan being purchased — shown in the order summary (omit for setup mode). */
  plan?: Plan | null;
  /** When true, render trial messaging instead of a charge. */
  trial?: boolean;
  /** URL Stripe redirects to if a redirect-based method (3DS) is used. */
  returnUrl?: string;
  /** Called once the PaymentIntent/SetupIntent succeeds without redirect. */
  onSuccess?: () => void;
}

/** Stripe Elements appearance bound to the design-system tokens at runtime. */
function dsAppearance(): StripeElementsOptions['appearance'] {
  if (typeof window === 'undefined') return { theme: 'night' };
  const root = document.documentElement;
  const css = getComputedStyle(root);
  const v = (name: string, fallback = '') => css.getPropertyValue(name).trim() || fallback;
  return {
    theme: 'night',
    variables: {
      colorPrimary: v('--accent-color'),
      colorBackground: v('--bg-primary'),
      colorText: v('--text-primary'),
      colorDanger: v('--error-color'),
      fontFamily: v('--font-sans', 'Inter, sans-serif'),
      borderRadius: v('--radius-md', '8px'),
    },
  };
}

function CheckoutForm({
  mode,
  trial,
  returnUrl,
  onSuccess,
  summary,
}: {
  mode: CheckoutMode;
  trial?: boolean;
  returnUrl?: string;
  onSuccess?: () => void;
  summary: ReactNode;
}) {
  const { strings } = useBillingI18n();
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    setError(null);

    const confirmParams = { return_url: returnUrl ?? window.location.href };
    const result =
      mode === 'setup'
        ? await stripe.confirmSetup({ elements, confirmParams, redirect: 'if_required' })
        : await stripe.confirmPayment({ elements, confirmParams, redirect: 'if_required' });

    if (result.error) {
      setError(result.error.message ?? strings.errorPrefix);
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
    onSuccess?.();
  };

  const submitLabel = trial ? strings.startTrial : strings.payAndSubscribe;

  return (
    <form className="ffb-payment" onSubmit={handleSubmit} noValidate>
      {summary}
      <span className="ffb-payment__label">{strings.paymentDetailsHeading}</span>
      <div className="ffb-payment__element">
        <PaymentElement onReady={() => setReady(true)} />
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <Button
        type="submit"
        variant="primary"
        block
        loading={submitting}
        disabled={!stripe || !ready}
      >
        {submitting ? strings.processing : submitLabel}
      </Button>
    </form>
  );
}

/**
 * Checkout dialog hosting the Stripe Payment Element in test mode. Card data is
 * collected and tokenised entirely by Stripe.js inside the iframe — it never
 * touches this component or the FuzeFront backend (only the clientSecret and
 * Stripe ids flow through props). RTL/a11y come from the underlying Modal.
 */
export function CheckoutModal({
  open,
  onClose,
  stripe,
  clientSecret,
  mode = 'payment',
  plan,
  trial,
  returnUrl,
  onSuccess,
}: CheckoutModalProps) {
  const { strings, formatCurrency } = useBillingI18n();

  const options: StripeElementsOptions = {
    clientSecret,
    appearance: dsAppearance(),
  };

  const summary =
    plan && mode === 'payment' ? (
      <div className="ffb-summary">
        <div className="ffb-summary__row">
          <span>{plan.displayName}</span>
          <span>
            {plan.unitAmount === 0
              ? strings.freeLabel
              : formatCurrency(plan.unitAmount, plan.currency)}
          </span>
        </div>
        <div className="ffb-summary__row ffb-summary__row--total">
          <span>{strings.totalDueToday}</span>
          <span>
            {trial
              ? formatCurrency(0, plan.currency)
              : formatCurrency(plan.unitAmount, plan.currency)}
          </span>
        </div>
        {trial && <p className="ffb-summary__trial">{strings.trialNotice}</p>}
      </div>
    ) : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={strings.checkoutHeading}
      subtitle={strings.checkoutSubheading}
    >
      {open && clientSecret ? (
        <Elements stripe={stripe} options={options}>
          <CheckoutForm
            mode={mode}
            trial={trial}
            returnUrl={returnUrl}
            onSuccess={onSuccess}
            summary={summary}
          />
        </Elements>
      ) : null}
    </Modal>
  );
}
