// events/outbox.ts — the transactional-outbox WRITER for selection-list-service.
//
// Contract: docs/planning/selection-lists-events.md (sections 4-6, 13). Semantics
// copied from backend/core/src/events/outbox.ts (insert one `event_outbox` row
// INSIDE the caller's transaction so the event commits or rolls back atomically
// with the state change it describes), hardened for this service:
//
//   - the payload is validated against the shared Zod schema for its topic
//     (`schemaForTopic`) BEFORE the insert. An invalid payload is a BUG in this
//     service (a route built a snapshot that violates the frozen contract), not
//     a user error, so it THROWS and fails the caller's transaction: the data
//     change is rolled back with it. A bad event can never be persisted, and
//     the relay never sees one.
//   - `eventId` (UUIDv7, the consumer-side idempotency key) is minted here and
//     is also the outbox row id, so a redelivery carries the same value.
//   - per-organization ORDER. Kafka orders only within a partition, and every
//     selection-lists event is keyed by organization. The relay publishes an
//     org's rows in `seq` order, which is only the COMMIT order if no two
//     transactions of one org can interleave between "take a seq" and
//     "commit". `lockOrgOutbox` closes that: a transaction-scoped advisory lock
//     per organization, taken before the first revision bump / outbox insert
//     and released at COMMIT/ROLLBACK. (A list-row lock alone is not enough: it
//     orders one list's events, not the org's.) Take it as LATE as possible in
//     a handler (after any slow Security API call) to keep the hold short.
//   - `created_at` is stamped with clock_timestamp() (insert time), not now()
//     (transaction START time), so `(created_at, seq)` order agrees with `seq`.
//
// Never write seed.* events from here in the route layer; the seed stream owns
// those. (The writer itself is topic-agnostic within `selection-lists.*`, so the
// seed algorithm and the consumers reuse it unchanged.)

import type { Knex } from 'knex';
import type { SafeParseError } from 'zod';
import { TOPICS, schemaForTopic } from '@fuzefront/shared/kafka';
import { bytesToUuid, fromUuid, uuidv7Bytes } from '@izzywdev/fuzefront-identity';
import { currentRequestContext } from '../lib/logger';

/** Either the shared pool or an open transaction. Handlers MUST pass their `trx`. */
export type OutboxExecutor = Knex | Knex.Transaction;

/** Every topic this service produces (seed.requested is consumed, never produced). */
export const PRODUCED_TOPICS: ReadonlySet<string> = new Set<string>([
  TOPICS.SELECTION_LISTS_LIST_CREATED,
  TOPICS.SELECTION_LISTS_LIST_UPDATED,
  TOPICS.SELECTION_LISTS_LIST_ARCHIVED,
  TOPICS.SELECTION_LISTS_LIST_DELETED,
  TOPICS.SELECTION_LISTS_ITEM_CREATED,
  TOPICS.SELECTION_LISTS_ITEM_UPDATED,
  TOPICS.SELECTION_LISTS_ITEM_ARCHIVED,
  TOPICS.SELECTION_LISTS_ITEM_DELETED,
  TOPICS.SELECTION_LISTS_ITEM_REORDERED,
  TOPICS.SELECTION_LISTS_TRANSLATION_UPSERTED,
  TOPICS.SELECTION_LISTS_TRANSLATION_DELETED,
  TOPICS.SELECTION_LISTS_ACCESS_GRANTED,
  TOPICS.SELECTION_LISTS_ACCESS_REVOKED,
  TOPICS.SELECTION_LISTS_SEED_COMPLETED,
  TOPICS.SELECTION_LISTS_SEED_FAILED,
]);

/** The outbox payload failed its topic schema: a bug in the producer, never user input. */
export class OutboxPayloadInvalidError extends Error {
  readonly code = 'OUTBOX_PAYLOAD_INVALID';
  constructor(
    readonly topic: string,
    readonly issues: string[],
  ) {
    super(`event payload for ${topic} violates its schema: ${issues.join('; ')}`);
    this.name = 'OutboxPayloadInvalidError';
  }
}

/** The topic is not one this service may enqueue (unknown, or consumed-only). */
export class OutboxTopicError extends Error {
  readonly code = 'OUTBOX_TOPIC_NOT_PRODUCED';
  constructor(readonly topic: string) {
    super(`topic ${topic} is not produced by selection-list-service`);
    this.name = 'OutboxTopicError';
  }
}

