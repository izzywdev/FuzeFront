import React from 'react'
import { Input } from '@fuzefront/design-system'
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

/** Confirm-password input with a live match state (`data-match`) and an inline error once the user has typed. */
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
    <Input
      id={id}
      name={name}
      type="password"
      label={label ?? labels.confirmPasswordLabel}
      autoComplete="new-password"
      value={value}
      onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
      data-match={typed ? String(matches) : undefined}
      error={typed && !matches ? labels.mismatch : ''}
    />
  )
}
