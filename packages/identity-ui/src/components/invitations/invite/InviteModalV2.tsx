import { Modal } from '@fuzefront/design-system'
import { useIdentityI18n } from '../../../i18n/IdentityI18nProvider'
import { InviteForm, type InviteFormProps } from './InviteForm'

export interface InviteModalV2Props
  extends Pick<
    InviteFormProps,
    'onSubmit' | 'onSent' | 'onDraftSaved' | 'searchAccounts' | 'defaultRole' | 'defaultMemberType'
  > {
  open: boolean
  onClose: () => void
  /** Org display name for the title ("Invite to {orgName}"). */
  orgName?: string
}

/**
 * The org Members-tab invite dialog (design/frames/org-invitations-v2/01-invite-modal.html):
 * invitee kind · channel · role · member type · live review · Send. Wraps the
 * shared `InviteForm` in the design-system `Modal` (focus trap, Escape, backdrop
 * close). The form is unmounted on close so a re-open starts clean.
 * `[data-panel="invite-modal"]`.
 */
export function InviteModalV2({ open, onClose, orgName = '', ...form }: InviteModalV2Props) {
  const { messages, t } = useIdentityI18n()
  const m = messages.invitationsV2.invite
  return (
    <Modal open={open} onClose={onClose} title={t(m.title, { orgName })} size="md">
      {open && (
        <div data-panel="invite-modal" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>{m.subtitle}</p>
          <InviteForm {...form} onCancel={onClose} showKind />
        </div>
      )}
    </Modal>
  )
}
