// Mint, parse and assert entity identifiers.
//
// Wire form:    cus_01h455vb4pex5vsknk084sn02q   (what crosses the API boundary)
// Storage form: 0195a8f2-6c3d-7f11-8b2e-...      (native Postgres `uuid` column)
//
// Both render the same 128 bits; `toUuid`/`fromUuid` convert losslessly. Keep
// the wire form at the edge and the UUID in the column — see
// governance/identifier-standard.md §2.

import {
  bytesToUuid,
  decodeSuffix,
  encodeSuffix,
  isUuid,
  isValidSuffix,
  uuidToBytes,
  uuidv7Bytes,
} from './codec'
import { EntityId, IdentityError } from './brand'
import { EntityType, prefixFor, typeForPrefix } from './registry'

export interface IdentityConfig {
  /**
   * Entity types whose stored rows still carry bare UUIDs, which `parseId`
   * therefore accepts alongside the prefixed form.
   *
   * This is the dual-accept window — GitHub ran the same play with the
   * `X-Github-Next-Global-ID` header when it changed node-id formats, because
   * a format migration without one breaks every stored reference at once.
   * Services populate this from the `fuzefront.identity.prefixed-ids` flag:
   * flag OFF (default) => the type is listed here and legacy ids pass;
   * flag ON => the type is removed and only prefixed ids are accepted.
   */
  legacyUuidTypes: ReadonlySet<EntityType>
}

// Default: strict — no type accepts a bare UUID. Every stored row today IS a
// bare UUID, so a service adopting `parseId` on an existing surface MUST widen
// this at bootstrap for the types it has not yet backfilled. Defaulting the
// other way would mean a service silently kept accepting untyped ids simply by
// forgetting to configure anything, which is the failure mode this standard
// exists to remove.
let config: IdentityConfig = {
  legacyUuidTypes: new Set<EntityType>(),
}

/** Replaces identity configuration. Call once at service bootstrap. */
export function configureIdentity(next: Partial<IdentityConfig>): void {
  config = { ...config, ...next }
}

export function getIdentityConfig(): IdentityConfig {
  return config
}

/** Splits `cus_01h4…` into its prefix and suffix; null when not that shape. */
function split(raw: string): { prefix: string; suffix: string } | null {
  const separator = raw.lastIndexOf('_')
  if (separator <= 0 || separator === raw.length - 1) return null
  return { prefix: raw.slice(0, separator), suffix: raw.slice(separator + 1) }
}

/** Mints a fresh, server-owned id for `type`. The ONLY id constructor. */
export function mintId<T extends EntityType>(type: T): EntityId<T> {
  return `${prefixFor(type)}_${encodeSuffix(uuidv7Bytes())}` as EntityId<T>
}

/**
 * Validates that `raw` is an id of `type` and returns it branded.
 *
 * Throws `IdentityError` on any mismatch — notably when the caller passes an
 * id belonging to a different entity type, which is the attack this standard
 * exists to stop. The check is a string compare: no network, no cache, no
 * database, and correct even when the owning service is unreachable.
 */
export function parseId<T extends EntityType>(type: T, raw: unknown): EntityId<T> {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new IdentityError('MALFORMED_ID', type, `expected a ${type} id, received ${typeof raw}`)
  }

  const parts = split(raw)
  if (!parts) {
    // No prefix at all. Legitimate only for a type still inside its dual-accept
    // window; otherwise it is exactly the untyped id the standard removes.
    if (isUuid(raw)) {
      if (config.legacyUuidTypes.has(type)) return raw as EntityId<T>
      throw new IdentityError(
        'LEGACY_NOT_PERMITTED',
        type,
        `bare UUID supplied for ${type}; prefixed ids are required for this type`
      )
    }
    throw new IdentityError('MALFORMED_ID', type, `not a valid ${type} id`)
  }

  const expected = prefixFor(type)
  if (parts.prefix !== expected) {
    const actual = typeForPrefix(parts.prefix)
    throw new IdentityError(
      actual ? 'PREFIX_MISMATCH' : 'UNKNOWN_PREFIX',
      type,
      actual
        ? `expected a ${type} id (${expected}_), received a ${actual} id (${parts.prefix}_)`
        : `expected a ${type} id (${expected}_), received unregistered prefix ${parts.prefix}_`
    )
  }

  if (!isValidSuffix(parts.suffix)) {
    throw new IdentityError('MALFORMED_ID', type, `${type} id has a malformed suffix`)
  }

  return raw as EntityId<T>
}

/**
 * Validates a REFERENCE to an entity of `type` — the L0 check in the layered
 * referential-integrity model. Answers "is this the right kind of thing",
 * which is the only question a local check can answer without the owning
 * service. Existence is L1 (`ref_index` projection) and above.
 */
export const assertRef = parseId

/** Non-throwing `parseId`; returns null instead. For optional references. */
export function tryParseId<T extends EntityType>(type: T, raw: unknown): EntityId<T> | null {
  try {
    return parseId(type, raw)
  } catch {
    return null
  }
}

export function isId<T extends EntityType>(type: T, raw: unknown): raw is EntityId<T> {
  return tryParseId(type, raw) !== null
}

/** Wire form -> storage form. Accepts a legacy bare UUID unchanged. */
export function toUuid<T extends EntityType>(id: EntityId<T>): string {
  const parts = split(id)
  if (!parts) return id // legacy bare UUID, already storage-shaped
  return bytesToUuid(decodeSuffix(parts.suffix))
}

/** Storage form -> wire form. The inverse of `toUuid`. */
export function fromUuid<T extends EntityType>(type: T, uuid: string): EntityId<T> {
  return `${prefixFor(type)}_${encodeSuffix(uuidToBytes(uuid))}` as EntityId<T>
}

/**
 * The entity type `raw` declares itself to be, without knowing it in advance.
 * For generic plumbing (audit logs, tracing) — never for authorization, which
 * comes from the token and Permit policy, never from the shape of an id.
 */
export function entityTypeOf(raw: string): EntityType | null {
  const parts = split(raw)
  if (!parts || !isValidSuffix(parts.suffix)) return null
  return typeForPrefix(parts.prefix)
}
