import React, { useState } from 'react'
import { Modal, Button, Toast } from '@fuzefront/design-system'
import { useIdentityI18n } from '../../i18n/IdentityI18nProvider'

export interface RevokeConfirmDialogProps {
  open: boolean
  /** Title shown in the dialog header. */
  title?: string
  /** Confirmation prompt body. */
  message: string
  /** Label of the resource being revoked (rendered in mono for clarity). */
  subject?: string
  onCancel: () => void
  /** Performs the destructive action. The dialog handles loading/error. */
  onConfirm: () => Promise<void>
  confirmLabel?: string
}

/**
 * Destructive-action confirmation dialog. Idle → Loading → (closes on success)
 * or Error toast in place. Built on the design-system Modal + danger Button.
 */
export function RevokeConfirmDialog({
  open,
  title,
  message,
  subject,
  onCancel,
  onConfirm,
  confirmLabel,
}: RevokeConfirmDialogProps) {
  const { messages } = useIdentityI18n()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const descId = 'revoke-desc'

  async function handleConfirm() {
    setError(null)
    setLoading(true)
    try {
      await onConfirm()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed')
      setLoading(false)
    }
  }

  function handleCancel() {
    if (loading) return
    setError(null)
    onCancel()
  }

  if (!open) return null

  return (
    <Modal open={open} onClose={handleCancel} title={title} size="md">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {error && <Toast level="error" message={error} />}
        <p
          id={descId}
          style={{ margin: 0, fontFamily: 'var(--font-sans)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}
        >
          {message}
        </p>
        {subject && (
          <code
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-xs)',
              color: 'var(--text-primary)',
              background: 'var(--bg-quaternary)',
              padding: 'var(--space-2) var(--space-3)',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            {subject}
          </code>
        )}
        <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={handleCancel} disabled={loading}>
            {messages.common.cancel}
          </Button>
          <Button
            variant="danger"
            onClick={handleConfirm}
            disabled={loading}
            aria-describedby={descId}
          >
            {confirmLabel ?? messages.common.confirm}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
