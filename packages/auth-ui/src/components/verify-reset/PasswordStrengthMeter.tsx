import React from 'react'
import { PasswordChecklist } from '@fuzefront/design-system'
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

const BARS: Record<PasswordStrength, number> = { empty: 0, weak: 1, fair: 2, good: 3, strong: 4 }

export interface PasswordStrengthMeterProps {
  value: string
  rules?: Rule[]
  labels?: Partial<VerifyResetLabels>
  /** Also render the per-rule checklist (DS PasswordChecklist). Default true. */
  showChecklist?: boolean
}

export function PasswordStrengthMeter({
  value,
  rules,
  labels: overrides,
  showChecklist = true,
}: PasswordStrengthMeterProps) {
  const labels = { ...DEFAULT_VERIFY_RESET_LABELS, ...overrides }
  const strength = scorePassword(value, rules)
  const on = BARS[strength]
  const word =
    strength === 'weak' ? labels.strengthWeak
    : strength === 'fair' ? labels.strengthFair
    : strength === 'good' ? labels.strengthGood
    : strength === 'strong' ? labels.strengthStrong
    : ''
  return (
    <div className="fzf-pwmeter" data-pwmeter data-strength={strength}>
      <div className="fzf-pwmeter__bars" aria-hidden="true">
        {[1, 2, 3, 4].map(i => (
          <span key={i} className={`fzf-pwmeter__bar${i <= on ? ' fzf-pwmeter__bar--on' : ''}`} />
        ))}
      </div>
      <div className="fzf-pwmeter__label" aria-live="polite">
        <span>{labels.strengthLabel}</span>
        {word && <b>{word}</b>}
      </div>
      {showChecklist && <PasswordChecklist value={value} rules={rules} title="" />}
    </div>
  )
}
