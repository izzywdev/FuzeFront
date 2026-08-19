import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UsagePanel } from '../src/components/UsagePanel';
import { PaymentMethodPanel } from '../src/components/PaymentMethodPanel';
import { renderWithI18n } from './helpers';

describe('UsagePanel', () => {
  it('renders the empty state when no usage data is supplied', () => {
    renderWithI18n(<UsagePanel />);
    expect(screen.getByText('No usage recorded yet.')).toBeInTheDocument();
  });

  it('renders available credit from a negative customer balance', () => {
    renderWithI18n(<UsagePanel customerBalance={-1500} currency="usd" />);
    expect(screen.getByText('Account credit')).toBeInTheDocument();
    expect(screen.getByText('$15.00')).toBeInTheDocument();
  });

  it('renders seats in use as "x / y"', () => {
    renderWithI18n(<UsagePanel seatsInUse={3} seatsTotal={5} />);
    expect(screen.getByText('3 / 5')).toBeInTheDocument();
    expect(screen.getByText('Seats in use')).toBeInTheDocument();
  });
});

describe('PaymentMethodPanel', () => {
  it('renders the empty state and an add action when no card is on file', async () => {
    const user = userEvent.setup();
    const onManage = vi.fn();
    renderWithI18n(<PaymentMethodPanel card={null} onManage={onManage} />);
    expect(screen.getByText('No payment method on file.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add payment method' }));
    expect(onManage).toHaveBeenCalled();
  });

  it('renders a card summary and an update action', () => {
    renderWithI18n(
      <PaymentMethodPanel
        card={{ brand: 'visa', last4: '4242', expMonth: 4, expYear: 2030 }}
        onManage={() => {}}
      />,
    );
    expect(screen.getByText('visa')).toBeInTheDocument();
    expect(screen.getByText(/4242/)).toBeInTheDocument();
    expect(screen.getByText(/04\/2030/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update card' })).toBeInTheDocument();
  });
});
