import { StatusPill } from '@fuzefront/design-system'
import { useIdentityI18n } from '../../../i18n/IdentityI18nProvider'
import type { InvitationStatus } from '../../../api/invitationsClient'

/**
 * Invitation lifecycle pill (dot + label, never colour-only). `pending` is shown
 * as "Sent" — the invitation has been dispatched and awaits the invitee.
 */
export function InviteStatusPill({ status }: { status: InvitationStatus }) {
  const { messages } = useIdentityI18n()
  const p = messages.invitationsV2.pending
  switch (status) {
    case 'accepted':
      return <StatusPill status="active" label={p.statusAccepted} data-status={status} />
    case 'revoked':
      return <StatusPill status="disabled" label={p.statusRevoked} data-status={status} />
    case 'expired':
      return <StatusPill status="expired" label={p.statusExpired} data-status={status} />
    default:
      return <StatusPill status="invited" label={p.statusSent} data-status={status} />
  }
}
