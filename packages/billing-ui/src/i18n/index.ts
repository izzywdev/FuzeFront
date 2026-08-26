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
  // Invoice history
  invoicesHeading: string;
  invoicesShownSuffix: string;
  invoicesLoadMore: string;
  invoicesEmptyHeading: string;
  invoicesEmptyBody: string;
  invoicesErrorHeading: string;
  invoicesErrorBody: string;
  invoiceDownloadPdf: string;
  invoiceView: string;
  /** Accessible-name prefix for a PDF download link: "<prefix> <number> <invoiceDownloadPdf>". */
  invoiceDownloadAria: string;
  /** Accessible-name prefix for a hosted-invoice link: "<prefix> <number>". */
  invoiceViewAria: string;
  invoiceStatusPaid: string;
  invoiceStatusOpen: string;
  invoiceStatusVoid: string;
  invoiceStatusDraft: string;
  invoiceStatusUncollectible: string;
  // Generic
  errorPrefix: string;
  retry: string;
  loading: string;
  // Portal billing console (PortalBillingFlow, FF-EPIC-14-S4)
  portalBillingIntro: string;
  platformSubscriptionHeading: string;
  platformSubscriptionSub: string;
  manageSubscriptionAction: string;
  viewInvoicesAction: string;
  planLabel: string;
  amountLabel: string;
  noPlatformSubscriptionHeading: string;
  noPlatformSubscriptionBody: string;
  platformSubscriptionErrorHeading: string;
  platformSubscriptionErrorBody: string;
  connectHeading: string;
  connectSub: string;
  connectOnboardedLabel: string;
  connectNotStartedTitle: string;
  connectNotStartedBody: string;
  startOnboardingAction: string;
  continueOnboardingAction: string;
  connectRestrictedTitle: string;
  connectRestrictedBody: string;
  connectErrorHeading: string;
  connectErrorBody: string;
  openConnectDashboardAction: string;
  connectDashboardNote: string;
  priceBookHeading: string;
  priceBookSub: string;
  addPriceAction: string;
  editPriceAction: string;
  priceBookEmptyHeading: string;
  priceBookEmptyBody: string;
  priceBookErrorHeading: string;
  priceBookErrorBody: string;
  addPriceModalHeading: string;
  chargesNotEnabledTitle: string;
  chargesNotEnabledBody: string;
  publishPriceAction: string;
  priceNameLabel: string;
  priceAmountLabel: string;
  priceCurrencyLabel: string;
  priceIntervalLabel: string;
  intervalMonth: string;
  intervalYear: string;
  resellerNotEnabledHeading: string;
  resellerNotEnabledBody: string;
  accessDeniedHeading: string;
  accessDeniedBody: string;
  planColumnHeader: string;
  priceColumnHeader: string;
  statusColumnHeader: string;
  actionsColumnHeader: string;
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
  invoicesHeading: 'Invoices',
  invoicesShownSuffix: 'shown',
  invoicesLoadMore: 'Load more',
  invoicesEmptyHeading: 'No invoices yet',
  invoicesEmptyBody: 'Invoices appear here after your first billed period.',
  invoicesErrorHeading: "Couldn't load invoices",
  invoicesErrorBody: 'Something went wrong on our end.',
  invoiceDownloadPdf: 'PDF',
  invoiceView: 'View',
  invoiceDownloadAria: 'Download invoice',
  invoiceViewAria: 'View invoice',
  invoiceStatusPaid: 'Paid',
  invoiceStatusOpen: 'Open',
  invoiceStatusVoid: 'Void',
  invoiceStatusDraft: 'Draft',
  invoiceStatusUncollectible: 'Uncollectible',
  errorPrefix: 'Something went wrong',
  retry: 'Try again',
  loading: 'Loading…',
  portalBillingIntro:
    'Two things live here: your platform subscription (what your portal pays FuzeFront) and reseller billing via Stripe Connect (how you charge your own customers). This surface never touches Stripe secrets — it reads status and hands off to Stripe-hosted onboarding.',
  platformSubscriptionHeading: 'Your FuzeFront subscription',
  platformSubscriptionSub: 'What this portal pays the platform',
  manageSubscriptionAction: 'Manage subscription',
  viewInvoicesAction: 'View invoices',
  planLabel: 'Plan',
  amountLabel: 'Amount',
  noPlatformSubscriptionHeading: 'No active subscription',
  noPlatformSubscriptionBody: 'This portal has no platform subscription yet.',
  platformSubscriptionErrorHeading: "Couldn't load your subscription",
  platformSubscriptionErrorBody: 'Something went wrong on our end. Your access hasn’t changed — try again.',
  connectHeading: 'Reseller payouts · Connect',
  connectSub: 'Charge your own customers and get paid out',
  connectOnboardedLabel: 'Onboarded',
  connectNotStartedTitle: 'Start billing your customers',
  connectNotStartedBody:
    "Onboard a Stripe Connect account to charge your own customers and receive payouts. It takes a few minutes on Stripe's secure onboarding — you'll come right back here.",
  startOnboardingAction: 'Start onboarding',
  continueOnboardingAction: 'Continue onboarding',
  connectRestrictedTitle: 'Stripe needs more from you',
  connectRestrictedBody:
    "Your Connect account is restricted — payouts are paused until Stripe's outstanding requirements are met. Re-open onboarding to fix it.",
  connectErrorHeading: "Couldn't load",
  connectErrorBody: 'Something went wrong on our end. Your access hasn’t changed — try again.',
  openConnectDashboardAction: 'Open Stripe dashboard',
  connectDashboardNote: 'Manage the account itself on Stripe — this console only reflects its status.',
  priceBookHeading: 'Price book',
  priceBookSub: 'The plans you sell to your customers',
  addPriceAction: 'Add price',
  editPriceAction: 'Edit',
  priceBookEmptyHeading: 'No prices yet',
  priceBookEmptyBody: 'Add a price to start selling plans to your customers.',
  priceBookErrorHeading: "Couldn't load your price book",
  priceBookErrorBody: 'Something went wrong on our end. Try again.',
  addPriceModalHeading: 'Add a price',
  chargesNotEnabledTitle: 'Finish onboarding first',
  chargesNotEnabledBody:
    "You can't publish a price until Stripe has enabled charges on your account. Complete Connect onboarding, then add prices.",
  publishPriceAction: 'Publish price',
  priceNameLabel: 'Plan name',
  priceAmountLabel: 'Price',
  priceCurrencyLabel: 'Currency',
  priceIntervalLabel: 'Billing interval',
  intervalMonth: 'Monthly',
  intervalYear: 'Yearly',
  resellerNotEnabledHeading: "Reseller payouts aren't enabled yet",
  resellerNotEnabledBody:
    'Stripe Connect and the price book aren’t available for this portal yet. Check back soon.',
  accessDeniedHeading: "You don't have access to this portal's billing",
  accessDeniedBody:
    'Your account isn’t authorized to manage this portal’s billing. This is an authorization result — you have not been signed out.',
  planColumnHeader: 'Plan',
  priceColumnHeader: 'Price',
  statusColumnHeader: 'Status',
  actionsColumnHeader: 'Actions',
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
