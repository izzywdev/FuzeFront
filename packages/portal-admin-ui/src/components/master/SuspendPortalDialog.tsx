import { Button, Modal } from '@fuzefront/design-system'
import type { AdminPortal } from '../../types'

export interface SuspendPortalDialogProps {
  portal: AdminPortal | null
  submitting?: boolean
  onCancel: () => void
  onConfirm: (portal: AdminPortal) => void
}

/**
 * Suspend confirmation (frame 04-master-states, d4). The platform root org
 * is never returned by `GET /api/v1/security/portals` (see
 * `MasterAdminPortalsFlow`'s module doc), so every portal reaching this
 * dialog is a real, suspendable tenant — the frame's separate root-guard
 * state (d5, `ROOT_PORTAL_PROTECTED`) has no reachable counterpart in this
 * UI under the real org-tree contract and is intentionally not reproduced
 * here.
 */
export function SuspendPortalDialog({ portal, submitting, onCancel, onConfirm }: SuspendPortalDialogProps) {
  if (!portal) return null

  return (
    <Modal open={Boolean(portal)} onClose={onCancel} title={`Suspend ${portal.name}?`}>
      <div data-panel="suspend-portal" data-state="confirm">
        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }} className="danger-note">
          Suspending <strong>immediately blocks every sign-in</strong> to this portal — its users,
          its apps, its billing. Existing sessions are ended. Data is retained; you can resume it
          later.
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', marginTop: 'var(--space-4)' }}>
          <Button variant="ghost" data-action="cancel" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            data-action="confirm-suspend-portal"
            data-target={portal.orgId}
            disabled={submitting}
            onClick={() => onConfirm(portal)}
          >
            {submitting ? 'Suspending…' : 'Suspend portal'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
