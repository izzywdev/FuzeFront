import type { PortalStatus, VerificationStatus } from '../types'

// DS `StatusPill`'s vocabulary is a fixed union (its `StatusPillStatus` type)
// tuned to a general online/pending/offline lifecycle — it doesn't carry every
// value the frozen `Portal`/`PortalDomain` contracts declare, so a value
// outside that union is mapped to the closest tone here and rendered with an
// explicit `label` override (the pill's `data-status`/`role` attrs still
// reflect the mapped tone; the REAL value is exposed separately via the
// `data-portal-status="…"` / `data-domain-status="…"` hooks each caller
// already attaches, per the approved frame's testHooks).
const PORTAL_STATUS_MAP: Record<PortalStatus, { pill: 'active' | 'suspended' | 'pending'; label: string }> = {
  provisioning: { pill: 'pending', label: 'Provisioning' },
  'provisioned-pending-invite': { pill: 'pending', label: 'Pending invite' },
  active: { pill: 'active', label: 'Active' },
  suspended: { pill: 'suspended', label: 'Suspended' },
}

export function portalStatusPill(status: PortalStatus): { status: 'active' | 'suspended' | 'pending'; label: string } {
  const mapped = PORTAL_STATUS_MAP[status] ?? { pill: 'pending' as const, label: status }
  return { status: mapped.pill, label: mapped.label }
}

const DOMAIN_STATUS_MAP: Record<VerificationStatus, { pill: 'verified' | 'pending' | 'restricted'; label: string }> = {
  pending: { pill: 'pending', label: 'Pending' },
  verified: { pill: 'verified', label: 'Verified' },
  moved: { pill: 'restricted', label: 'Moved' },
  blocked: { pill: 'restricted', label: 'Blocked' },
  failed: { pill: 'restricted', label: 'Failed' },
}

export function domainStatusPill(status: VerificationStatus): { status: 'verified' | 'pending' | 'restricted'; label: string } {
  const mapped = DOMAIN_STATUS_MAP[status] ?? { pill: 'pending' as const, label: status }
  return { status: mapped.pill, label: mapped.label }
}
