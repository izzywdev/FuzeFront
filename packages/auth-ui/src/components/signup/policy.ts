import type { PasswordPolicy } from '../../types'
import type { SignUpLabels } from './labels'

/**
 * Fallback policy used until / unless `AuthMethods.passwordPolicy` arrives. It
 * mirrors the Security API's authoritative default (12+, upper, lower, digit,
 * symbol) so the form is never rendered without a policy — the server still
 * enforces the real one and a mismatch surfaces as the post-submit weak-password
 * state, never as a silent pass.
 */
export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {
  minLength: 12,
  requireUpper: true,
  requireLower: true,
  requireDigit: true,
  requireSymbol: true,
}

export type PolicyRuleId = 'length' | 'upper' | 'lower' | 'digit' | 'symbol'

export interface PolicyRule {
  id: PolicyRuleId
  label: string
  test: (value: string) => boolean
}

type RuleLabels = Pick<SignUpLabels, 'reqLength' | 'reqUpper' | 'reqLower' | 'reqDigit' | 'reqSymbol'>

/**
 * Build the checklist rules from the AUTHORITATIVE policy (never a hard-coded
 * client copy). `length` is always present; the four character-class rules only
 * when the policy requires them. Order follows the approved frame.
 */
export function buildPolicyRules(
  policy: PasswordPolicy | undefined,
  labels: RuleLabels,
): PolicyRule[] {
  const p = policy ?? DEFAULT_PASSWORD_POLICY
  const rules: PolicyRule[] = [
    { id: 'length', label: labels.reqLength(p.minLength), test: v => v.length >= p.minLength },
  ]
  if (p.requireUpper) rules.push({ id: 'upper', label: labels.reqUpper, test: v => /[A-Z]/.test(v) })
  if (p.requireLower) rules.push({ id: 'lower', label: labels.reqLower, test: v => /[a-z]/.test(v) })
  if (p.requireDigit) rules.push({ id: 'digit', label: labels.reqDigit, test: v => /\d/.test(v) })
  if (p.requireSymbol) rules.push({ id: 'symbol', label: labels.reqSymbol, test: v => /[^A-Za-z0-9]/.test(v) })
  return rules
}

/** True when `value` satisfies every rule — the submit gate. */
export function meetsPolicy(value: string, rules: PolicyRule[]): boolean {
  return rules.every(r => r.test(value))
}
