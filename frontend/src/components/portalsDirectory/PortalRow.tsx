import type { AdminPortal } from '../../services/adminPortalsService'
import { PortalCard } from './PortalCard'

/**
 * A single portal directory list item — the `role="listitem"` wrapper +
 * `data-portal` / `data-status` / `data-tier` test hooks
 * (design/frames/portals-directory testHooks), around the presentational
 * `PortalCard`.
 */
export function PortalRow({
  portal,
  canOpen,
}: {
  portal: AdminPortal
  canOpen: boolean
}) {
  return (
    <div
      className="pd-row"
      role="listitem"
      data-portal={portal.id}
      data-status={portal.status}
      data-tier={portal.identity_mode}
      data-can-open={canOpen ? 'true' : 'false'}
    >
      <PortalCard portal={portal} canOpen={canOpen} />
    </div>
  )
}
