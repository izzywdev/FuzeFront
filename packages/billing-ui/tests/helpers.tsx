import { render, type RenderOptions } from '@testing-library/react';
import { type ReactElement, type ReactNode } from 'react';
import { BillingI18nProvider, type Direction } from '../src/i18n';
import type { Plan, BillingSubscription } from '@fuzefront/billing-client';

export function renderWithI18n(
  ui: ReactElement,
  { dir = 'ltr', locale = 'en-US' }: { dir?: Direction; locale?: string } = {},
  options?: RenderOptions,
) {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <BillingI18nProvider dir={dir} locale={locale}>
      {children}
    </BillingI18nProvider>
  );
  return render(ui, { wrapper: Wrapper, ...options });
}

export const makePlan = (over: Partial<Plan> = {}): Plan => ({
  priceId: 'price_pro_month',
  productId: 'prod_pro',
  tierName: 'pro',
  displayName: 'Pro',
  billingInterval: 'month',
  unitAmount: 2900,
  currency: 'usd',
  seatBased: false,
  meteredMeterName: null,
  features: ['Unlimited apps', 'Priority support'],
  isActive: true,
  sortOrder: 2,
  ...over,
});

export const makeSubscription = (
  over: Partial<BillingSubscription> = {},
): BillingSubscription => ({
  id: 'sub_local_1',
  customerId: 'cus_1',
  subscriptionId: 'sub_123',
  priceId: 'price_pro_month',
  planTier: 'pro',
  status: 'active',
  seatQuantity: 1,
  trialStart: null,
  trialEnd: null,
  currentPeriodStart: '2026-06-01T00:00:00.000Z',
  currentPeriodEnd: '2026-07-01T00:00:00.000Z',
  cancelAtPeriodEnd: false,
  canceledAt: null,
  ...over,
});
