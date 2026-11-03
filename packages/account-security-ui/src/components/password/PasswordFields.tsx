import { Input, PasswordChecklist, PasswordStrengthMeter as DsMeter } from '@fuzefront/design-system'
import { useAccountSecurityI18n } from '../../i18n/AccountSecurityI18nProvider'

/** Translated policy rules (ids match the DS `DEFAULT_PASSWORD_RULES`). */
function useTranslatedRules() {
  const { messages: m } = useAccountSecurityI18n()
  const labels: Record<string, string> = {
    length: m.password.policy.length,
    upper: m.password.policy.upper,
    lower: m.password.policy.lower,
    digit: m.password.policy.digit,
    symbol: m.password.policy.symbol,
  }
  return PasswordChecklist.rules.map((r) => ({ ...r, label: labels[r.id] ?? r.label }))
}

/** Live policy checklist for the entered password (PasswordPolicyHints). */
export function PasswordPolicyHints({ value }: { value: string }) {
  const { messages: m } = useAccountSecurityI18n()
  const rules = useTranslatedRules()
  return (
    <div data-policy-hints>
      <PasswordChecklist value={value} rules={rules} title={m.password.policy.title} />
    </div>
  )
}

/** Translated strength meter (PasswordStrengthMeter). */
export function PasswordStrengthMeter({ value }: { value: string }) {
  const { messages: m } = useAccountSecurityI18n()
  return (
    <DsMeter
      value={value}
      rules={useTranslatedRules()}
      label={m.password.strength.label}
      labels={{
        empty: m.password.strength.empty,
        weak: m.password.strength.weak,
        fair: m.password.strength.fair,
        good: m.password.strength.good,
        strong: m.password.strength.strong,
      }}
    />
  )
}

export interface PasswordFieldsProps {
  newLabel: string
  confirmLabel: string
  value: string
  confirm: string
  onValue: (v: string) => void
  onConfirm: (v: string) => void
  /** Hook names (frames differ: change uses new/confirm, set uses set-password/set-confirm). */
  newHook: string
  confirmHook: string
  newError?: string
  confirmError?: string
  disabled?: boolean
  /** Hook for the policy field-error wrapper (e.g. `password-policy`). */
  policyErrorHook?: boolean
  showMeter?: boolean
}

/** New-password + confirm pair with the live meter and policy hints. */
export function PasswordFields({
  newLabel,
  confirmLabel,
  value,
  confirm,
  onValue,
  onConfirm,
  newHook,
  confirmHook,
  newError,
  confirmError,
  disabled,
  policyErrorHook,
  showMeter = true,
}: PasswordFieldsProps) {
  return (
    <>
      <div
        data-error={newError && policyErrorHook ? 'password-policy' : undefined}
        data-field-error={newError ? 'new-password' : undefined}
        style={{ marginBlockStart: 'var(--space-4)' }}
      >
        <Input
          label={newLabel}
          type="password"
          autoComplete="new-password"
          value={value}
          onChange={(e) => onValue(e.target.value)}
          error={newError}
          disabled={disabled}
          data-input={newHook}
        />
      </div>
      {showMeter && (
        <div style={{ marginBlockStart: 'var(--space-3)' }}>
          <PasswordStrengthMeter value={value} />
          <PasswordPolicyHints value={value} />
        </div>
      )}
      <div
        data-field-error={confirmError ? 'confirm-password' : undefined}
        style={{ marginBlockStart: 'var(--space-4)' }}
      >
        <Input
          label={confirmLabel}
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => onConfirm(e.target.value)}
          error={confirmError}
          disabled={disabled}
          data-input={confirmHook}
        />
      </div>
    </>
  )
}
