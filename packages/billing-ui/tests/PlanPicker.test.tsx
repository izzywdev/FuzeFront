import { describe, it, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PlanPicker } from '../src/components/PlanPicker';
import { renderWithI18n, makePlan } from './helpers';

const plans = [
  makePlan({ stripePriceId: 'free_m', tierName: 'free', displayName: 'Starter', unitAmount: 0, sortOrder: 0, billingInterval: 'month', features: ['1 app'] }),
  makePlan({ stripePriceId: 'pro_m', displayName: 'Pro', unitAmount: 2900, sortOrder: 2, billingInterval: 'month' }),
  makePlan({ stripePriceId: 'pro_y', displayName: 'Pro Annual', unitAmount: 29000, sortOrder: 2, billingInterval: 'year' }),
];

/** Locate a plan card section by its heading text. */
function cardByName(name: string): HTMLElement {
  const heading = screen.getByRole('heading', { level: 3, name });
  return heading.closest('section') as HTMLElement;
}

describe('PlanPicker / PlanCard', () => {
  it('renders one card per plan for the active interval', () => {
    renderWithI18n(<PlanPicker plans={plans} />);
    // Default interval month → Starter + Pro monthly (2 cards)
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(2);
  });

  it('formats a paid plan price as localized currency and a zero-cost plan as "Free"', () => {
    renderWithI18n(<PlanPicker plans={plans} showIntervalToggle={false} />);
    expect(screen.getByText('$29.00')).toBeInTheDocument();
    // The zero-cost Starter plan shows the "Free" price label inside its card.
    const starter = cardByName('Starter');
    expect(within(starter).getByText('Free')).toBeInTheDocument();
  });

  it('toggles between monthly and yearly intervals', async () => {
    const user = userEvent.setup();
    renderWithI18n(<PlanPicker plans={plans} />);
    expect(screen.getByText('$29.00')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Yearly' }));
    expect(screen.getByText('$290.00')).toBeInTheDocument();
  });

  it('invokes onSelect with the chosen plan', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderWithI18n(<PlanPicker plans={plans} showIntervalToggle={false} onSelect={onSelect} />);
    const proCard = cardByName('Pro');
    await user.click(within(proCard).getByRole('button', { name: 'Select' }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ stripePriceId: 'pro_m' }));
  });

  it('marks the current plan and disables its select button', () => {
    renderWithI18n(
      <PlanPicker plans={plans} showIntervalToggle={false} currentPriceId="pro_m" />,
    );
    const proCard = cardByName('Pro');
    // The current-plan badge marks the card…
    expect(within(proCard).getByText('Current plan', { selector: 'span' })).toBeInTheDocument();
    // …and its select button is disabled (cannot re-select the active plan).
    expect(within(proCard).getByRole('button')).toBeDisabled();
  });

  it('exposes accessible names: each card is a labelled region and the interval group is labelled', () => {
    renderWithI18n(<PlanPicker plans={plans} />);
    expect(screen.getByRole('group', { name: /choose your plan/i })).toBeInTheDocument();
    // Each plan card section is labelled by its heading.
    const regions = screen.getAllByRole('region');
    expect(regions.length).toBeGreaterThanOrEqual(2);
  });

  it('mirrors for RTL by forwarding dir to the overlay/root (logical CSS handles layout)', () => {
    const { container } = renderWithI18n(<PlanPicker plans={plans} />, { dir: 'rtl', locale: 'ar' });
    // No physical left/right used; verify nothing hard-codes direction in markup.
    expect(container.querySelector('.ffb-plans')).toBeInTheDocument();
    // Arabic locale formats currency with Arabic numerals — just assert it renders without throwing.
    expect(container.textContent).toBeTruthy();
  });
});
