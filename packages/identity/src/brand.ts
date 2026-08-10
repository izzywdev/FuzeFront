import type { EntityType } from './registry'

declare const ENTITY_BRAND: unique symbol

/**
 * A validated identifier for entity type `T`.
 *
 * This is the primary enforcement mechanism for the identifier standard —
 * ahead of the runtime middleware and well ahead of CI. It is a plain string
 * at runtime (zero cost, serializes normally), but the phantom brand means a
 * bare `string` off `req.body` will not type-check against a repository that
 * takes `EntityId<'customer'>`. The hole is unreachable rather than detected
 * after the fact, and `EntityId<'customer'>` is not assignable to
 * `EntityId<'invoice'>` — the type confusion this whole standard exists to
 * prevent becomes a compile error.
 *
 * `mintId` and `parseId` are the only legitimate constructors. Casting with
 * `as EntityId<...>` bypasses the guarantee and is flagged by
 * `scripts/gate_identifier.py --source`.
 */
export type EntityId<T extends EntityType> = string & { readonly [ENTITY_BRAND]: T }

/** Any entity id, when the call site is genuinely type-agnostic (logging, tracing). */
export type AnyEntityId = EntityId<EntityType>

/** Raised whenever a value fails to be a valid id for the expected type. */
export class IdentityError extends Error {
  readonly code:
    | 'PREFIX_MISMATCH'
    | 'MALFORMED_ID'
    | 'UNKNOWN_PREFIX'
    | 'LEGACY_NOT_PERMITTED'

  readonly expectedType: EntityType

  constructor(
    code: IdentityError['code'],
    expectedType: EntityType,
    message: string
  ) {
    super(message)
    this.name = 'IdentityError'
    this.code = code
    this.expectedType = expectedType
  }
}
