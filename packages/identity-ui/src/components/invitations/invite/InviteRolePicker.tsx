import { useId } from 'react'
import { useIdentityI18n } from '../../../i18n/IdentityI18nProvider'
import type { InvitationRole } from '../../../api/invitationsClient'

const ALL_ROLES: InvitationRole[] = ['admin', 'member', 'viewer']

/**
 * Role radios (admin | member | viewer). `owner` is never offered — ownership is
 * held by the org creator and transferred, not invited. A native radio group
 * (arrow keys, one tab stop) with a described option card per role.
 * `[data-field="role"]`, each option `[data-role-option="<role>"]`.
 */
export function InviteRolePicker({
  value,
  onChange,
  roles = ALL_ROLES,
  descriptions,
  showOwnerHint = true,
}: {
  value: InvitationRole
  onChange: (role: InvitationRole) => void
  /** Subset to offer (the root customer surface offers member | viewer). */
  roles?: InvitationRole[]
  /** Per-role description overrides. */
  descriptions?: Partial<Record<InvitationRole, string>>
  showOwnerHint?: boolean
}) {
  const { messages } = useIdentityI18n()
  const m = messages.invitationsV2.invite
  const name = useId()
  const desc: Record<InvitationRole, string> = {
    admin: m.roleAdminDesc,
    member: m.roleMemberDesc,
    viewer: m.roleViewerDesc,
    ...descriptions,
  }
  return (
    <fieldset
      data-field="role"
      style={{ border: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}
    >
      <legend
        style={{
          padding: 0,
          marginBlockEnd: 'var(--space-2)',
          fontSize: 'var(--text-sm)',
          fontWeight: 'var(--weight-medium)',
          color: 'var(--text-secondary)',
        }}
      >
        {m.roleLabel}
        <span aria-hidden="true" style={{ color: 'var(--error-color)' }}> *</span>
      </legend>
      {roles.map((role) => {
        const selected = role === value
        return (
          <label
            key={role}
            data-role-option={role}
            data-selected={selected ? 'true' : 'false'}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 'var(--space-3)',
              padding: 'var(--space-3) var(--space-4)',
              background: selected ? 'var(--accent-soft)' : 'var(--bg-secondary)',
              border: `1px solid ${selected ? 'var(--accent-color)' : 'var(--border-color)'}`,
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
            }}
          >
            <input
              type="radio"
              name={name}
              value={role}
              checked={selected}
              onChange={() => onChange(role)}
              style={{ marginBlockStart: 'var(--space-1)', accentColor: 'var(--accent-color)' }}
            />
            <span style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
              <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--text-primary)' }}>
                {messages.roles[role]}
              </span>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{desc[role]}</span>
            </span>
          </label>
        )
      })}
      {showOwnerHint && (
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{m.roleOwnerHint}</span>
      )}
    </fieldset>
  )
}