/** An id/identity value could not be rendered in its wire (TypeID) form. */
export class WireIdError extends Error {
  readonly code = 'WIRE_ID_INVALID';
  constructor(
    readonly kind: 'organization' | 'user',
    readonly value: string,
  ) {
    super(`cannot render ${kind} id as a wire TypeID`);
    this.name = 'WireIdError';
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Render a stored organization id as its wire TypeID (`org_…`). The stored value
 * is whatever the caller's token carried: already a TypeID, or a bare UUID
 * (identity events carry bare UUIDs; org-deleted.handler.ts matches both forms).
 */
export function wireOrgId(stored: string): string {
  if (/^org_[0-9a-z]+$/.test(stored)) return stored;
  if (UUID_RE.test(stored)) return fromUuid('organization', stored.toLowerCase());
  throw new WireIdError('organization', stored);
}

/** Render a stored user id as its wire TypeID (`usr_…`); same rules as `wireOrgId`. */
export function wireUserId(stored: string): string {
  if (/^usr_[0-9a-z]+$/.test(stored)) return stored;
  if (UUID_RE.test(stored)) return fromUuid('user', stored.toLowerCase());
  throw new WireIdError('user', stored);
}

/** A fresh eventId: UUIDv7 via the identity package (never `randomUUID()`). */
export function mintEventId(): string {
  return bytesToUuid(uuidv7Bytes());
}

export interface EnqueueEventInput {
  /** One of PRODUCED_TOPICS. */
  topic: string;
  /**
   * The organization the event belongs to, in any stored form (TypeID or bare
   * UUID); rendered as the wire TypeID into `payload.organizationId` and used as
   * the per-org ordering key (`event_outbox.organization_id`).
   */
  organizationId: string;
  /**
   * The topic payload WITHOUT `eventId` and `organizationId` (both are set by
   * the writer and cannot be overridden): actor, listId, listKey, listRevision,
   * snapshot, ... exactly as the topic schema requires.
   */
  payload: Record<string, unknown>;
  /**
   * Request trace id carried on the envelope. Defaults to the current request's
   * reqId (AsyncLocalStorage), then to the eventId.
   */
  correlationId?: string;
}

export interface EnqueuedEvent {
  /** Unique per emission; also `event_outbox.id`. */
  eventId: string;
  topic: string;
  /** Wire TypeID, as stored in `event_outbox.organization_id`. */
  organizationId: string;
  /** The validated payload exactly as persisted. */
  payload: Record<string, unknown>;
  correlationId: string;
}

/**
 * Serialise outbox writes per organization until the transaction ends. Safe to
 * call repeatedly in one transaction (advisory xact locks are re-entrant).
 * The relay uses a DIFFERENT key space and never takes this lock, so it never
 * blocks writers.
 */
export async function lockOrgOutbox(trx: OutboxExecutor, organizationId: string): Promise<void> {
  await trx.raw('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', [`sl-outbox:${wireOrgId(organizationId)}`]);
}

/**
 * Bump and return `selection_lists.revision` (listRevision, plan section 5) in
 * the caller's transaction. Call once PER EMITTED EVENT that carries a revision:
 * a consumer applies an event only if its revision is greater than the last it
 * applied for the list, so two events must never share one. Row-locks the list
 * until COMMIT (concurrent mutations of one list serialise here).
 */
export async function bumpListRevision(trx: OutboxExecutor, organizationId: string, listId: string): Promise<number> {
  await lockOrgOutbox(trx, organizationId);
  const res = await trx.raw('UPDATE selection_lists SET revision = revision + 1 WHERE id = ? RETURNING revision', [listId]);
  const row = (res as { rows?: Array<{ revision: string | number }> }).rows?.[0];
  if (!row) throw new Error(`bumpListRevision: list ${listId} does not exist`);
  return Number(row.revision);
}

/**
 * Write one event to `event_outbox` INSIDE the caller's transaction.
 *
 * MUST be called with the SAME `trx` that performs the state change; if that
 * transaction rolls back, the event is dropped with it. Throws
 * `OutboxTopicError` / `OutboxPayloadInvalidError` (a bug) which aborts the
 * transaction when it propagates out of the transaction callback.
 */
export async function enqueueEvent(trx: OutboxExecutor, input: EnqueueEventInput): Promise<EnqueuedEvent> {
  if (!PRODUCED_TOPICS.has(input.topic)) throw new OutboxTopicError(input.topic);
  const schema = schemaForTopic(input.topic);
  if (!schema) throw new OutboxTopicError(input.topic);

  const organizationId = wireOrgId(input.organizationId);
  const eventId = mintEventId();
  const candidate = { ...input.payload, eventId, organizationId };

  const parsed = schema.safeParse(candidate);
  if (!parsed.success) {
    // (strict:false in this tsconfig disables discriminated-union narrowing)
    const failure = parsed as SafeParseError<unknown>;
    throw new OutboxPayloadInvalidError(
      input.topic,
      failure.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }
  const payload = parsed.data as Record<string, unknown>;
  const correlationId = input.correlationId ?? currentRequestContext()?.reqId ?? eventId;

  await lockOrgOutbox(trx, organizationId);
  await trx('event_outbox').insert({
    id: eventId,
    organization_id: organizationId,
    topic: input.topic,
    payload: trx.raw('?::jsonb', [JSON.stringify(payload)]),
    correlation_id: correlationId,
    status: 'pending',
    attempts: 0,
    created_at: trx.raw('clock_timestamp()'),
  });

  return { eventId, topic: input.topic, organizationId, payload, correlationId };
}
