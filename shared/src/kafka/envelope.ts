// Event envelope v2 — the contract (data-consistency standard §3).
//
// ADDITIVE: v1 `FuzeEvent<T>` (types.ts) is untouched and existing producers keep
// emitting it. v2 is what producers move to in Wave C; `parseEnvelope()` reads
// either so consumers can migrate first. The language-neutral twin of this file
// is contracts/events/envelope.v2.schema.json; tests assert the two agree on
// packages/conformance-vectors/events/envelopes.*.json.
import { z } from 'zod';

/**
 * TypeID wire form: `<prefix>_<26-char base32 suffix>`. The first suffix char is
 * `[0-7]` (128 bits packed into 130). Mirrors packages/identity/src/codec.ts —
 * kept as a local regex so `@fuzefront/shared` does not depend on the identity
 * package. Ids are opaque past the prefix.
 */
export const TYPEID_PATTERN = '^[a-z][a-z_]{1,62}_[0-7][0-9a-hjkmnp-tv-z]{25}$';
const TYPEID_RE = new RegExp(TYPEID_PATTERN);

/** Prefix registered for envelope event ids (packages/identity registry: `event: 'evt'`). */
export const EVENT_ID_PREFIX = 'evt';
export const EVENT_ID_PATTERN = '^evt_[0-7][0-9a-hjkmnp-tv-z]{25}$';

/** `<domain>.<name>[.<name>…]`, lowercase, e.g. `identity.org.created`. */
export const TOPIC_PATTERN = '^[a-z][a-z0-9_-]*(\\.[a-z][a-z0-9_-]*)+$';

/** Entity type segment, e.g. `organization`, `selectionList`. */
export const AGGREGATE_TYPE_PATTERN = '^[a-zA-Z][a-zA-Z0-9_]{0,62}$';

const typeId = z.string().regex(TYPEID_RE, 'must be a TypeID (<prefix>_<26 base32 chars>)');

export const EnvelopeV2Schema = z
  .object({
    /** TypeID `evt_…`, minted at enqueue. The consumer dedupe key (§4). */
    eventId: z.string().regex(new RegExp(EVENT_ID_PATTERN), 'must be an evt_ TypeID'),
    topic: z.string().regex(new RegExp(TOPIC_PATTERN)),
    /** Version of the topic's payload contract. Positive integer. */
    schemaVersion: z.number().int().positive(),
    /** Entity type the event is about. */
    aggregateType: z.string().regex(new RegExp(AGGREGATE_TYPE_PATTERN)),
    /** Typed id of that entity. THE PARTITION KEY: one entity's events are ordered. */
    aggregateId: typeId,
    /** Monotonic per aggregate; bumped by the owner in the same tx as the change. The ordering guard (§4). */
    aggregateVersion: z.number().int().positive(),
    /** Owning service name. */
    producer: z.string().min(1).max(128),
    /** ISO-8601 / RFC 3339 timestamp with offset. */
    occurredAt: z.string().datetime({ offset: true }),
    correlationId: z.string().min(1).max(128),
    /** `eventId` of the event that caused this one, if any. */
    causationId: z.string().regex(new RegExp(EVENT_ID_PATTERN)).optional(),
    payload: z.unknown().refine((v) => v !== undefined, 'payload is required'),
  })
  .strict();

export type EnvelopeV2<T = unknown> = Omit<z.infer<typeof EnvelopeV2Schema>, 'payload'> & {
  payload: T;
};

/** v1 shape, as emitted today by FuzeEvent<T> producers. */
export const EnvelopeV1Schema = z
  .object({
    version: z.string().min(1),
    topic: z.string().regex(new RegExp(TOPIC_PATTERN)),
    correlationId: z.string().min(1),
    occurredAt: z.string().datetime({ offset: true }),
    payload: z.unknown().refine((v) => v !== undefined, 'payload is required'),
  })
  .strict();

/** Keys that exist only in v2; any of them present routes the input to the v2 parser. */
export const V2_ONLY_KEYS = [
  'eventId',
  'schemaVersion',
  'aggregateType',
  'aggregateId',
  'aggregateVersion',
  'producer',
  'causationId',
] as const;

/**
 * Normalized envelope: what consumers should code against while v1 and v2
 * coexist. For v1 the aggregate/event fields are `undefined` — a consumer that
 * needs dedupe or version-guarding must reject (or dead-letter) v1.
 * `schemaVersion` is the v1 `version` string verbatim, or `String(n)` for v2.
 */
export interface NormalizedEnvelope<T = unknown> {
  envelopeVersion: 1 | 2;
  topic: string;
  schemaVersion: string;
  correlationId: string;
  occurredAt: string;
  payload: T;
  eventId?: string;
  aggregateType?: string;
  aggregateId?: string;
  aggregateVersion?: number;
  producer?: string;
  causationId?: string;
}

export type ParseEnvelopeResult<T = unknown> =
  | { success: true; envelope: NormalizedEnvelope<T> }
  | { success: false; error: z.ZodError };

/**
 * Accepts a v1 or v2 envelope (already JSON-parsed) and returns the normalized
 * shape, or the Zod error. Never throws on bad input.
 */
export function parseEnvelope<T = unknown>(input: unknown): ParseEnvelopeResult<T> {
  const isV2 =
    typeof input === 'object' &&
    input !== null &&
    V2_ONLY_KEYS.some((k) => Object.prototype.hasOwnProperty.call(input, k));

  if (isV2) {
    const r = EnvelopeV2Schema.safeParse(input);
    // Casts (not narrowing) so this compiles under the non-strict consumer
    // builds (tests/kafka/nonstrict-consumers.test.ts), where boolean-literal
    // discriminated unions do not narrow.
    if (!r.success) return { success: false, error: (r as z.SafeParseError<unknown>).error };
    const e = (r as z.SafeParseSuccess<z.infer<typeof EnvelopeV2Schema>>).data;
    return {
      success: true,
      envelope: {
        envelopeVersion: 2,
        topic: e.topic,
        schemaVersion: String(e.schemaVersion),
        correlationId: e.correlationId,
        occurredAt: e.occurredAt,
        payload: e.payload as T,
        eventId: e.eventId,
        aggregateType: e.aggregateType,
        aggregateId: e.aggregateId,
        aggregateVersion: e.aggregateVersion,
        producer: e.producer,
        causationId: e.causationId,
      },
    };
  }

  const r = EnvelopeV1Schema.safeParse(input);
  if (!r.success) return { success: false, error: (r as z.SafeParseError<unknown>).error };
  const e = (r as z.SafeParseSuccess<z.infer<typeof EnvelopeV1Schema>>).data;
  return {
    success: true,
    envelope: {
      envelopeVersion: 1,
      topic: e.topic,
      schemaVersion: e.version,
      correlationId: e.correlationId,
      occurredAt: e.occurredAt,
      payload: e.payload as T,
    },
  };
}

/** Kafka message key for a v2 envelope. v1 has no aggregate: the caller keeps its existing key. */
export function envelopePartitionKey(envelope: Pick<EnvelopeV2, 'aggregateId'>): string {
  return envelope.aggregateId;
}
