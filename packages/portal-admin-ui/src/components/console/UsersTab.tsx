import { Alert, Badge, Button, DataTable, EmptyState, StatusPill } from '@fuzefront/design-system'
import type { Invitation, OrgMember } from '../../types'

export interface UsersTabProps {
  state: 'loading' | 'ready' | 'error'
  members: OrgMember[]
  invitations: Invitation[]
  currentUserId?: string
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
  onInvite: () => void
  onResendInvite: (invitation: Invitation) => void
  onRevokeInvite: (invitation: Invitation) => void
  onRetry: () => void
}

function roleLabel(role: string): string {
  return role === 'owner' || role === 'admin' ? 'Portal admin' : 'Member'
}

const COLUMNS = [
  { key: 'person', header: 'Person' },
  { key: 'role', header: 'Role' },
  { key: 'status', header: 'Status' },
  { key: 'actions', header: 'Actions', align: 'right' as const },
]

/**
 * Users tab (frame 06-users). Members come from the real, portal-scoped
 * `GET /organizations/:id/members`; pending invitations from the real
 * `GET /organizations/:id/invitations`. Role EDITING has no backend endpoint
 * today (no `PUT .../members/{userId}/roles` exists on this monolith) — the
 * control is rendered, disabled, with an honest reason, rather than wired to
 * a call that would always fail. The self-lockout guard (you cannot change
 * your own role) still holds as a stricter, more specific reason on your own row.
 */
export function UsersTab({
  state,
  members,
  invitations,
  currentUserId,
  hasMore,
  loadingMore,
  onLoadMore,
  onInvite,
  onResendInvite,
  onRevokeInvite,
  onRetry,
}: UsersTabProps) {
  const total = members.length + invitations.length
  // A newly-provisioned portal has exactly one member (the admin themself)
  // and no invitations — a REAL empty state (frame 09-portal-states, i2),
  // not a one-row table.
  const isJustYou = members.length <= 1 && invitations.length === 0

  return (
    <div data-panel="portal-users" data-state={state} aria-busy={state === 'loading' || undefined}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
        <p style={{ margin: 0, color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>
          <span data-count="users">{total}</span> in this portal
          {invitations.length > 0 && (
            <>
              {' '}
              · <span data-count="invites">{invitations.length}</span> invite{invitations.length === 1 ? '' : 's'} pending
            </>
          )}
        </p>
        <Button variant="primary" data-action="invite-user" onClick={onInvite}>
          Invite user
        </Button>
      </div>

      {state === 'error' && (
        <div>
          <Alert tone="error" title="We couldn't load this" data-error-code="LOAD_FAILED">
            Something went wrong on our end. Your access hasn't changed — try again.
          </Alert>
          <div style={{ marginTop: 'var(--space-3)' }}>
            <Button variant="secondary" data-action="retry" onClick={onRetry}>
              Try again
            </Button>
          </div>
        </div>
      )}

      {state === 'ready' && isJustYou && (
        <EmptyState
          icon="👋"
          title="It's just you so far"
          body="You're the admin of this portal. Invite your team to give them access to the apps in your catalog."
          action={
            <Button variant="primary" data-action="invite-user" onClick={onInvite}>
              Invite your first teammate
            </Button>
          }
        />
      )}

      {(state === 'loading' || (state === 'ready' && !isJustYou)) && (
        <>
          <DataTable columns={COLUMNS} loading={state === 'loading'}>
            <tbody>
              {members.map(member => {
                const isSelf = member.user.id === currentUserId
                return (
                  <tr key={member.membershipId} data-user={member.user.id} data-self={isSelf ? 'true' : 'false'}>
                    <td style={{ padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--border-color)' }}>
                      <span style={{ color: 'var(--text-primary)' }}>{member.user.email}</span>
                      {isSelf && (
                        <span
                          style={{
                            marginInlineStart: 'var(--space-2)',
                            fontFamily: 'var(--font-mono)',
                            fontSize: 'var(--text-2xs)',
                            color: 'var(--text-tertiary)',
                            textTransform: 'uppercase',
                          }}
                        >
                          You
                        </span>
                      )}
                    </td>
                    <td style={{ padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--border-color)' }}>
                      <Badge tone={member.role === 'admin' || member.role === 'owner' ? 'accent' : 'neutral'} data-role-pill={member.role}>
                        {roleLabel(member.role)}
                      </Badge>
                    </td>
                    <td style={{ padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--border-color)' }}>
                      <StatusPill status="active" data-user-status="active" />
                    </td>
                    <td style={{ padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--border-color)', textAlign: 'right' }}>
                      <Button
                        variant="ghost"
                        size="sm"
                        data-action="change-role"
                        data-target={member.user.id}
                        disabled
                        title={isSelf ? "You can't change your own role" : 'Role management is not available yet'}
                      >
                        Change role
                      </Button>
                    </td>
                  </tr>
                )
              })}
              {invitations.map(invitation => (
                <tr key={invitation.id} data-invitation={invitation.id} data-user-status="invited">
                  <td style={{ padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--border-color)' }}>
                    <span style={{ color: 'var(--text-primary)' }}>{invitation.email}</span>
                  </td>
                  <td style={{ padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--border-color)' }}>
                    <Badge tone={invitation.role === 'admin' ? 'accent' : 'neutral'} data-role-pill={invitation.role}>
                      {roleLabel(invitation.role)}
                    </Badge>
                  </td>
                  <td style={{ padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--border-color)' }}>
                    <StatusPill status="invited" data-user-status="invited" />
                  </td>
                  <td style={{ padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--border-color)', textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: 'var(--space-2)' }}>
                      <Button variant="ghost" size="sm" data-action="resend-invite" data-target={invitation.id} onClick={() => onResendInvite(invitation)}>
                        Resend
                      </Button>
                      <Button variant="ghost" size="sm" data-action="revoke-invite" data-target={invitation.id} onClick={() => onRevokeInvite(invitation)}>
                        Revoke
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
          {hasMore && (
            <div style={{ marginTop: 'var(--space-3)', textAlign: 'center' }}>
              <Button variant="ghost" data-action="load-more" disabled={loadingMore} onClick={onLoadMore}>
                {loadingMore ? 'Loading…' : 'Load more'}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
