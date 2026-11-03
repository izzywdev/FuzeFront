import { Badge, RoleBadge } from '@fuzefront/design-system'
import { useIdentityI18n } from '../../../i18n/IdentityI18nProvider'
import type { InvitationChannel, InvitationRole, InviteeRef, MemberType } from '../../../api/invitationsClient'

/** Role tag for an invitation (admin | member | viewer — `owner` is never invitable). */
export function InvitationRoleTag({ role, hook }: { role: InvitationRole; hook?: string }) {
  return <RoleBadge role={role} data-role={role} data-value={hook} />
}

/**
 * Member-type tag (employee | customer) — orthogonal to the access role. Always
 * a labelled badge (never colour-only), keyed to the invitation/membership
 * record, never hard-coded.
 */
export function MemberTypeTag({ memberType, hook }: { memberType: MemberType; hook?: string }) {
  const { messages } = useIdentityI18n()
  const m = messages.invitationsV2.invite
  return (
    <Badge
      tone={memberType === 'customer' ? 'success' : 'info'}
      dot
      data-member-type={memberType}
      data-value={hook}
    >
      {memberType === 'customer' ? m.memberCustomer : m.memberEmployee}
    </Badge>
  )
}

/** Decorative channel glyph (email envelope | WhatsApp bubble | account person). */
export function ChannelGlyph({ channel }: { channel: InvitationChannel | 'account' }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    style: { flex: 'none' as const },
  }
  if (channel === 'whatsapp') {
    return (
      <svg {...common}>
        <path d="M12 3a9 9 0 00-7.8 13.5L3 21l4.7-1.2A9 9 0 1012 3z" />
      </svg>
    )
  }
  if (channel === 'account') {
    return (
      <svg {...common}>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21v-1a6 6 0 016-6h4a6 6 0 016 6v1" />
      </svg>
    )
  }
  return (
    <svg {...common}>
      <path d="M4 6h16v12H4z" />
      <path d="M4 7l8 6 8-6" />
    </svg>
  )
}

/** Channel chip: glyph + localized channel name. */
export function ChannelChip({ channel }: { channel: InvitationChannel | 'account' }) {
  const { messages } = useIdentityI18n()
  const p = messages.invitationsV2.pending
  const label =
    channel === 'whatsapp' ? p.channelWhatsapp : channel === 'account' ? p.existingAccount : p.channelEmail
  return (
    <span
      data-channel={channel}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--space-1)',
        color: 'var(--text-secondary)',
        fontSize: 'var(--text-xs)',
      }}
    >
      <ChannelGlyph channel={channel} />
      {label}
    </span>
  )
}

/** The human-facing address of an invitee (unmasked — only the org's admins see this). */
export function inviteeAddress(invitee: InviteeRef): string {
  if (invitee.kind === 'account') return invitee.userId
  return invitee.channel === 'whatsapp' ? (invitee.phone ?? '') : (invitee.email ?? '')
}

/** The channel to show for an invitee (an existing account has no external channel). */
export function inviteeChannel(invitee: InviteeRef): InvitationChannel | 'account' {
  return invitee.kind === 'account' ? 'account' : invitee.channel
}
