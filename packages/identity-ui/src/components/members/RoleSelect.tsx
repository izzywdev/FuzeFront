import { Select } from '@fuzefront/design-system'
import { useIdentityI18n } from '../../i18n/IdentityI18nProvider'
import type { OrgRole } from '../../types'

export interface RoleSelectProps {
  value: OrgRole
  /** Caller's role — gates whether the control is editable. */
  callerRole: OrgRole
  onChange: (role: OrgRole) => void
  disabled?: boolean
}

/** Roles that may be assigned via the UI (owner is not assignable here). */
const ASSIGNABLE: OrgRole[] = ['admin', 'member', 'viewer']

/**
 * Inline role assignment select mapping to Permit roles. Disabled when the
 * caller is a `viewer`, when the target member is an `owner`, or when the
 * `disabled` prop is set. Wraps the design-system Select.
 */
export function RoleSelect({ value, callerRole, onChange, disabled }: RoleSelectProps) {
  const { messages } = useIdentityI18n()
  const gated = disabled || callerRole === 'viewer' || value === 'owner'

  // Keep the current value selectable even if it's `owner` (read-only display).
  const options = (value === 'owner' ? (['owner', ...ASSIGNABLE] as OrgRole[]) : ASSIGNABLE).map((role) => ({
    value: role,
    label: messages.roles[role],
  }))

  return (
    <Select
      value={value}
      disabled={gated}
      aria-label={messages.members.role}
      options={options}
      onChange={(e) => onChange(e.target.value as OrgRole)}
    />
  )
}
