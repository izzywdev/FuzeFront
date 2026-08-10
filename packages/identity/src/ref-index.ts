// L1 referential integrity — a local projection of "does this entity exist",
// fed by the events the owning service already publishes.
//
// Orders and customers live in different services and different databases, so
// there is no foreign key to lean on (governance/identifier-standard.md §5).
// Integrity is layered instead, and this file is L1:
//
//   L0  assertRef('customer', id)      prefix compare, offline  → is it the right KIND
//   L1  assertRefExists(store, …)      local indexed lookup     → does it EXIST
//   L2  verify-on-write RPC            per-reference opt-in     → is it exist RIGHT NOW
//   L3  async reconciler                background              → whatever the above missed
//
// L1 rather than an RPC as the default because a local read has no
// cache-invalidation problem and keeps working when the owning service is down.
// It is a projection, so it is EVENTUALLY consistent — and that is the whole
// design problem here, addressed by `staleAfterMs` below rather than ignored.

import type { EntityType } from './registry'
import { assertRef, toUuid } from './id'
import { isUuid } from './codec'
import type { EntityId } from './brand'

/** One row of the projection. `tenantId` scopes it where the source event carries one. */
export interface RefRecord {
  entityType: EntityType
  /** The entity's id in storage form (a bare uuid), NOT the wire form. */
  entityId: string
  tenantId?: string | null
  status: 'active' | 'deleted'
}

/**
 * The storage a service provides. Deliberately tiny and DB-agnostic: this
 * package must not take a `pg` dependency — Python services and non-Postgres
 * services consume the same standard.
 */
export interface RefIndexStore {
  /** True when an ACTIVE row exists for this (type, id[, tenant]). */
  has(entityType: EntityType, entityId: string, tenantId?: string | null): Promise<boolean>
  /** Idempotent upsert — consumers redeliver, so this is called more than once per event. */
  upsert(record: RefRecord): Promise<void>
  /** Tombstone rather than DELETE, so a redelivered `*.created` cannot resurrect a dead row. */
  markDeleted(
    entityType: EntityType,
    entityId: string,
    tenantId?: string | null
  ): Promise<void>
  /**
   * When the projection last applied an event, or null if it never has.
   * This is what makes enforcement safe to switch on; see `staleAfterMs`.
   */
  lastAppliedAt(): Promise<Date | null>
  /** True when the projection holds no rows — the signal to rebuild from the log. */
  isEmpty(): Promise<boolean>
}

export class RefIndexError extends Error {
  readonly code: 'REF_NOT_FOUND' | 'REF_DELETED'
  readonly entityType: EntityType
  readonly entityId: string

  constructor(code: RefIndexError['code'], entityType: EntityType, entityId: string) {
    super(
      code === 'REF_DELETED'
        ? `${entityType} ${entityId} has been deleted`
        : `no such ${entityType}: ${entityId}`
    )
    this.name = 'RefIndexError'
    this.code = code
    this.entityType = entityType
    this.entityId = entityId
  }
}

export interface AssertRefExistsOptions {
  /**
   * `enforce` rejects an unknown reference. `warn` reports and allows.
   *
   * Default is `warn`, and that is not timidity. A projection lags: a genuinely
   * new entity can be referenced before its `*.created` event has been consumed,
   * so enforcing everywhere converts every consumer hiccup into a user-visible
   * 4xx on VALID data. Turn `enforce` on per reference, starting with the ones
   * where a dangling reference actually costs something — the same
   * per-reference opt-in the standard specifies for L2.
   */
  mode?: 'enforce' | 'warn'
  /**
   * How stale the projection may be before `enforce` degrades to `warn`.
   *
   * Without this, a Kafka outage turns the projection into a REJECT-EVERYTHING
   * oracle: nothing new is projected, so every reference to a recent entity
   * fails, and an integrity check that is supposed to be free takes the whole
   * write path down with the message bus. Degrading is the correct failure
   * direction here precisely because L1 answers existence, not authorization —
   * an id is never a capability, so allowing an unverified reference through
   * grants nothing that the token and Permit have not already granted.
   * Default 5 minutes. `null` disables the degrade (fail closed regardless).
   */
  staleAfterMs?: number | null
  tenantId?: string | null
  /** Where warnings go. Defaults to `console.warn`. */
  onWarn?: (message: string) => void
  /** Injectable clock, so the staleness path is testable without waiting. */
  now?: () => Date
}

const DEFAULT_STALE_AFTER_MS = 5 * 60 * 1000

/**
 * L0 then L1: the reference is the right KIND of thing, and it EXISTS —
 * both answered without a network call, a cache, or the owning service being up.
 *
 * Returns the branded id, so this composes into a repository call the same way
 * `assertRef` does.
 */
