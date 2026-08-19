import { StatusPill } from '@fuzefront/design-system'
import type { StatusPillStatus } from '@fuzefront/design-system'

// Maps the portal lifecycle contract (services/portal-service/openapi.yaml
// PortalStatus: provisioning | provisioned-pending-invite | active |
// suspended) onto StatusPill's semantic tone vocabulary. The transient
// provisioning states read as the same "in progress" tone StatusPill already
// uses elsewhere (FF-EPIC-09-S2's resumable pipeline).
const TONE_MAP: Record<string, StatusPillStatus> = {
  active: 'active',
  suspended: 'suspended',
  provisioning: 'in-progress',
  'provisioned-pending-invite': 'pending',
}

function humanize(status: string): string {
  return status
    .split('-')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

/**
 * The portal lifecycle status pill (`data-portal-status="<status>"` per
 * design/frames/portals-directory's testHooks). Composes the DS StatusPill —
 * never a hand-rolled status dot.
 */
export function PortalStatusBadge({ status }: { status: string }) {
  const tone = TONE_MAP[status] ?? 'active'
  return (
    <StatusPill status={tone} label={humanize(status)} data-portal-status={status} />
  )
}
