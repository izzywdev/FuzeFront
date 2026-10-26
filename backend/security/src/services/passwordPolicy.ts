/**
 * Signup password policy — the AUTHORITATIVE policy the security service
 * advertises on `GET /v1/security/methods` (`AuthMethods.passwordPolicy`) and
 * enforces server-side on `POST /v1/security/signup`.
 *
 * Source of the values: this documented default. The identity store's own
 * policy (an Authentik password policy bound to the enrollment flow) is NOT
 * discoverable from here without an admin credential plus a flow→policy walk,
 * and the response must never depend on a privileged upstream call (`/methods`
 * is public and unauthenticated). So FuzeFront owns the policy, and any
 * stricter rule the identity store applies is a second, later rejection — it
 * must be kept no stricter than this default or the UI would advertise a
 * policy that signup then refuses.
 *
 * Rules are evaluated Unicode-aware (a Cyrillic capital counts as "upper"),
 * and length is counted in code points, not UTF-16 units, so an emoji or an
 * astral-plane character is one character to the user and to the checklist.
 */

export interface PasswordPolicy {
  minLength: number
  requireUpper: boolean
  requireLower: boolean
  requireDigit: boolean
  requireSymbol: boolean
}

export const DEFAULT_PASSWORD_POLICY: Readonly<PasswordPolicy> = Object.freeze({
  minLength: 12,
  requireUpper: true,
  requireLower: true,
  requireDigit: true,
  requireSymbol: true,
})

/** A fresh copy so callers can never mutate the shared default. */
export function getPasswordPolicy(): PasswordPolicy {
  return { ...DEFAULT_PASSWORD_POLICY }
}

export type PasswordRule = 'length' | 'upper' | 'lower' | 'digit' | 'symbol'

export interface PasswordEvaluation {
  ok: boolean
  /** Rules the candidate fails, in a stable order. Never contains the password. */
  unmet: PasswordRule[]
}

const UPPER = /\p{Lu}/u
const LOWER = /\p{Ll}/u
const DIGIT = /\p{Nd}/u
// A "symbol" is anything that is not a letter, a digit, or whitespace.
const SYMBOL = /[^\p{L}\p{N}\s]/u

export function evaluatePassword(
  password: unknown,
  policy: PasswordPolicy = getPasswordPolicy()
): PasswordEvaluation {
  const pw = typeof password === 'string' ? password : ''
  const unmet: PasswordRule[] = []
  if ([...pw].length < policy.minLength) unmet.push('length')
  if (policy.requireUpper && !UPPER.test(pw)) unmet.push('upper')
  if (policy.requireLower && !LOWER.test(pw)) unmet.push('lower')
  if (policy.requireDigit && !DIGIT.test(pw)) unmet.push('digit')
  if (policy.requireSymbol && !SYMBOL.test(pw)) unmet.push('symbol')
  return { ok: unmet.length === 0, unmet }
}

/** Human-readable (English) explanation for the error body; contains no secret. */
export function describeUnmet(
  unmet: PasswordRule[],
  policy: PasswordPolicy = getPasswordPolicy()
): string {
  const phrase: Record<PasswordRule, string> = {
    length: `at least ${policy.minLength} characters`,
    upper: 'an uppercase letter',
    lower: 'a lowercase letter',
    digit: 'a digit',
    symbol: 'a symbol',
  }
  return `Password does not meet the password policy: needs ${unmet.map((r) => phrase[r]).join(', ')}`
}
