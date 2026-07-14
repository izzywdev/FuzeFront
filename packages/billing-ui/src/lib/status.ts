import type { SubscriptionStatus } from '@fuzefront/billing-client';
import type { BillingStrings } from '../i18n';

/** Visual tone for a subscription status, mapped to design-system status tokens. */
export type StatusTone = 'success' | 'warning' | 'error' | 'neutral';

const TONE_BY_STATUS: Record<string, StatusTone> = {
  active: 'success',
  trialing: 'success',
  past_due: 'warning',
  incomplete: 'warning',
  unpaid: 'error',
  canceled: 'neutral',
  incomplete_expired: 'neutral',
};

const STRING_KEY_BY_STATUS: Record<string, keyof BillingStrings> = {
  trialing: 'statusTrialing',
  active: 'statusActive',
  past_due: 'statusPastDue',
  canceled: 'statusCanceled',
  unpaid: 'statusUnpaid',
  incomplete: 'statusIncomplete',
  incomplete_expired: 'statusIncomplete',
};

export function statusTone(status: SubscriptionStatus): StatusTone {
  return TONE_BY_STATUS[status] ?? 'neutral';
}

/**
 * Visual tone for a vendor-neutral invoice status. The invoice status set is
 * independent of the subscription set (paid/open/void/uncollectible/draft), so
 * it gets its own mapping rather than overloading `statusTone`.
 */
const TONE_BY_INVOICE_STATUS: Record<string, StatusTone> = {
  paid: 'success',
  open: 'warning',
  void: 'neutral',
  draft: 'neutral',
  uncollectible: 'error',
};

export function invoiceStatusTone(status: string): StatusTone {
  return TONE_BY_INVOICE_STATUS[status] ?? 'neutral';
}

const INVOICE_STRING_KEY_BY_STATUS: Record<string, keyof BillingStrings> = {
  paid: 'invoiceStatusPaid',
  open: 'invoiceStatusOpen',
  void: 'invoiceStatusVoid',
  draft: 'invoiceStatusDraft',
  uncollectible: 'invoiceStatusUncollectible',
};

/** Resolve a human-readable, translated label for an invoice status. */
export function invoiceStatusLabel(status: string, strings: BillingStrings): string {
  const key = INVOICE_STRING_KEY_BY_STATUS[status];
  return key ? strings[key] : status;
}

/** Resolve a human-readable, translated label for a subscription status. */
export function statusLabel(status: SubscriptionStatus, strings: BillingStrings): string {
  const key = STRING_KEY_BY_STATUS[status];
  return key ? strings[key] : status;
}

/** True when the subscription grants access right now (even if cancellation is pending). */
export function isEntitled(status: SubscriptionStatus): boolean {
  return status === 'active' || status === 'trialing' || status === 'past_due';
}
