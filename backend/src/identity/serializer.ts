/**
 * Identity serializer — converts entity IDs between storage form (bare UUID)
 * and wire form (TypeID: `org_01h…`) at the response boundary.
 *
 * Step 4 of FFRNT-185: when the `fuzefront.identity.prefixed-ids` release flag
 * is ON, API responses MUST return the TypeID wire form. When OFF (default),
 * the current bare-UUID behavior is byte-identical to pre-step-3 behavior —
 * existing clients continue to work without any changes.
 *
 * Usage in a route handler:
 *
 *   const prefixed = await isPrefixedIdsEnabled(flagCtx)
 *   res.json({
 *     id: toWireId('organization', org.id, prefixed),
 *     ...
 *   })
 *
 * The `prefixed` boolean is resolved once per request (not per field) so the
 * flag is evaluated with the correct per-request context (orgId, userId).
 */

import { EntityType, fromUuid } from '@izzywdev/fuzefront-identity'

/**
 * `generatePortalId()` in portalRepository.ts used to produce
 * `prt_<hex32>` — a UUID v4 with dashes stripped, not standard TypeID.
 * This pattern lets `toWireId` detect that legacy form and re-insert the
 * dashes before handing it to `fromUuid`, which expects a bare UUID.
 * Matched only when `type === 'portal'` so the overhead is negligible.
 * Remove once migration 024 has converted all stored rows to bare UUIDs.
 */
const LEGACY_PORTAL_HEX_RE = /^prt_([0-9a-f]{32})$/

function legacyPortalIdToUuid(id: string): string | null {
  const m = LEGACY_PORTAL_HEX_RE.exec(id)
  if (!m) return null
  const hex = m[1]
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * Converts a storage-form entity id (bare UUID from the DB column) to the
 * appropriate API wire form:
 *
 * - prefixed=true  → TypeID form: `org_01h455vb4pex5vsknk084sn02q`
 * - prefixed=false → bare UUID: `0195a8f2-6c3d-7f11-…` (current behavior)
 *
 * Never throws: if the uuid is malformed, it is returned as-is so a faulty
 * serialization never makes a response worse than the current bare-uuid form.
 */
export function toWireId(type: EntityType, uuid: string, prefixed: boolean): string {
  if (!prefixed) return uuid
  try {
    // Special case: portals stored before migration 024 use the legacy
    // prt_<hex32> form rather than a bare UUID. Detect and normalise.
    if (type === 'portal') {
      const bareUuid = legacyPortalIdToUuid(uuid)
      if (bareUuid !== null) {
        return fromUuid(type, bareUuid)
      }
    }
    return fromUuid(type, uuid)
  } catch {
    // Malformed UUID in the DB — return bare form rather than 500.
    return uuid
  }
}

/**
 * Batch-convert a DTO object's id fields to the wire form.
 *
 * Accepts a mapping of `{ fieldName: entityType }` so a single call can
 * prefix all id fields on a DTO without repeating the toWireId call per field.
 *
 * Example:
 *   prefixDtoIds(row, prefixed, {
 *     id: 'organization',
 *     ownerId: 'user',
 *   })
 */
export function prefixDtoIds<T extends Record<string, any>>(
  dto: T,
  prefixed: boolean,
  fields: { [K in keyof T]?: EntityType }
): T {
  if (!prefixed) return dto
  const result = { ...dto }
  for (const [field, type] of Object.entries(fields) as [keyof T, EntityType][]) {
    const val = result[field]
    if (typeof val === 'string' && val.length > 0) {
      result[field] = toWireId(type, val, true) as T[keyof T]
    }
  }
  return result
}
