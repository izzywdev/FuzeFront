import { Knex } from 'knex'
import { isPostgres } from './outbox'

/** One decoded outbox row handed to the publisher. */
export interface OutboxRecord {
  id: string
  topic: string
  payload: unknown
  correlationId: string
  attempts: number
}

/** Publishes one record to the bus. Throw to signal a retryable failure. */
export type OutboxPublish = (record: OutboxRecord) => Promise<void>

export interface OutboxRelayOptions {
  db: Knex
  /**
   * Transport-agnostic publish. The caller injects the Kafka wiring (envelope,
   * Zod schema, partition key) so this module stays free of a broker
   * dependency and is trivially unit-testable with a fake.
   */
  publish: OutboxPublish
  /** Rows claimed per drain pass. Default 20 (small — the claim holds a row lock across the publish). */
  batchSize?: number
  /** Attempts before a row is parked as 'failed'. Default 10. */
  maxAttempts?: number
  /** Optional hook invoked when a row is parked 'failed' (e.g. route to a DLQ). */
  onDeadLetter?: (record: OutboxRecord, error: Error) => Promise<void>
  logger?: { info: (m: string) => void; error: (m: string) => void }
}

export interface DrainResult {
  sent: number
  failed: number
}

function parsePayload(raw: unknown): unknown {
  return typeof raw === 'string' ? JSON.parse(raw) : raw
}

/**
 * Drain one batch of pending outbox rows.
 *
 * On Postgres the claim uses `FOR UPDATE SKIP LOCKED`, so multiple relay
 * replicas never publish the same row. Publishing happens inside the claiming
 * transaction: a publish failure increments `attempts` and leaves the row
 * 'pending' (retried on a later pass) until `maxAttempts`, after which it is
 * parked 'failed' (and dead-lettered if a hook is provided). Returns counts for
 * observability and tests.
 */
export async function drainOutboxOnce(opts: OutboxRelayOptions): Promise<DrainResult> {
  const { db, publish, batchSize = 20, maxAttempts = 10, onDeadLetter, logger } = opts
  let sent = 0
  let failed = 0

  await db.transaction(async trx => {
    let query = trx('event_outbox')
      .where('status', 'pending')
      .orderBy('created_at', 'asc')
      .limit(batchSize)
    if (isPostgres(trx)) {
      query = query.forUpdate().skipLocked()
    }
    const rows: any[] = await query

    for (const row of rows) {
      const record: OutboxRecord = {
        id: row.id,
        topic: row.topic,
        payload: parsePayload(row.payload),
        correlationId: row.correlation_id,
        attempts: row.attempts,
      }
      try {
        await publish(record)
        await trx('event_outbox')
          .where('id', row.id)
          .update({ status: 'sent', attempts: row.attempts + 1, sent_at: new Date() })
        sent++
      } catch (err) {
        const attempts = row.attempts + 1
        const parked = attempts >= maxAttempts
        await trx('event_outbox')
          .where('id', row.id)
          .update({
            status: parked ? 'failed' : 'pending',
            attempts,
            last_error: String((err as Error)?.message ?? err).slice(0, 1000),
          })
        failed++
        logger?.error(
          `outbox publish failed for ${row.topic} (${row.id}) attempt ${attempts}: ${String(err)}`
        )
        if (parked && onDeadLetter) {
          try {
            await onDeadLetter(record, err as Error)
          } catch {
            /* dead-letter is best-effort — never fail the drain */
          }
        }
      }
    }
  })

  return { sent, failed }
}

export interface OutboxRelayHandle {
  stop(): void
}

/**
 * Start a background relay that calls `drainOutboxOnce` on an interval. The poll
 * interval is the base retry delay; a Kafka outage simply means rows accumulate
 * as 'pending' and drain once publishing recovers. Returns a handle to stop it
 * (call on graceful shutdown).
 */
export function startOutboxRelay(
  opts: OutboxRelayOptions & { intervalMs?: number }
): OutboxRelayHandle {
  const intervalMs = opts.intervalMs ?? 1000
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | null = null

  const tick = async (): Promise<void> => {
    if (stopped) return
    try {
      const { sent, failed } = await drainOutboxOnce(opts)
      if (sent || failed) opts.logger?.info(`outbox relay: sent=${sent} failed=${failed}`)
    } catch (err) {
      opts.logger?.error(`outbox relay drain error: ${String(err)}`)
    } finally {
      if (!stopped) timer = setTimeout(tick, intervalMs)
    }
  }
  timer = setTimeout(tick, intervalMs)

  return {
    stop() {
      stopped = true
      if (timer) clearTimeout(timer)
    },
  }
}
