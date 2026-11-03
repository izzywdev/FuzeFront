import React from 'react'
import { Input } from '@fuzefront/design-system'
import { AUTH_INPUT_STYLE } from '../controlStyles'
import { DEFAULT_SIGNUP_LABELS, type SignUpLabels } from '../signup/labels'

export interface FullNameFieldProps {
  value: string
  onChange: (value: string) => void
  id?: string
  name?: string
  disabled?: boolean
  labels?: Partial<SignUpLabels>
}

/**
 * ONE optional full-name input (replaces the former first/last pair).
 *
 * `autoComplete="name"` maps 1:1 to the identity store's single `name` field.
 * There is deliberately NO given/family split: that preserves mononyms and
 * family-name-first ordering, and any script. It is OPTIONAL — an empty value is
 * never an error and never blocks submit. Label + help are localizable; the
 * field is a plain single-column input, so it mirrors under `dir="rtl"`.
 * Test hook: `data-field="full-name"`.
 */
export function FullNameField({
  value,
  onChange,
  id = 'fzf-signup-fullName',
  name = 'fullName',
  disabled,
  labels: overrides,
}: FullNameFieldProps) {
  const labels = { ...DEFAULT_SIGNUP_LABELS, ...overrides }
  const helpId = `${id}-help`
  return (
    <div className="fzf-su-field">
      <Input
        id={id}
        name={name}
        type="text"
        data-field="full-name"
        autoComplete="name"
        label={
          <span data-i18n="auth.signup.fullName.label">
            {labels.fullNameLabel}{' '}
            <span className="fzf-su-optional">{labels.fullNameOptional}</span>
          </span>
        }
        placeholder={labels.fullNamePlaceholder}
        value={value}
        disabled={disabled}
        aria-describedby={helpId}
        style={AUTH_INPUT_STYLE}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
      />
      <p className="fzf-su-help" id={helpId} data-i18n="auth.signup.fullName.help">
        {labels.fullNameHelp}
      </p>
    </div>
  )
}
