import { dlqTopic, envelopePartitionKey } from '@fuzefront/shared/kafka'
import type { Db, SqlClient } from './db'
import { validateEnvelope, type EnvelopeV2 } from './envelope'
import { childLogger, type EventsLogger } from './logger'

/** One outbox row as the relay sees it (already decoded). */
export interface OutboxRow {
  id: string
  eventId: string
  topic: string
  payload: unknown
  aggregateType: string
  aggregateId: string
  aggregateVersion: number
  producer: string
  correlationId: string
  causationId: string | null
  schemaVersion: number
  attempts: number
  occurredAt: string
}

/** Operations available on rows claimed in one pass (all inside the claiming transaction). */
export interface ClaimOps {
  markSent(row: OutboxRow): Promise<void>
  /** Record a failed attempt; the row stays `pending` (and keeps blocking its aggregate). */
  markRetry(row: OutboxRow, error: string): Promise<void>
  /** Park the row as `failed` (its DLQ copy is already written; later versions of the aggregate continue). */
  markFailed(row: OutboxRow, error: string): Promise<void>
}

/**
 * Storage port for the relay. `pgOutboxStore` is the production implementation;
 * the testkit ships an in-memory one with the SAME claim semantics.
 */
export interface OutboxStore {
  /**
   * Claim up to `batchSize` claimable rows and run `fn` with them. Claimable = `pending` and
   * no lower-version row of the same aggregate is still `pending` (head-of-line). A `failed` row has already been copied to the DLQ and does not block.
   * Mutations made through `ops` commit/rollback together with the claim.
   */
  claim<T>(batchSize: number, fn: (rows: OutboxRow[], ops: ClaimOps) => Promise<T>): Promise<T>
}

/** Transport port: one message to one topic. Throw to signal a (retryable) failure. */
export interface RelayTransport {
  send(topic: string, message: { key: string; value: string }): Promise<void>
}

/** Adapts a kafkajs-style producer (`send({topic, messages})`) to a `RelayTransport`. */
export function kafkaTransport(producer: {
  send(record: { topic: string; messages: Array<{ key?: string; value: string }> }): Promise<unknown>
}): RelayTransport {
  return {
    async send(topic, message) {
      await producer.send({ topic, messages: [message] })
    },
  }
}

function toIso(v: unknown): string {
  return v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString()
}

/** Rebuilds the wire envelope from an outbox row. Throws `EnvelopeValidationError` if the row is not contract-valid. */
export function rowToEnvelope(row: OutboxRow): EnvelopeV2 {
  return validateEnvelope({
    eventId: row.eventId,
    topic: row.topic,
    schemaVersion: row.schemaVersion,
    aggregateType: row.aggregateType,
    aggregateId: row.aggregateId,
    aggregateVersion: row.aggregateVersion,
    producer: row.producer,
    occurredAt: row.occurredAt,
    correlationId: row.correlationId,
    ...(row.causationId ? { causationId: row.causationId } : {}),
    payload: row.payload,
  })
}

const CLAIM_SQL = `
SELECT o.id, o.event_id, o.topic, o.payload, o.aggregate_type, o.aggregate_id, o.aggregate_version,
       o.producer, o.correlation_id, o.causation_id, o.schema_version, o.attempts, o.created_at
FROM event_outbox o
WHERE o.status = 'pending'
  AND NOT EXISTS (
    SELECT 1 FROM event_outbox p
    WHERE p.aggregate_type = o.aggregate_type
      AND p.aggregate_id = o.aggregate_id
      AND p.aggregate_version < o.aggregate_version
      AND p.status = 'pending'
  )
ORDER BY o.created_at ASC, o.aggregate_version ASC
LIMIT $1
FOR UPDATE OF o SKIP LOCKED`

function decode(r: any): OutboxRow {
  return {
    id: r.id,
    eventId: r.event_id,
    topic: r.topic,
    payload: typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload,
    aggregateType: r.aggregate_type,
    aggregateId: r.aggregate_id,
    // bigint comes back from node-postgres as a string.
    aggregateVersion: Number(r.aggregate_version),
    producer: r.producer,
    correlationId: r.correlation_id,
    causationId: r.causation_id ?? null,
    schemaVersion: Number(r.schema_version),
    attempts: Number(r.attempts),
    occurredAt: toIso(r.created_at),
  }
}

