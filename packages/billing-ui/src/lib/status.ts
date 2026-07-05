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

/** Resolve a human-readable, translated label for a subscription status. */
export function statusLabel(status: SubscriptionStatus, strings: BillingStrings): string {
  const key = STRING_KEY_BY_STATUS[status];
  return key ? strings[key] : status;
}

/** True when the subscription grants access right now (even if cancellation is pending). */
export function isEntitled(status: SubscriptionStatus): boolean {
  return status === 'active' || status === 'trialing' || status === 'past_due';
}
