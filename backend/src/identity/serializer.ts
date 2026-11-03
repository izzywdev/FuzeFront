/**
 * Identity serializer — converts entity IDs from storage form (bare UUID) to
 * the TypeID wire form (`org_01h…`) at the response boundary.
 *
 * FFRNT-185: the TypeID wire form is the ONLY response format. The
 * `fuzefront.identity.prefixed-ids` release flag that used to gate it reached
 * 100 % in production and was retired; there is no bare-UUID response path.
 *
 * Usage in a route handler:
 *
 *   res.json(prefixDtoIds(org, { id: 'organization', owner_id: 'user' }))
 *   res.json({ sessionId: toWireId('session', sessionId) })
 */

import { EntityType, fromUuid } from '@izzywdev/fuzefront-identity'

/**
 * Converts a storage-form entity id (bare UUID from the DB column) to its
 * TypeID wire form: `org_01h455vb4pex5vsknk084sn02q`.
 *
 * Never throws: if the uuid is malformed, it is returned as-is so a faulty
 * serialization never turns a response into a 500.
 */
export function toWireId(type: EntityType, uuid: string): string {
  try {
    return fromUuid(type, uuid)
  } catch {
    // Malformed UUID in the DB — return the stored form rather than 500.
    return uuid
  }
}

/**
 * Batch-convert a DTO object's id fields to the wire form.
 *
 * Accepts a mapping of `{ fieldName: entityType }` so a single call can
 * prefix all id fields on a DTO without repeating the toWireId call per field.
 * Returns a shallow copy; the input is not mutated. Non-string and empty
 * values (null, undefined, '') are left untouched.
 *
 * Example:
 *   prefixDtoIds(row, {
 *     id: 'organization',
 *     ownerId: 'user',
 *   })
 */
export function prefixDtoIds<T extends Record<string, any>>(
  dto: T,
  fields: { [K in keyof T]?: EntityType }
): T {
  const result = { ...dto }
  for (const [field, type] of Object.entries(fields) as [keyof T, EntityType][]) {
    const val = result[field]
    if (typeof val === 'string' && val.length > 0) {
      result[field] = toWireId(type, val) as T[keyof T]
    }
  }
  return result
}