function pgOps(tx: SqlClient): ClaimOps {
  return {
    async markSent(row) {
      await tx.query(
        `UPDATE event_outbox SET status = 'sent', attempts = attempts + 1, sent_at = now(), last_error = NULL WHERE id = $1`,
        [row.id]
      )
    },
    async markRetry(row, error) {
      await tx.query(`UPDATE event_outbox SET attempts = attempts + 1, last_error = $2 WHERE id = $1`, [
        row.id,
        error.slice(0, 1000),
      ])
    },
    async markFailed(row, error) {
      await tx.query(
        `UPDATE event_outbox SET status = 'failed', attempts = attempts + 1, last_error = $2 WHERE id = $1`,
        [row.id, error.slice(0, 1000)]
      )
    },
  }
}

/** Postgres outbox store: `FOR UPDATE SKIP LOCKED`, per-aggregate head-of-line ordering (tables.md). */
export function pgOutboxStore(db: Db): OutboxStore {
  return {
    claim: (batchSize, fn) =>
      db.transaction(async (tx) => {
        const res = await tx.query(CLAIM_SQL, [batchSize])
        return fn(res.rows.map(decode), pgOps(tx))
      }),
  }
}

/**
 * Operator action for a parked (`failed`, dead-lettered) row: put it back to `pending` with a
 * fresh attempt budget (after fixing the cause). Note later versions may already have been
 * published; consumers' version guard absorbs the late, lower version.
 */
export async function requeueFailedEvent(db: SqlClient, eventId: string): Promise<boolean> {
  const r = await db.query(
    `UPDATE event_outbox SET status = 'pending', attempts = 0, last_error = NULL WHERE event_id = $1 AND status = 'failed'`,
    [eventId]
  )
  return r.rowCount > 0
}

export interface RelayHooks {
  onPublished?(row: OutboxRow): void
  onRetry?(row: OutboxRow, error: Error, attempt: number): void
  onDeadLetter?(row: OutboxRow, error: Error): void
}

export interface OutboxRelayOptions {
  /** Provide `db` (Postgres) or an explicit `store`. */
  db?: Db
  store?: OutboxStore
  transport: RelayTransport
  /** Rows claimed per pass. Default 20 (the claim holds row locks across the publishes). */
  batchSize?: number
  /** Failed attempts before the row is parked `failed` and dead-lettered. Default 10. */
  maxAttempts?: number
  /** Poll interval for `start()`. Default 1000 ms. */
  intervalMs?: number
  /** Max claim passes per tick while progress is being made. Default 50. */
  maxPassesPerTick?: number
  logger?: EventsLogger
  hooks?: RelayHooks
}

export interface DrainResult {
  sent: number
  retried: number
  deadLettered: number
}

export interface OutboxRelay {
  /** One claim pass. */
  drainOnce(): Promise<DrainResult>
  /** Repeat passes until a pass makes no progress (or `maxPassesPerTick`). */
  drain(): Promise<DrainResult>
  start(): void
  /** Graceful: stops scheduling and resolves once any in-flight tick has finished. */
  stop(): Promise<void>
}

/**
 * Generalised transactional-outbox relay (successor of backend/core `drainOutboxOnce`).
 *
 * - Claim: `FOR UPDATE SKIP LOCKED`, so replicas never publish the same row.
 * - Order: PER AGGREGATE by `aggregate_version`; only the head `pending` row of an aggregate is
 *   claimable, so a failing (still retrying) head blocks only its own aggregate. Different aggregates interleave.
 * - Publish with key = `aggregateId`; mark `sent` only after the transport resolves.
 * - Failure: attempts++ and the row stays `pending`; at `maxAttempts` the envelope is sent to
 *   `<topic>.dlq` and the row is parked `failed`; the aggregate's later versions then continue
 *   (`requeueFailedEvent` re-queues it). If the DLQ send itself fails the row stays `pending` (retried).
 * - Crash between commit and publish is safe: the row is still `pending`, the next pass publishes it.
 *   A crash between publish and commit re-publishes; consumers dedupe on `eventId`.
 */
