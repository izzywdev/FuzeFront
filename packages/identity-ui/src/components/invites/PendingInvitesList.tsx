import React, { useState } from 'react'
import { DataTable, RoleBadge, StatusPill, Button } from '@fuzefront/design-system'
import { useIdentityI18n } from '../../i18n/IdentityI18nProvider'
import { EmptyState } from '../common/EmptyState'
import { formatDate, isExpired } from '../common/dates'
import type { Invitation, OrgRole } from '../../types'

export interface PendingInvitesListProps {
  invitations: Invitation[]
  loading?: boolean
  error?: string | null
  userRole: OrgRole
  onResend: (invitationId: string) => Promise<void>
  onRevoke: (invitationId: string) => Promise<void>
  onRetry?: () => void
}

/**
 * Pending invitations table with per-row resend and revoke. Revoke optimistically
 * hides the row; expired invitations show an error status pill.
 */
export function PendingInvitesList({
  invitations,
  loading,
  error,
  userRole,
  onResend,
  onRevoke,
  onRetry,
}: PendingInvitesListProps) {
  const { messages, locale } = useIdentityI18n()
  const inv = messages.invitations
  const canManage = userRole === 'owner' || userRole === 'admin'
  const [busy, setBusy] = useState<Record<string, 'resend' | 'revoke'>>({})
  const [hidden, setHidden] = useState<Set<string>>(new Set())

  const columns = [
    { key: 'email', header: inv.email },
    { key: 'role', header: inv.role },
    { key: 'invited', header: inv.invited },
    { key: 'expires', header: inv.expires },
    ...(canManage ? [{ key: 'actions', header: messages.common.actions, align: 'right' as const }] : []),
  ]

  if (error) {
    return <EmptyState variant="error" message={error} actionLabel={messages.common.retry} onAction={onRetry} />
  }

  const visible = invitations.filter((i) => !hidden.has(i.id))

  async function handleResend(id: string) {
    setBusy((b) => ({ ...b, [id]: 'resend' }))
    try {
      await onResend(id)
    } finally {
      setBusy((b) => {
        const next = { ...b }
        delete next[id]
        return next
      })
    }
  }

  async function handleRevoke(id: string) {
    setBusy((b) => ({ ...b, [id]: 'revoke' }))
    setHidden((h) => new Set(h).add(id)) // optimistic
    try {
      await onRevoke(id)
    } catch {
      setHidden((h) => {
        const next = new Set(h)
        next.delete(id)
        return next
      })
    } finally {
      setBusy((b) => {
        const next = { ...b }
        delete next[id]
        return next
      })
    }
  }

  const cellStyle: React.CSSProperties = {
    padding: 'var(--space-3) var(--space-4)',
    fontFamily: 'var(--font-sans)',
    fontSize: 'var(--text-sm)',
    color: 'var(--text-primary)',
    borderBottom: '1px solid var(--border-color)',
    verticalAlign: 'middle',
  }

  return (
    <DataTable
      columns={columns}
      loading={loading}
      emptyState={<EmptyState variant="no-pending" title={inv.emptyTitle} message={inv.emptyBody} />}
    >
      {visible.length > 0 && (
        <tbody>
          {visible.map((invitation) => {
            const expired = isExpired(invitation.expires_at)
            const rowBusy = busy[invitation.id]
            return (
              <tr key={invitation.id} style={{ opacity: rowBusy ? 0.7 : 1 }}>
                <td style={cellStyle}>{invitation.email}</td>
                <td style={cellStyle}><RoleBadge role={invitation.role} /></td>
                <td style={{ ...cellStyle, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xs)', color: 'var(--text-tertiary)' }}>
                  {formatDate(invitation.created_at, locale) ?? '—'}
                </td>
                <td style={cellStyle}>
                  {expired ? (
                    <StatusPill status="offline" label={inv.expired} />
                  ) : (
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xs)', color: 'var(--text-tertiary)' }}>
                      {formatDate(invitation.expires_at, locale) ?? inv.never}
                    </span>
                  )}
                </td>
                {canManage && (
                  <td style={{ ...cellStyle, textAlign: 'right' }}>
                    <span style={{ display: 'inline-flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
                      <Button variant="ghost" size="sm" disabled={!!rowBusy} onClick={() => handleResend(invitation.id)}>
                        {inv.resend}
                      </Button>
                      <Button variant="danger" size="sm" disabled={!!rowBusy} onClick={() => handleRevoke(invitation.id)}>
                        {inv.revoke}
                      </Button>
                    </span>
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      )}
    </DataTable>
  )
}