export async function assertRefExists<T extends EntityType>(
  store: RefIndexStore,
  entityType: T,
  raw: string,
  options: AssertRefExistsOptions = {}
): Promise<EntityId<T>> {
  // L0 first, always. It is a string compare and it is the only check that
  // answers "is this the right kind of thing" — a `cus_` id arriving where an
  // `inv_` belongs is rejected here whatever the projection says.
  const id = assertRef(entityType, raw)

  const {
    mode = 'warn',
    staleAfterMs = DEFAULT_STALE_AFTER_MS,
    tenantId = null,
    onWarn = (message: string) => console.warn(message),
    now = () => new Date(),
  } = options

  const exists = await store.has(entityType, storageForm(id), tenantId)
  if (exists) return id

  if (mode === 'enforce' && staleAfterMs !== null) {
    const lastApplied = await store.lastAppliedAt()
    const lagMs = lastApplied === null ? Infinity : now().getTime() - lastApplied.getTime()
    if (lagMs > staleAfterMs) {
      onWarn(
        `[ref-index] projection is stale (${
          lastApplied === null ? 'never applied an event' : `${Math.round(lagMs / 1000)}s behind`
        }); allowing unverified reference ${entityType}=${raw} rather than failing writes ` +
          `while the projection catches up`
      )
      return id
    }
  }

  if (mode === 'enforce') throw new RefIndexError('REF_NOT_FOUND', entityType, raw)

  onWarn(`[ref-index] unknown reference ${entityType}=${raw} (advisory; mode=warn)`)
  return id
}

/**
 * The storage form of a wire id — the bare uuid the projection keys on.
 *
 * The projection is fed by events carrying bare uuids (every `identity.*`
 * schema declares `z.string().uuid()`), while callers pass WIRE ids. Keying the
 * table on storage form is what lets one projection serve both, and it matches
 * §2: prefix on the wire, native uuid in the column.
 */
function storageForm(id: string): string {
  // A value that is ALREADY a bare uuid is the legacy case a dual-accept window
  // exists for (§8), and `toUuid` rejects it — so fall through rather than
  // failing the lookup on exactly the rows the migration has not reached yet.
  if (isUuid(id)) return id
  try {
    return toUuid(id as EntityId<EntityType>)
  } catch {
    return id
  }
}

// ---------------------------------------------------------------------------
// Event → projection mapping
// ---------------------------------------------------------------------------

/** How one Kafka topic updates the projection. */
export interface TopicProjection {
  entityType: EntityType
  operation: 'upsert' | 'delete'
  /** The payload field holding the entity's id. */
  idField: string
  /** The payload field holding the tenant/org scope, when the event carries one. */
  tenantField?: string
}

/**
 * The lifecycle events already published on FuzeFront topics, mapped to the
 * projection. Nothing new has to be emitted for L1 to work — that is the point
 * of building on `identity.*` rather than inventing a parallel stream: an event
 * contract that only the integrity layer consumes is one nobody maintains.
 */
// Field names are taken from the shipped Zod schemas in shared/src/kafka/schemas,
// not from the topic name — `identity.org.*` carries `organizationId`, not `orgId`.
//
// `app.registered` is deliberately ABSENT: its payload
// (shared/src/kafka/schemas/app.registered.ts) carries slug/name/organizationId
// but no app id at all, so there is nothing to project. Adding an id to that
// event is its own change with its own consumers; claiming app coverage here
// without one would put a lookup in the code path that can never succeed.
export const TOPIC_PROJECTIONS: Readonly<Record<string, TopicProjection>> = Object.freeze({
  'identity.user.created': { entityType: 'user', operation: 'upsert', idField: 'userId' },
  'identity.user.deleted': { entityType: 'user', operation: 'delete', idField: 'userId' },
  'identity.org.created': {
    entityType: 'organization',
    operation: 'upsert',
    idField: 'organizationId',
  },
  'identity.org.deleted': {
    entityType: 'organization',
    operation: 'delete',
    idField: 'organizationId',
  },
  'portal.created': {
    entityType: 'portal',
    operation: 'upsert',
    idField: 'portalId',
    tenantField: 'organizationId',
  },
})

/** Every topic a service must subscribe to in order to keep the projection current. */
export const REF_INDEX_TOPICS: readonly string[] = Object.freeze(Object.keys(TOPIC_PROJECTIONS))

/**
 * Applies one event to the projection. Pure routing — the store does the I/O,
 * so this is unit-testable with an in-memory store and no broker.
 *
 * Unmapped topics and payloads missing their id field are IGNORED rather than
 * thrown: a consumer that dies on an unexpected message stops projecting
 * everything, which is a far worse outcome than one skipped row.
 */
export async function applyEventToRefIndex(
  store: RefIndexStore,
  topic: string,
  payload: Record<string, unknown>
): Promise<boolean> {
  const projection = TOPIC_PROJECTIONS[topic]
  if (!projection) return false

  const entityId = payload[projection.idField]
  if (typeof entityId !== 'string' || entityId.length === 0) return false

  const tenantRaw = projection.tenantField ? payload[projection.tenantField] : null
  const tenantId = typeof tenantRaw === 'string' ? tenantRaw : null

  if (projection.operation === 'delete') {
    await store.markDeleted(projection.entityType, entityId, tenantId)
  } else {
    await store.upsert({
      entityType: projection.entityType,
      entityId,
      tenantId,
      status: 'active',
    })
  }
  return true
}
