import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SubscriptionManager } from '../src/components/SubscriptionManager';
import { renderWithI18n, makeSubscription } from './helpers';

describe('SubscriptionManager', () => {
  it('renders the empty state with a pick-plan CTA when there is no subscription', async () => {
    const user = userEvent.setup();
    const onPickPlan = vi.fn();
    renderWithI18n(<SubscriptionManager subscription={null} onPickPlan={onPickPlan} />);
    expect(screen.getByText('No active subscription')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Change plan' }));
    expect(onPickPlan).toHaveBeenCalled();
  });

  it('shows status pill, plan name and renewal date for an active subscription', () => {
    renderWithI18n(
      <SubscriptionManager subscription={makeSubscription()} planName="Pro" />,
    );
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Pro')).toBeInTheDocument();
    expect(screen.getByText('Renews on')).toBeInTheDocument();
    expect(screen.getByText('Jul 1, 2026')).toBeInTheDocument();
  });

  it('shows trial end date when trialing', () => {
    renderWithI18n(
      <SubscriptionManager
        subscription={makeSubscription({ status: 'trialing', trialEnd: '2026-06-30T00:00:00.000Z' })}
        planName="Pro"
      />,
    );
    expect(screen.getByText('Trial')).toBeInTheDocument();
    expect(screen.getByText('Trial ends on')).toBeInTheDocument();
  });

  it('confirms before cancelling and calls onCancel', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn().mockResolvedValue(undefined);
    renderWithI18n(
      <SubscriptionManager subscription={makeSubscription()} planName="Pro" onCancel={onCancel} />,
    );
    await user.click(screen.getByRole('button', { name: 'Cancel subscription' }));
    // Confirmation dialog opens
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    await user.click(screen.getByRole('button', { name: 'Keep my plan' }));
    expect(onCancel).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Cancel subscription' }));
    await screen.findByRole('dialog');
    // The confirm dialog's destructive action
    const confirmBtns = screen.getAllByRole('button', { name: 'Cancel subscription' });
    await user.click(confirmBtns[confirmBtns.length - 1]);
    await waitFor(() => expect(onCancel).toHaveBeenCalled());
  });

  it('renders the cancellation-scheduled notice and a resume action', async () => {
    const user = userEvent.setup();
    const onResume = vi.fn().mockResolvedValue(undefined);
    renderWithI18n(
      <SubscriptionManager
        subscription={makeSubscription({ cancelAtPeriodEnd: true })}
        planName="Pro"
        onResume={onResume}
      />,
    );
    expect(screen.getByText(/will end at the close/i)).toBeInTheDocument();
    expect(screen.getByText('Ends on')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Resume subscription' }));
    expect(onResume).toHaveBeenCalled();
  });
});
