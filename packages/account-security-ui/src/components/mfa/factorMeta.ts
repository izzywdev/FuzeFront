import type { AccountSecurityMessages } from '../../i18n/messages'
import type { MfaFactor, MfaFactorType } from '../../types'

/** Decorative glyph per factor kind (aria-hidden at every call site). */
export const FACTOR_ICON: Record<MfaFactorType | 'recovery', string> = {
  totp: '🔑',
  sms: '💬',
  email: '✉️',
  webauthn: '🔐',
  recovery: '🗝️',
}

/** Neutral, translated display name for a factor kind — never a provider name. */
export function factorName(m: AccountSecurityMessages, type: MfaFactorType | 'recovery'): string {
  return m.mfa.factorName[type] ?? m.mfa.factorName.totp
}

/** Group a bare TOTP secret as `ABCD EFGH …` for hand entry. */
export function groupSecret(secret: string): string {
  return secret.replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim()
}

/** Mask a phone number to its last four digits: `•••• •• 4471`. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  return digits.length >= 4 ? `•••• •• ${digits.slice(-4)}` : '••••'
}

/**
 * Normalise a typed phone number to the wire format the SMS service accepts:
 * strip spaces, dashes, dots and parentheses, keep a single leading `+`.
 */
export function normalizePhone(raw: string): string {
  const trimmed = raw.trim()
  const plus = trimmed.startsWith('+') ? '+' : ''
  return plus + trimmed.replace(/[\s\-.()]/g, '').replace(/^\+/, '')
}

/** E.164, exactly the SMS service's rule (`/^\+[1-9]\d{6,14}$/`). Send is enabled only for these. */
export function isSendablePhone(raw: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(normalizePhone(raw))
}

/** Only fully activated factors are "your methods"; pending enrolments are not. */
export function activeFactors(items: MfaFactor[]): MfaFactor[] {
  return items.filter((f) => f.status === 'active')
}
