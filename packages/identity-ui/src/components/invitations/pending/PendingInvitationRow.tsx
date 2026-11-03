import { Button } from '@fuzefront/design-system'
import { useIdentityI18n } from '../../../i18n/IdentityI18nProvider'
import type { OrgInvitation } from '../../../api/invitationsClient'
import {
  ChannelChip,
  InvitationRoleTag,
  MemberTypeTag,
  inviteeAddress,
  inviteeChannel,
} from '../shared/InviteTags'
import { relativeFromNow } from '../shared/time'
import { InviteStatusPill } from './InviteStatusPill'
import { ResendInviteButton } from './ResendInviteButton'

/**
 * One invitation: address (+ channel), role + member-type tags, who/when/expiry,
 * a status pill, and resend / revoke. Tags key to the invitation record — never
 * hard-coded. `[data-invitation="<id>"]` with `[data-status]`.
 */
export function PendingInvitationRow({
  invitation,
  currentUserId,
  canManage,
  busy,
  cooldownUntil,
  onResend,
  onRevoke,
}: {
  invitation: OrgInvitation
  /** The signed-in user's id, to render "invited by you". */
  currentUserId?: string
  canManage: boolean
  busy?: 'resend' | 'revoke'
  cooldownUntil?: number
  onResend: () => void
  onRevoke: () => void
}) {
  const { messages, locale, t } = useIdentityI18n()
  const p = messages.invitationsV2.pending
  const address = inviteeAddress(invitation.invitee)
  const channel = inviteeChannel(invitation.invitee)
  const expired = invitation.status === 'expired'
  const created = relativeFromNow(invitation.createdAt, locale)
  const expiry = relativeFromNow(invitation.expiresAt, locale)
  const inviter =
    invitation.invitedByUserId && invitation.invitedByUserId === currentUserId
      ? p.byYou
      : invitation.invitedByUserId
        ? t(p.invitedBy, { name: invitation.invitedByUserId })
        : null
  const active = invitation.status === 'pending'

  return (
    <div
      data-invitation={invitation.id}
      data-status={invitation.status}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--space-4)',
        flexWrap: 'wrap',
        padding: 'var(--space-4) var(--space-5)',
        borderBlockStart: '1px solid var(--border-color)',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', minInlineSize: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
          <span
            data-value="address"
            style={{
              fontSize: 'var(--text-sm)',
              fontWeight: 'var(--weight-medium)',
              color: 'var(--text-primary)',
              overflowWrap: 'anywhere',
            }}
          >
            {address}
          </span>
          <InvitationRoleTag role={invitation.role} />
          <MemberTypeTag memberType={invitation.memberType} />
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 'var(--space-2)',
            fontSize: 'var(--text-xs)',
            color: 'var(--text-tertiary)',
          }}
        >
          <ChannelChip channel={channel} />
          {inviter ? <span>· {inviter}</span> : null}
          {created ? <span>· {created}</span> : null}
          {expiry ? (
            <span>· {t(expired ? p.expiredAgo : p.expiresIn, { when: expiry })}</span>
          ) : null}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <InviteStatusPill status={invitation.status} />
        {canManage && active && (
          <>
            <ResendInviteButton
              invitationId={invitation.id}
              busy={busy !== undefined}
              cooldownUntil={cooldownUntil}
              onResend={onResend}
            />
            <Button
              variant="ghost"
              size="sm"
              data-action="revoke"
              data-for={invitation.id}
              disabled={busy !== undefined}
              onClick={onRevoke}
              style={{ color: 'var(--error-color)' }}
            >
              {p.revoke}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
