import { RoleBadge, Avatar } from '@fuzefront/design-system'
import { useIdentityI18n } from '../../i18n/IdentityI18nProvider'
import { formatDate } from '../common/dates'
import type { DirectoryMember } from '../../api/directoryClient'

export interface DirectoryRowProps {
  member: DirectoryMember
}

const cellStyle = {
  padding: 'var(--space-3) var(--space-4)',
  borderBottom: '1px solid var(--border-color)',
  verticalAlign: 'middle' as const,
}

/**
 * One directory member row — `data-user="{userId}"` (01-directory.html).
 * The caller's own row also carries the `data-self` "You" badge next to
 * their name, never re-labelling the row itself.
 */
export function DirectoryRow({ member }: DirectoryRowProps) {
  const { messages, locale } = useIdentityI18n()
  const m = messages.directory

  return (
    <tr data-user={member.userId}>
      <td style={cellStyle}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <Avatar name={member.displayName} email={member.email} size="sm" />
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--text-sm)',
              color: 'var(--text-primary)',
            }}
          >
            {member.displayName}
            {member.isSelf && (
              <span
                data-self
                style={{
                  fontFamily: 'var(--font-sans)',
                  fontSize: 'var(--text-2xs)',
                  fontWeight: 'var(--weight-semibold)',
                  color: 'var(--accent-color)',
                  background: 'var(--accent-soft)',
                  padding: '2px var(--space-2)',
                  borderRadius: 'var(--radius-pill)',
                }}
              >
                {m.you}
              </span>
            )}
          </span>
        </span>
      </td>
      <td style={{ ...cellStyle, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
        {member.email ?? '—'}
      </td>
      <td style={{ ...cellStyle, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xs)', color: 'var(--text-tertiary)' }}>
        {formatDate(member.joinedAt ?? null, locale) ?? '—'}
      </td>
      <td style={cellStyle}>
        <RoleBadge role={member.role} data-role={member.role} />
      </td>
    </tr>
  )
}
