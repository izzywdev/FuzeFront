import { Button } from '@fuzefront/design-system'
import { useIdentityI18n } from '../../../i18n/IdentityI18nProvider'

/**
 * The Members-tab "Invite people" trigger. Opens the invite dialog
 * (`aria-haspopup="dialog"`). `[data-action="open-invite"]`.
 */
export function OrgInviteButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  const { messages } = useIdentityI18n()
  return (
    <Button
      variant="primary"
      data-action="open-invite"
      aria-haspopup="dialog"
      disabled={disabled}
      onClick={onClick}
    >
      ＋ {messages.invitationsV2.invite.button}
    </Button>
  )
}
