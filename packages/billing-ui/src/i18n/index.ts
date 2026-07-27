/**
 * Lightweight i18n + direction layer for @fuzefront/billing-ui.
 *
 * `@fuzefront/i18n` is the shared package this is designed to defer to. Until it
 * is wired in on this branch, this module mirrors the interface we expect it to
 * expose (a `dir` + a `t(key)` string lookup + `locale`-aware formatters) so
 * that swapping it in is a one-line import change and the component API does not
 * move. All user-facing strings live here; components never hard-code copy.
 *
 * RTL is handled purely via CSS logical properties in the stylesheet — `dir` is
 * only forwarded to the root element so the browser mirrors automatically, and
 * to `Intl` so numbers/currency render in the right numeral system.
 */

import { createContext, createElement, useContext, type ReactNode } from 'react';

export type Direction = 'ltr' | 'rtl';

/** All translatable strings the billing UI renders. */
export interface BillingStrings {
  // Plan picker
  plansHeading: string;
  plansSubheading: string;
  intervalMonthly: string;
  intervalYearly: string;
  perMonth: string;
  perYear: string;
  freeLabel: string;
  currentPlanBadge: string;
  mostPopularBadge: string;
  selectPlan: string;
  selectedPlan: string;
  featuresHeading: string;
  seatsLabel: string;
  // Checkout modal
  checkoutHeading: string;
  checkoutSubheading: string;
  orderSummaryHeading: string;
  totalDueToday: string;
  trialNotice: string;
  payAndSubscribe: string;
  startTrial: string;
  processing: string;
  paymentDetailsHeading: string;
  closeLabel: string;
  cancelLabel: string;
  threeDSNotice: string;
  checkoutSuccessHeading: string;
  checkoutSuccessBody: string;
  done: string;
  // Subscription management
  subscriptionHeading: string;
  statusLabel: string;
  renewsOn: string;
  endsOn: string;
  trialEndsOn: string;
  cancelScheduledNotice: string;
  changePlan: string;
  cancelSubscription: string;
  resumeSubscription: string;
  confirmCancelHeading: string;
  confirmCancelBody: string;
  keepSubscription: string;
  noSubscriptionHeading: string;
  noSubscriptionBody: string;
  // Usage / credits
  usageHeading: string;
  creditsLabel: string;
  seatsInUse: string;
  noUsageData: string;
  // Payment methods
  paymentMethodHeading: string;
  cardEndingIn: string;
  expiresLabel: string;
  addPaymentMethod: string;
  updatePaymentMethod: string;
  savePaymentMethod: string;
  noPaymentMethod: string;
  defaultBadge: string;
  // Status display names
  statusTrialing: string;
  statusActive: string;
  statusPastDue: string;
  statusCanceled: string;
  statusUnpaid: string;
  statusIncomplete: string;
  // Generic
  errorPrefix: string;
  retry: string;
  loading: string;
}

const EN: BillingStrings = {
  plansHeading: 'Choose your plan',
  plansSubheading: 'Upgrade, downgrade, or cancel at any time.',
  intervalMonthly: 'Monthly',
  intervalYearly: 'Yearly',
  perMonth: '/mo',
  perYear: '/yr',
  freeLabel: 'Free',
  currentPlanBadge: 'Current plan',
  mostPopularBadge: 'Most popular',
  selectPlan: 'Select',
  selectedPlan: 'Selected',
  featuresHeading: "What's included",
  seatsLabel: 'per seat',
  checkoutHeading: 'Complete your subscription',
  checkoutSubheading: 'Your card is processed securely by Stripe.',
  orderSummaryHeading: 'Order summary',
  totalDueToday: 'Due today',
  trialNotice: 'You will not be charged until your trial ends.',
  payAndSubscribe: 'Subscribe',
  startTrial: 'Start free trial',
  processing: 'Processing…',
  paymentDetailsHeading: 'Payment details',
  closeLabel: 'Close',
  cancelLabel: 'Cancel',
  threeDSNotice: 'Your bank requires additional confirmation.',
  checkoutSuccessHeading: 'Subscription active',
  checkoutSuccessBody: 'Your plan is now active. Welcome aboard.',
  done: 'Done',
  subscriptionHeading: 'Your subscription',
  statusLabel: 'Status',
  renewsOn: 'Renews on',
  endsOn: 'Ends on',
  trialEndsOn: 'Trial ends on',
  cancelScheduledNotice: 'Your subscription will end at the close of the current period.',
  changePlan: 'Change plan',
  cancelSubscription: 'Cancel subscription',
  resumeSubscription: 'Resume subscription',
  confirmCancelHeading: 'Cancel subscription?',
  confirmCancelBody:
    'You will keep access until the end of your current billing period, then the plan will not renew.',
  keepSubscription: 'Keep my plan',
  noSubscriptionHeading: 'No active subscription',
  noSubscriptionBody: 'Pick a plan to get started.',
  usageHeading: 'Usage & credits',
  creditsLabel: 'Account credit',
  seatsInUse: 'Seats in use',
  noUsageData: 'No usage recorded yet.',
  paymentMethodHeading: 'Payment method',
  cardEndingIn: 'Card ending in',
  expiresLabel: 'Expires',
  addPaymentMethod: 'Add payment method',
  updatePaymentMethod: 'Update card',
  savePaymentMethod: 'Save card',
  noPaymentMethod: 'No payment method on file.',
  defaultBadge: 'Default',
  statusTrialing: 'Trial',
  statusActive: 'Active',
  statusPastDue: 'Past due',
  statusCanceled: 'Canceled',
  statusUnpaid: 'Unpaid',
  statusIncomplete: 'Incomplete',
  errorPrefix: 'Something went wrong',
  retry: 'Try again',
  loading: 'Loading…',
};

export interface I18nContextValue {
  dir: Direction;
  locale: string;
  strings: BillingStrings;
  /** Format a minor-unit (cents) amount in a currency for the active locale. */
  formatCurrency: (minorUnits: number, currency: string) => string;
  /** Format an ISO date string for the active locale (date only). */
  formatDate: (iso: string | null | undefined) => string;
}

function makeFormatters(locale: string) {
  const formatCurrency = (minorUnits: number, currency: string): string => {
    try {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: (currency || 'usd').toUpperCase(),
      }).format(minorUnits / 100);
    } catch {
      // Unknown currency code — fall back to a plain number so we never crash.
      return `${(minorUnits / 100).toFixed(2)} ${currency.toUpperCase()}`;
    }
  };
  const formatDate = (iso: string | null | undefined): string => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(d);
  };
  return { formatCurrency, formatDate };
}

const defaultLocale = 'en-US';
const defaultValue: I18nContextValue = {
  dir: 'ltr',
  locale: defaultLocale,
  strings: EN,
  ...makeFormatters(defaultLocale),
};

const I18nContext = createContext<I18nContextValue>(defaultValue);

export interface BillingI18nProviderProps {
  dir?: Direction;
  locale?: string;
  /** Partial overrides merged over the built-in English strings. */
  strings?: Partial<BillingStrings>;
  children: ReactNode;
}

export function BillingI18nProvider({
  dir = 'ltr',
  locale = defaultLocale,
  strings,
  children,
}: BillingI18nProviderProps) {
  const value: I18nContextValue = {
    dir,
    locale,
    strings: strings ? { ...EN, ...strings } : EN,
    ...makeFormatters(locale),
  };
  return createElement(I18nContext.Provider, { value }, children);
}

export function useBillingI18n(): I18nContextValue {
  return useContext(I18nContext);
}

export { EN as defaultStrings };
