import { asSqlClient, type TxLike } from './db'
import { validateEnvelope, type EnvelopeV2 } from './envelope'

/**
 * Transactional-outbox write: inserts one v2 `event_outbox` row INSIDE the caller's
 * transaction, so the event commits (or rolls back) atomically with the state change.
 *
 * `trx` is the SAME handle that performs the state change: a knex transaction, a
 * node-postgres `PoolClient` that has issued `BEGIN`, or a `SqlClient` from this package.
 * Writes the columns of contracts/events/tables.md; `created_at` carries the envelope's
 * `occurredAt` (time of the state change). The relay later rebuilds the envelope from
 * the row and publishes it to Kafka keyed by `aggregate_id`.
 *
 * The caller owns `aggregateVersion`: it MUST be the value returned by
 * `UPDATE ... SET aggregate_version = aggregate_version + 1 ... RETURNING aggregate_version`
 * in the same transaction. A racing writer of the same version fails with a unique
 * violation on (aggregate_type, aggregate_id, aggregate_version) instead of forking history.
 */
export async function enqueueEvent(trx: TxLike, event: EnvelopeV2): Promise<void> {
  const e = validateEnvelope(event)
  await asSqlClient(trx).query(
    `INSERT INTO event_outbox
       (id, event_id, topic, payload, aggregate_type, aggregate_id, aggregate_version,
        producer, correlation_id, causation_id, schema_version, status, attempts, created_at)
     VALUES (gen_random_uuid(), $1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9, $10, 'pending', 0, $11)`,
    [
      e.eventId,
      e.topic,
      // Stringify explicitly: node-postgres would turn a JS array payload into a PG array.
      JSON.stringify(e.payload),
      e.aggregateType,
      e.aggregateId,
      e.aggregateVersion,
      e.producer,
      e.correlationId,
      e.causationId ?? null,
      e.schemaVersion,
      e.occurredAt,
    ]
  )
}
