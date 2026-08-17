import { Alert, Button, Modal } from '@fuzefront/design-system'
import type { Portal } from '../../types'

export interface SuspendPortalDialogProps {
  portal: Portal | null
  submitting?: boolean
  onCancel: () => void
  onConfirm: (portal: Portal) => void
}

/**
 * Suspend confirmation (frame 04-master-states, d4/d5). A root portal is
 * refused client-side (mirroring the server's `409 ROOT_PORTAL_PROTECTED`
 * guard) — the disabled control here is only the affordance; the row's own
 * Suspend button is already disabled for root portals (`PortalsTable`), so
 * reaching d5 at all requires the caller to have bypassed that client guard.
 */
export function SuspendPortalDialog({ portal, submitting, onCancel, onConfirm }: SuspendPortalDialogProps) {
  if (!portal) return null
  const isRoot = portal.isRoot

  return (
    <Modal open={Boolean(portal)} onClose={onCancel} title={isRoot ? "The root portal can't be suspended" : `Suspend ${portal.name}?`}>
      <div data-panel="suspend-portal" data-state={isRoot ? 'root-guard' : 'confirm'}>
        {isRoot ? (
          <Alert tone="warning" data-error-code="ROOT_PORTAL_PROTECTED">
            This is the FuzeFront root portal. Suspending it would take the whole platform — every
            tenant portal — offline. This action is blocked here and refused by the API
            (409 ROOT_PORTAL_PROTECTED). The disabled control is only the affordance; the server
            guarantees it.
          </Alert>
        ) : (
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }} className="danger-note">
            Suspending <strong>immediately blocks every sign-in</strong> to this portal — its users,
            its apps, its billing. Existing sessions are ended. Data is retained; you can resume it
            later.
          </p>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', marginTop: 'var(--space-4)' }}>
          <Button variant="ghost" data-action="cancel" onClick={onCancel}>
            {isRoot ? 'Close' : 'Cancel'}
          </Button>
          <Button
            variant="primary"
            data-action="confirm-suspend-portal"
            data-target={portal.id}
            disabled={isRoot || submitting}
            onClick={() => !isRoot && onConfirm(portal)}
          >
            {submitting ? 'Suspending…' : 'Suspend portal'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
