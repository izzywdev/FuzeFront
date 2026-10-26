import React from 'react'
import { PasswordChecklist, StrengthMeter } from '@fuzefront/design-system'
import { DEFAULT_VERIFY_RESET_LABELS, type VerifyResetLabels } from './types'

export type PasswordStrength = 'empty' | 'weak' | 'fair' | 'good' | 'strong'

type Rule = { id: string; label: string; test: (v: string) => boolean }

/**
 * Strength from the AUTHORITATIVE policy rules (the DS default mirrors the
 * Security API's 12+/upper/lower/digit/symbol): two or more rules missing = weak,
 * one missing = fair, all met = good, all met and 16+ chars = strong.
 */
export function scorePassword(value: string, rules: Rule[] = PasswordChecklist.rules): PasswordStrength {
  if (!value) return 'empty'
  const met = rules.filter(r => r.test(value)).length
  if (met === rules.length) return value.length >= 16 ? 'strong' : 'good'
  if (met >= rules.length - 1) return 'fair'
  return 'weak'
}

export interface PasswordStrengthMeterProps {
  value: string
  rules?: Rule[]
  labels?: Partial<VerifyResetLabels>
  /** Also render the per-rule checklist (DS PasswordChecklist) inside the meter. Default true. */
  showChecklist?: boolean
  /** Checklist grid columns (default 1; the signup form uses 2). */
  checklistColumns?: number
  /** Localized visually-hidden per-row suffixes for the checklist. */
  metLabel?: string
  unmetLabel?: string
  /** Tint still-unmet rules with the error colour (after a rejected submit). */
  highlightUnmet?: boolean
  /** DOM id, so the password input can point `aria-describedby` at the meter. */
  id?: string
  /** Rendered inside the meter, after the built-in checklist (pass `showChecklist={false}` to use only these). */
  children?: React.ReactNode
}

/**
 * PasswordStrengthMeter — scores `value` against the policy rules and renders the
 * design-system `StrengthMeter` (segmented bars + word), with the live per-rule
 * checklist nested inside it. Exposes `data-pwmeter` + `data-strength`; the
 * checklist rows carry `data-pwreq` / `data-req` / `data-met`.
 */
export function PasswordStrengthMeter({
  value,
  rules,
  labels: overrides,
  showChecklist = true,
  checklistColumns = 1,
  metLabel,
  unmetLabel,
  highlightUnmet,
  id,
  children,
}: PasswordStrengthMeterProps) {
  const labels = { ...DEFAULT_VERIFY_RESET_LABELS, ...overrides }
  const strength = scorePassword(value, rules)
  const word =
    strength === 'weak' ? labels.strengthWeak
    : strength === 'fair' ? labels.strengthFair
    : strength === 'good' ? labels.strengthGood
    : strength === 'strong' ? labels.strengthStrong
    : ''
  return (
    <StrengthMeter
      id={id}
      data-pwmeter
      data-state={`pw-${strength}`}
      strength={strength}
      label={labels.strengthLabel}
      valueLabel={word || undefined}
    >
      {showChecklist && (
        <PasswordChecklist
          value={value}
          rules={rules}
          title=""
          columns={checklistColumns}
          metLabel={metLabel}
          unmetLabel={unmetLabel}
          highlightUnmet={highlightUnmet}
        />
      )}
      {children}
    </StrengthMeter>
  )
}