export function createOutboxRelay(opts: OutboxRelayOptions): OutboxRelay {
  const store = opts.store ?? (opts.db ? pgOutboxStore(opts.db) : undefined)
  if (!store) throw new Error('createOutboxRelay: provide `db` or `store`')
  const { transport, hooks } = opts
  const batchSize = opts.batchSize ?? 20
  const maxAttempts = opts.maxAttempts ?? 10
  const intervalMs = opts.intervalMs ?? 1000
  const maxPasses = opts.maxPassesPerTick ?? 50
  const log = opts.logger ?? childLogger('events-relay')

  let stopped = true
  let timer: ReturnType<typeof setTimeout> | null = null
  let inflight: Promise<void> = Promise.resolve()

  async function drainOnce(): Promise<DrainResult> {
    const res: DrainResult = { sent: 0, retried: 0, deadLettered: 0 }
    await store!.claim(batchSize, async (rows, ops) => {
      for (const row of rows) {
        const started = Date.now()
        try {
          const envelope = rowToEnvelope(row)
          await transport.send(row.topic, {
            key: envelopePartitionKey(envelope),
            value: JSON.stringify(envelope),
          })
          await ops.markSent(row)
          res.sent++
          log.debug({ op: 'outbox.publish', eventId: row.eventId, topic: row.topic, elapsedMs: Date.now() - started }, 'published')
          hooks?.onPublished?.(row)
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err))
          const attempt = row.attempts + 1
          if (attempt < maxAttempts) {
            await ops.markRetry(row, error.message)
            res.retried++
            log.warn({ op: 'outbox.publish', eventId: row.eventId, topic: row.topic, attempt, err: error.message }, 'publish failed; will retry')
            hooks?.onRetry?.(row, error, attempt)
            continue
          }
          try {
            await transport.send(dlqTopic(row.topic), {
              key: row.aggregateId,
              value: JSON.stringify({
                raw: row,
                reason: 'outbox max attempts exhausted',
                error: error.message,
                attempts: attempt,
              }),
            })
          } catch (dlqErr) {
            // Never park a row whose DLQ copy was not written: keep it pending.
            await ops.markRetry(row, `${error.message}; DLQ send failed: ${String(dlqErr)}`)
            res.retried++
            log.error({ op: 'outbox.dlq', eventId: row.eventId, topic: row.topic, err: String(dlqErr) }, 'DLQ send failed; row kept pending')
            continue
          }
          await ops.markFailed(row, error.message)
          res.deadLettered++
          log.error({ op: 'outbox.dlq', eventId: row.eventId, topic: row.topic, aggregateId: row.aggregateId, attempts: attempt, err: error.message }, 'event dead-lettered; later versions of the aggregate continue')
          hooks?.onDeadLetter?.(row, error)
        }
      }
    })
    return res
  }

  async function drain(): Promise<DrainResult> {
    const total: DrainResult = { sent: 0, retried: 0, deadLettered: 0 }
    for (let i = 0; i < maxPasses; i++) {
      const r = await drainOnce()
      total.sent += r.sent
      total.retried += r.retried
      total.deadLettered += r.deadLettered
      // Continue only while rows are being published. A pass with a retry stops here so the
      // failing row is retried on the next tick (interval = base backoff), not in a hot loop.
      if (r.sent === 0 || r.retried > 0) break
    }
    return total
  }

  function schedule(): void {
    if (stopped) return
    timer = setTimeout(() => {
      inflight = (async () => {
        try {
          await drain()
        } catch (err) {
          log.error({ op: 'outbox.drain', err: String(err) }, 'relay drain error')
        } finally {
          schedule()
        }
      })()
    }, intervalMs)
  }

  return {
    drainOnce,
    drain,
    start() {
      if (!stopped) return
      stopped = false
      schedule()
    },
    async stop() {
      stopped = true
      if (timer) clearTimeout(timer)
      await inflight
    },
  }
}
