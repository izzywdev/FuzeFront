import React from 'react'
import { InlineValidatedInput } from '@fuzefront/design-system'
import { AUTH_INPUT_STYLE } from '../controlStyles'
import { DEFAULT_VERIFY_RESET_LABELS, type VerifyResetLabels } from './types'

export interface PasswordConfirmFieldProps {
  password: string
  value: string
  onChange: (value: string) => void
  name?: string
  id?: string
  label?: string
  labels?: Partial<VerifyResetLabels>
}

/**
 * Confirm-password input with a live match state. Nothing is shown until the user
 * has typed; then `data-match="true"` (success ring + check + "Passwords match.")
 * or `data-match="false"` (error ring, `aria-invalid`, inline "don't match" message).
 */
export function PasswordConfirmField({
  password,
  value,
  onChange,
  name = 'confirm',
  id = 'fzf-confirm-password',
  label,
  labels: overrides,
}: PasswordConfirmFieldProps) {
  const labels = { ...DEFAULT_VERIFY_RESET_LABELS, ...overrides }
  const typed = value.length > 0
  const matches = typed && value === password
  return (
    <InlineValidatedInput
      id={id}
      name={name}
      type="password"
      label={label ?? labels.confirmPasswordLabel}
      autoComplete="new-password"
      aria-required="true"
      style={AUTH_INPUT_STYLE}
      value={value}
      onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
      data-match={typed ? String(matches) : undefined}
      {...(typed && !matches ? { 'data-state': 'confirm-mismatch' } : {})}
      state={!typed ? 'idle' : matches ? 'valid' : 'invalid'}
      help={matches ? labels.matches : undefined}
      error={typed && !matches ? labels.mismatch : ''}
      showPasswordLabel={labels.showPassword}
      hidePasswordLabel={labels.hidePassword}
    />
  )
}
