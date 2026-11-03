import type { ReactNode } from 'react'
import { SegmentedControl } from '@fuzefront/design-system'
import { useIdentityI18n } from '../../../i18n/IdentityI18nProvider'
import type { InvitationChannel, MemberType } from '../../../api/invitationsClient'
import { ChannelGlyph } from '../shared/InviteTags'

export type InviteeKind = 'existing' | 'external'

/** A segment label with a leading decorative glyph (the DS SegmentedControl takes a label node only). */
function withGlyph(glyph: ReactNode, text: string): ReactNode {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
      {glyph}
      {text}
    </span>
  )
}

/** Existing account-holder vs external person. `[data-field="invitee-kind"]`. */
export function InviteeKindToggle({
  value,
  onChange,
  existingDisabled = false,
}: {
  value: InviteeKind
  onChange: (kind: InviteeKind) => void
  /** Disable "existing" when the host cannot search accounts (see `searchAccounts`). */
  existingDisabled?: boolean
}) {
  const { messages } = useIdentityI18n()
  const m = messages.invitationsV2.invite
  return (
    <SegmentedControl
      data-field="invitee-kind"
      ariaLabel={m.kindLabel}
      value={value}
      onChange={(v) => onChange(v as InviteeKind)}
      options={[
        { value: 'existing', label: m.kindExisting, disabled: existingDisabled },
        { value: 'external', label: m.kindExternal },
      ]}
    />
  )
}

/** Email vs WhatsApp delivery channel. `[data-field="channel"]`. */
export function InviteChannelToggle({
  value,
  onChange,
}: {
  value: InvitationChannel
  onChange: (channel: InvitationChannel) => void
}) {
  const { messages } = useIdentityI18n()
  const m = messages.invitationsV2.invite
  return (
    <SegmentedControl
      data-field="channel"
      ariaLabel={m.channelLabel}
      value={value}
      onChange={(v) => onChange(v as InvitationChannel)}
      options={[
        { value: 'email', label: withGlyph(<ChannelGlyph channel="email" />, m.channelEmail) },
        { value: 'whatsapp', label: withGlyph(<ChannelGlyph channel="whatsapp" />, m.channelWhatsapp) },
      ]}
    />
  )
}

/**
 * Employee vs customer. `[data-field="member-type"]`. When `locked`, the control
 * is inert (`aria-disabled`) and shows only the fixed value — the root-customer
 * surface fixes it to Customer.
 */
export function MemberTypeToggle({
  value,
  onChange,
  locked = false,
}: {
  value: MemberType
  onChange?: (memberType: MemberType) => void
  locked?: boolean
}) {
  const { messages } = useIdentityI18n()
  const m = messages.invitationsV2.invite
  const all = [
    { value: 'employee' as const, label: m.memberEmployee },
    { value: 'customer' as const, label: m.memberCustomer },
  ]
  return (
    <SegmentedControl
      data-field="member-type"
      ariaLabel={m.memberTypeLabel}
      value={value}
      onChange={(v) => onChange?.(v as MemberType)}
      disabled={locked}
      aria-disabled={locked || undefined}
      options={locked ? all.filter((o) => o.value === value) : all}
    />
  )
}
