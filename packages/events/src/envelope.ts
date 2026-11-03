import { mintId } from '@izzywdev/fuzefront-identity'
import { EnvelopeV2Schema, type EnvelopeV2 } from '@fuzefront/shared/kafka'

export type { EnvelopeV2, NormalizedEnvelope } from '@fuzefront/shared/kafka'

export class EnvelopeValidationError extends Error {
  constructor(public readonly issues: unknown, message: string) {
    super(message)
    this.name = 'EnvelopeValidationError'
  }
}

export interface BuildEventInput<T = unknown> {
  /** `<domain>.<name>[.<name>…]`, e.g. `identity.org.updated`. */
  topic: string
  /** Entity type segment, e.g. `organization`. */
  aggregateType: string
  /** Typed id (TypeID) of the entity the event is about; becomes the Kafka partition key. */
  aggregateId: string
  /** Value of the entity's `aggregate_version` AFTER the change (>= 1). */
  aggregateVersion: number
  /** Owning service name. */
  producer: string
  payload: T
  correlationId: string
  /** `eventId` of the event that caused this one. */
  causationId?: string
  /** Version of the topic's payload contract. Default 1. */
  schemaVersion?: number
  /** Time of the state change. Default: now. */
  occurredAt?: Date | string
}

/**
 * Builds a contract-valid v2 envelope. The `eventId` is minted here via
 * `mintId('event')` (identifier standard: the producer mints, never a caller),
 * and the result is validated with the frozen `EnvelopeV2Schema` from
 * `@fuzefront/shared/kafka` — the schema is not duplicated in this package.
 * Throws `EnvelopeValidationError` on any contract violation.
 */
export function buildEvent<T = unknown>(input: BuildEventInput<T>): EnvelopeV2<T> {
  const occurredAt =
    input.occurredAt === undefined
      ? new Date().toISOString()
      : input.occurredAt instanceof Date
        ? input.occurredAt.toISOString()
        : input.occurredAt
  const candidate: Record<string, unknown> = {
    eventId: mintId('event'),
    topic: input.topic,
    schemaVersion: input.schemaVersion ?? 1,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    aggregateVersion: input.aggregateVersion,
    producer: input.producer,
    occurredAt,
    correlationId: input.correlationId,
    payload: input.payload,
  }
  if (input.causationId !== undefined) candidate.causationId = input.causationId
  return validateEnvelope<T>(candidate)
}

/** Validates an already-assembled envelope against the contract schema. */
export function validateEnvelope<T = unknown>(candidate: unknown): EnvelopeV2<T> {
  const r = EnvelopeV2Schema.safeParse(candidate)
  if (!r.success) {
    const err = (r as { error: { issues: unknown[]; message: string } }).error
    throw new EnvelopeValidationError(err.issues, `invalid event envelope: ${err.message}`)
  }
  return (r as { data: unknown }).data as EnvelopeV2<T>
}
