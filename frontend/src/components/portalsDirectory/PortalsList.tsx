import { pageIsReadOnly, type AdminPortal } from '../../services/adminPortalsService'
import { PortalRow } from './PortalRow'

/**
 * The populated directory list (`[data-list="portals"]` per
 * design/frames/portals-directory's testHooks) — one `PortalRow` per portal.
 * Loading/empty/error/forbidden are separate sibling states the orchestrator
 * swaps in instead of this component; by the time `PortalsList` renders,
 * `portals` is a real, non-empty page.
 *
 * Per-row launch authority (S5) comes straight off each portal's own
 * `canOpen` — a page can legitimately mix manageable and read-only rows.
 * `data-readonly="true"` is set on the wrapper only when EVERY row in this
 * page is read-only (`pageIsReadOnly`), matching
 * design/frames/portals-directory/02-portals-list-states.html d6b — a caller
 * with `read` but not `manage`/`open` authority still SEES the directory
 * (name / domain / tier / status), just with zero launch affordances,
 * distinct from the fail-closed 403 no-access state (`PermissionDeniedNotice`,
 * no rows at all).
 */
export function PortalsList({ portals }: { portals: AdminPortal[] }) {
  const readOnly = pageIsReadOnly(portals)
  return (
    <div
      className="pd-dir"
      data-list="portals"
      role="list"
      {...(readOnly ? { 'data-readonly': 'true' } : {})}
    >
      {portals.map(portal => (
        <PortalRow key={portal.id} portal={portal} canOpen={portal.canOpen ?? true} />
      ))}
    </div>
  )
}
