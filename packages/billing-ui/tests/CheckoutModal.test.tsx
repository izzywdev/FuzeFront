import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';

// --- Stripe SDK mocks (hoisted) --------------------------------------------
const confirmPayment = vi.fn();
const confirmSetup = vi.fn();

vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }: { children: ReactNode }) => (
    <div data-testid="stripe-elements">{children}</div>
  ),
  PaymentElement: ({ onReady }: { onReady?: () => void }) => {
    setTimeout(() => onReady?.(), 0);
    return <div data-testid="payment-element" aria-label="Payment Element" />;
  },
  useStripe: () => ({ confirmPayment, confirmSetup }),
  useElements: () => ({}),
}));

import { CheckoutModal } from '../src/components/CheckoutModal';
import { renderWithI18n, makePlan } from './helpers';

describe('CheckoutModal', () => {
  beforeEach(() => {
    confirmPayment.mockReset().mockResolvedValue({ error: undefined });
    confirmSetup.mockReset().mockResolvedValue({ error: undefined });
  });

  it('renders the Payment Element inside an accessible dialog with an order summary', async () => {
    renderWithI18n(
      <CheckoutModal
        open
        onClose={() => {}}
        stripe={null}
        clientSecret="pi_secret_123"
        plan={makePlan({ displayName: 'Pro', unitAmount: 2900 })}
      />,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByTestId('payment-element')).toBeInTheDocument();
    // Order summary shows the plan price and a "Due today" total.
    expect(screen.getByText('Due today')).toBeInTheDocument();
    expect(screen.getAllByText('$29.00').length).toBeGreaterThan(0);
  });

  it('confirms the payment and fires onSuccess when there is no error', async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    renderWithI18n(
      <CheckoutModal
        open
        onClose={() => {}}
        stripe={null}
        clientSecret="pi_secret_123"
        plan={makePlan()}
        onSuccess={onSuccess}
        returnUrl="https://app.fuzefront.com/billing"
      />,
    );
    const subscribe = await screen.findByRole('button', { name: 'Subscribe' });
    await waitFor(() => expect(subscribe).toBeEnabled());
    await user.click(subscribe);
    await waitFor(() => expect(confirmPayment).toHaveBeenCalledTimes(1));
    expect(confirmPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        confirmParams: { return_url: 'https://app.fuzefront.com/billing' },
        redirect: 'if_required',
      }),
    );
    expect(onSuccess).toHaveBeenCalled();
  });

  it('surfaces a Stripe error as an alert and does not fire onSuccess', async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    confirmPayment.mockResolvedValue({ error: { message: 'Your card was declined.' } });
    renderWithI18n(
      <CheckoutModal
        open
        onClose={() => {}}
        stripe={null}
        clientSecret="pi_secret_123"
        plan={makePlan()}
        onSuccess={onSuccess}
      />,
    );
    const subscribe = await screen.findByRole('button', { name: 'Subscribe' });
    await waitFor(() => expect(subscribe).toBeEnabled());
    await user.click(subscribe);
    expect(await screen.findByRole('alert')).toHaveTextContent('Your card was declined.');
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('uses confirmSetup in setup mode (saving a card, no charge)', async () => {
    const user = userEvent.setup();
    renderWithI18n(
      <CheckoutModal open onClose={() => {}} stripe={null} clientSecret="seti_secret" mode="setup" />,
    );
    const submit = await screen.findByRole('button', { name: 'Subscribe' });
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);
    await waitFor(() => expect(confirmSetup).toHaveBeenCalledTimes(1));
    expect(confirmPayment).not.toHaveBeenCalled();
  });

  it('shows a trial total of $0.00 with the trial notice when trial is set', () => {
    renderWithI18n(
      <CheckoutModal
        open
        onClose={() => {}}
        stripe={null}
        clientSecret="pi_secret_123"
        plan={makePlan({ unitAmount: 2900 })}
        trial
      />,
    );
    expect(screen.getByText('$0.00')).toBeInTheDocument();
    expect(screen.getByText(/will not be charged/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start free trial' })).toBeInTheDocument();
  });
});
