/**
 * Portals Directory read-vs-no-access refinement (backend slice S5).
 *
 * Resolves, per portal-owning organization, whether the caller holds Permit
 * `read` and/or `manage` authority on the existing `Organization` resource
 * (`src/permit/schema.ts`) — including the parent-org `org-admin` ReBAC
 * derivation that already grants platform/master admins `manage` on every
 * child tenant org without a per-org assignment (see
 * `src/permit/schema.ts`'s `Organization.roles['org-admin']` and
 * `src/utils/scopeToPortal.ts`'s `defaultIsPlatformAdmin` for the same
 * derivation used elsewhere). This module adds NO new authorization model —
 * it is a thin, batched wrapper over the EXISTING `bulkCheckPermissions`.
 *
 * ONLY consumed by `routes/adminPortals.ts`'s `GET /` handler, and ONLY when
 * `fuzefront.platform.portals-directory` is ON. Flag OFF keeps the pre-S5
 * blanket `requireRole(['admin'])` gate and never calls this module.
 *
 * Fail-closed: `bulkCheckPermissions` already fails closed per-check (falls
 * back to individual `checkPermission` calls, each of which returns `false`
 * on any Permit error) — see `permission-check.ts`. This module adds a
 * defensive `?? false` on every lookup so a missing/short result array can
 * never be misread as granted.
 */
import { bulkCheckPermissions, type PermissionCheck } from './permit/permission-check'

export interface PortalCapability {
  canRead: boolean
  canManage: boolean
}

/**
 * Resolves `{ canRead, canManage }` for `userId` against every organization
 * in `organizationIds` (deduplicated — one Permit round trip covers however
 * many portal rows share an org). Missing/duplicate ids are handled
 * transparently; the returned map only ever contains resolved (fail-closed
 * to `false`) entries.
 */
export async function resolvePortalReadManageCapabilities(
  userId: string,
  organizationIds: string[]
): Promise<Map<string, PortalCapability>> {
  const uniqueOrgIds = Array.from(new Set(organizationIds.filter(Boolean)))
  const capabilities = new Map<string, PortalCapability>()
  if (uniqueOrgIds.length === 0) return capabilities

  const checks: PermissionCheck[] = []
  for (const organizationId of uniqueOrgIds) {
    checks.push({
      user: userId,
      action: 'read',
      resource: { type: 'Organization', tenant: organizationId },
    })
    checks.push({
      user: userId,
      action: 'manage',
      resource: { type: 'Organization', tenant: organizationId },
    })
  }

  const results = await bulkCheckPermissions(checks)

  uniqueOrgIds.forEach((organizationId, index) => {
    capabilities.set(organizationId, {
      canRead: results[index * 2] ?? false,
      canManage: results[index * 2 + 1] ?? false,
    })
  })

  return capabilities
}
