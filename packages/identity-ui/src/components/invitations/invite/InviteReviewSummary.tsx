import { useIdentityI18n } from '../../../i18n/IdentityI18nProvider'
import type { InvitationChannel, InvitationRole, MemberType } from '../../../api/invitationsClient'
import { ChannelChip, InvitationRoleTag, MemberTypeTag } from '../shared/InviteTags'

/**
 * Live review of what is about to be sent: address + channel, then role + member
 * type. An `aria-live="polite"` region so changes are announced. Shows a hint
 * (not a half-filled summary) until a valid address exists.
 * `[data-panel="invite-preview"]` (or the caller's `panel`, e.g. `customer-preview`).
 */
export function InviteReviewSummary({
  address,
  channel,
  role,
  memberType,
  panel = 'invite-preview',
}: {
  /** The validated address, or `null` while the form is incomplete. */
  address: string | null
  channel: InvitationChannel | 'account'
  role: InvitationRole
  memberType: MemberType
  panel?: string
}) {
  const { messages } = useIdentityI18n()
  const m = messages.invitationsV2.invite
  return (
    <div
      data-panel={panel}
      aria-live="polite"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
        padding: 'var(--space-4)',
        background: 'var(--bg-quaternary)',
        border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-md)',
        fontSize: 'var(--text-sm)',
      }}
    >
      {address ? (
        <>
          <Row label={m.reviewInvite}>
            <span data-review="address" style={{ color: 'var(--text-primary)', fontWeight: 'var(--weight-medium)' }}>
              {address}
            </span>
            <ChannelChip channel={channel} />
          </Row>
          <Row label={m.reviewAs}>
            <span data-review="role">
              <InvitationRoleTag role={role} />
            </span>
            <span data-review="member-type">
              <MemberTypeTag memberType={memberType} />
            </span>
          </Row>
        </>
      ) : (
        <span style={{ color: 'var(--text-tertiary)' }}>{m.reviewIncomplete}</span>
      )}
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
      <span style={{ minInlineSize: '4rem', color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)' }}>{label}</span>
      {children}
    </div>
  )
}
