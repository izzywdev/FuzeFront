import type { AdminPortal } from '../../services/adminPortalsService'
import { PortalRow } from './PortalRow'

/**
 * The populated directory list (`[data-list="portals"]` per
 * design/frames/portals-directory's testHooks) — one `PortalRow` per portal.
 * Loading/empty/error/forbidden are separate sibling states the orchestrator
 * swaps in instead of this component; by the time `PortalsList` renders,
 * `portals` is a real, non-empty page.
 */
export function PortalsList({ portals }: { portals: AdminPortal[] }) {
  return (
    <div className="pd-dir" data-list="portals" role="list">
      {portals.map(portal => (
        <PortalRow key={portal.id} portal={portal} canOpen />
      ))}
    </div>
  )
}
