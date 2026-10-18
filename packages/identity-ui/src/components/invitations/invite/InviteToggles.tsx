import { SegmentedControl } from '@fuzefront/design-system'
import { useIdentityI18n } from '../../../i18n/IdentityI18nProvider'
import type { InvitationChannel, MemberType } from '../../../api/invitationsClient'
import { ChannelGlyph } from '../shared/InviteTags'

export type InviteeKind = 'existing' | 'external'

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
      onChange={onChange}
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
      onChange={onChange}
      options={[
        { value: 'email', label: m.channelEmail, icon: <ChannelGlyph channel="email" /> },
        { value: 'whatsapp', label: m.channelWhatsapp, icon: <ChannelGlyph channel="whatsapp" /> },
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
      onChange={onChange}
      disabled={locked}
      options={locked ? all.filter((o) => o.value === value) : all}
    />
  )
}
