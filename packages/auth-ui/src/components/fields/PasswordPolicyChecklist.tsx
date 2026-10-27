import React, { useMemo } from 'react'
import { PasswordChecklist } from '@fuzefront/design-system'
import type { PasswordPolicy } from '../../types'
import { DEFAULT_SIGNUP_LABELS, type SignUpLabels } from '../signup/labels'
import { buildPolicyRules, type PolicyRule } from '../signup/policy'

export interface PasswordPolicyChecklistProps {
  value: string
  /** The authoritative policy (`AuthMethods.passwordPolicy`). Ignored when `rules` is given. */
  policy?: PasswordPolicy
  /** Pre-built rules (e.g. shared with the strength meter + submit gate). */
  rules?: PolicyRule[]
  labels?: Partial<SignUpLabels>
  /** Grid columns (default 2, as in the approved frame). */
  columns?: number
  /** Tint still-unmet rules with the error colour (after a rejected submit). */
  highlightUnmet?: boolean
}

/**
 * Live per-rule requirements checklist. Each row ticks as the field satisfies it
 * and carries the test hooks `data-req="<rule>"` / `data-met="true|false"` (the
 * list is `data-pwreq`). The rules come from the AUTHORITATIVE policy, so the
 * list reflects exactly what the server will enforce. Composes the design-system
 * `PasswordChecklist`; this adds only the policy mapping and the localizable copy.
 */
export function PasswordPolicyChecklist({
  value,
  policy,
  rules,
  labels: overrides,
  columns = 2,
  highlightUnmet,
}: PasswordPolicyChecklistProps) {
  const labels = { ...DEFAULT_SIGNUP_LABELS, ...overrides }
  const resolved = useMemo(
    () => rules ?? buildPolicyRules(policy, labels),
    // labels is rebuilt each render; key on the pieces that change the output.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rules, policy, labels.reqLength, labels.reqUpper, labels.reqLower, labels.reqDigit, labels.reqSymbol],
  )
  return (
    <PasswordChecklist
      value={value}
      rules={resolved}
      title=""
      columns={columns}
      highlightUnmet={highlightUnmet}
      metLabel={labels.reqMet}
      unmetLabel={labels.reqUnmet}
    />
  )
}
