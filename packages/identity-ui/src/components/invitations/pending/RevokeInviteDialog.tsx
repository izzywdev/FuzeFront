import { Button, Modal } from '@fuzefront/design-system'
import { useIdentityI18n } from '../../../i18n/IdentityI18nProvider'

/**
 * Confirm-before-revoke dialog. Revoking is irreversible (the link stops working
 * for good), so it is gated behind an explicit confirm naming the invitee.
 * `[data-panel="revoke-invite"]`, confirm `[data-action="confirm-revoke"]`.
 */
export function RevokeInviteDialog({
  open,
  address,
  busy = false,
  onConfirm,
  onClose,
}: {
  open: boolean
  address: string
  busy?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  const { messages, t } = useIdentityI18n()
  const p = messages.invitationsV2.pending
  return (
    <Modal open={open} onClose={busy ? undefined : onClose} title={p.revokeTitle} size="md">
      <div data-panel="revoke-invite" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
        <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
          {t(p.revokeBody, { address })}
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {messages.common.cancel}
          </Button>
          <Button variant="danger" data-action="confirm-revoke" onClick={onConfirm} disabled={busy}>
            {p.revokeConfirm}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
