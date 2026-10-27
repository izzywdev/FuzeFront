import { dlqTopic, parseEnvelope, type NormalizedEnvelope } from '@fuzefront/shared/kafka'
import type { Db, SqlClient } from './db'
import { childLogger, type EventsLogger } from './logger'

// ---------------------------------------------------------------------------
// Kafka port (structurally satisfied by a kafkajs `Kafka`; the testkit ships an in-memory double)
// ---------------------------------------------------------------------------
export interface KafkaMessageLike {
  key: Buffer | null
  value: Buffer | null
  offset: string
}
export interface EachMessageLike {
  topic: string
  partition: number
  message: KafkaMessageLike
}
export interface KafkaConsumerLike {
  connect(): Promise<void>
  subscribe(args: { topic: string; fromBeginning?: boolean }): Promise<void>
  run(config: { eachMessage: (payload: EachMessageLike) => Promise<void> }): Promise<void>
  disconnect(): Promise<void>
}
export interface KafkaProducerLike {
  connect(): Promise<void>
  send(record: { topic: string; messages: Array<{ key?: string; value: string }> }): Promise<unknown>
  disconnect(): Promise<void>
}
export interface KafkaLike {
  consumer(config: { groupId: string }): KafkaConsumerLike
  producer(): KafkaProducerLike
}

// ---------------------------------------------------------------------------
// Inbox port
// ---------------------------------------------------------------------------
/** Operations inside ONE inbox transaction. `sql` is the handle handlers write their effect with. */
export interface InboxTx {
  sql: SqlClient
  /** INSERT ... ON CONFLICT DO NOTHING; true if the row was newly inserted (not a duplicate). */
  markProcessed(consumer: string, eventId: string): Promise<boolean>
}
export interface InboxStore {
  transaction<T>(fn: (tx: InboxTx) => Promise<T>): Promise<T>
}

export function pgInboxStore(db: Db): InboxStore {
  return {
    transaction: (fn) =>
      db.transaction((sql) =>
        fn({
          sql,
          async markProcessed(consumer, eventId) {
            const r = await sql.query(
              `INSERT INTO processed_events (consumer, event_id) VALUES ($1, $2) ON CONFLICT (consumer, event_id) DO NOTHING`,
              [consumer, eventId]
            )
            return r.rowCount === 1
          }
        })
      ),
  }
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------
export type ConsumeOutcome = 'APPLIED' | 'DUPLICATE' | 'IGNORED' | 'DEAD_LETTERED'

export interface HandlerContext {
  /** The transaction the dedupe row + version guard are in: write your effect with this so it commits atomically. */
  tx: SqlClient
  consumer: string
  /** Dedupe key used: the eventId (v2) or `<topic>:<partition>:<offset>` (v1). */
  dedupeKey: string
  topic: string
  partition: number
  offset: string
  log: EventsLogger
}

export type EventHandler<T = unknown> = (event: NormalizedEnvelope<T>, ctx: HandlerContext) => Promise<void>

/** Throw from a handler to skip retries and dead-letter immediately (poison message). */
export class NonRetryableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NonRetryableError'
  }
}

export interface ConsumeInfo {
  outcome: ConsumeOutcome
  consumer: string
  topic: string
  partition: number
  offset: string
  eventId?: string
  aggregateId?: string
  aggregateVersion?: number
  attempts?: number
  elapsedMs: number
}

export interface ConsumerHooks {
  /** Metrics hook: called once per message with its final outcome. */
  onProcessed?(info: ConsumeInfo): void
  onRetry?(info: { topic: string; offset: string; attempt: number; error: Error }): void
}

export interface CreateConsumerOptions<T = unknown> {
  /** Consumer group id. Also the stable `consumer` key in `processed_events` / version table. */
  groupId: string
  topics: string[]
  /** Provide `db` (Postgres) or an explicit `inbox` store. */
  db?: Db
  inbox?: InboxStore
  /** Kafka client (a kafkajs `Kafka`, or the testkit's in-memory double). Required for `start()`. */
  kafka?: KafkaLike
  handler: EventHandler<T>
  /** Total tries per message (handler throw => rollback + retry). Default 5. */
  maxAttempts?: number
  /** Backoff before retry n (1-based). Default 100ms * 2^(n-1), capped at 5s. */
  backoffMs?: (attempt: number) => number
  /**
   * Optional version guard. The projection/handler OWNS the stored aggregate version (the runtime
   * keeps no version table). Return the stored version for the event's aggregate inside the
   * transaction (`null`/`undefined`/0 = no row). If `aggregateVersion <= stored` the outcome is
   * `IGNORED` (the eventId is still recorded in `processed_events`). v2 events only.
   * See `ProjectionGuard` in the testkit for a reference implementation of version-guard.json.
   */
  getStoredVersion?: (event: NormalizedEnvelope<T>, trx: SqlClient) => Promise<number | null | undefined>
  fromBeginning?: boolean
  logger?: EventsLogger
  hooks?: ConsumerHooks
  /** Injectable sleep (tests). */
  sleep?: (ms: number) => Promise<void>
}

export interface EventsConsumer {
  start(): Promise<void>
  stop(): Promise<void>
  /** Process one raw message (what `eachMessage` does). Exposed for tests and custom transports. */
  processMessage(msg: { topic: string; partition: number; offset: string; value: Buffer | string | null }): Promise<ConsumeOutcome>
}

const defaultBackoff = (attempt: number): number => Math.min(100 * 2 ** (attempt - 1), 5000)
const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Idempotent consumer runtime (data-consistency standard §4). For every message, in ONE db transaction:
 *
 *  1. `INSERT INTO processed_events (consumer, event_id) ... ON CONFLICT DO NOTHING` — zero rows
 *     means a duplicate: skip, commit nothing else.
 *  2. Version guard (v2, only when `getStoredVersion` is given): the projection owns the stored
 *     version; `aggregateVersion <= stored` => outcome IGNORED (version-guard.json: strictly greater
 *     applies). The eventId is still recorded as processed.
 *  3. Run `handler(event, ctx)` — write the effect with `ctx.tx` so it commits atomically.
 *
 * A throwing handler rolls the whole transaction back (so the dedupe row is NOT recorded) and the
 * message is retried with backoff up to `maxAttempts`, then published to `<topic>.dlq` and the offset
 * is committed (returns normally). Unparseable JSON/envelopes are dead-lettered immediately.
 * If the DLQ publish fails, the error is rethrown so Kafka redelivers.
 *
 * **v1 envelopes** (no `eventId`): the dedupe key is derived deterministically from the physical
 * message — `<topic>:<partition>:<offset>`. That dedupes redelivery/replay of the SAME offset
 * but NOT a logically-duplicate event the producer published twice (different offsets); v1 has no
 * aggregate version, so the version guard is skipped. Move producers to v2 for real idempotency.
 */
export function createConsumer<T = unknown>(opts: CreateConsumerOptions<T>): EventsConsumer {
  const inbox = opts.inbox ?? (opts.db ? pgInboxStore(opts.db) : undefined)
  if (!inbox) throw new Error('createConsumer: provide `db` or `inbox`')
  const { groupId, hooks } = opts
  const maxAttempts = opts.maxAttempts ?? 5
  const backoff = opts.backoffMs ?? defaultBackoff
  const sleep = opts.sleep ?? defaultSleep
  const log = opts.logger ?? childLogger('events-consumer', { groupId })

  let consumer: KafkaConsumerLike | undefined
  let dlqProducer: KafkaProducerLike | undefined

  async function deadLetter(
    msg: { topic: string; partition: number; offset: string },
    raw: string,
    reason: string,
    attempts: number
  ): Promise<void> {
    if (!dlqProducer) {
      throw new Error(`dead-letter needed for ${msg.topic}@${msg.offset} (${reason}) but no Kafka producer is available`)
    }
    await dlqProducer.send({
      topic: dlqTopic(msg.topic),
      messages: [
        {
          value: JSON.stringify({
            raw,
            reason,
            sourceTopic: msg.topic,
            partition: msg.partition,
            offset: msg.offset,
            consumer: groupId,
            attempts,
          }),
        },
      ],
    })
  }

  async function processMessage(msg: {
    topic: string
    partition: number
    offset: string
    value: Buffer | string | null
  }): Promise<ConsumeOutcome> {
    const started = Date.now()
    const done = (outcome: ConsumeOutcome, extra: Partial<ConsumeInfo> = {}): ConsumeOutcome => {
      const info: ConsumeInfo = {
        outcome,
        consumer: groupId,
        topic: msg.topic,
        partition: msg.partition,
        offset: msg.offset,
        elapsedMs: Date.now() - started,
        ...extra,
      }
      log.debug({ op: 'consume', ...info }, `consume ${outcome}`)
      hooks?.onProcessed?.(info)
      return outcome
    }

    if (msg.value === null) return done('IGNORED') // tombstone record / empty value: nothing to do
    const raw = msg.value.toString()

    let json: unknown
    try {
      json = JSON.parse(raw)
    } catch {
      await deadLetter(msg, raw, 'JSON parse failure', 0)
      log.error({ op: 'consume', topic: msg.topic, offset: msg.offset }, 'unparseable message dead-lettered')
      return done('DEAD_LETTERED', { attempts: 0 })
    }
    const parsed = parseEnvelope<T>(json)
    if (!parsed.success) {
      const reason = `invalid envelope: ${(parsed as { error: { message: string } }).error.message}`
      await deadLetter(msg, raw, reason, 0)
      log.error({ op: 'consume', topic: msg.topic, offset: msg.offset }, 'invalid envelope dead-lettered')
      return done('DEAD_LETTERED', { attempts: 0 })
    }
    const event = (parsed as { envelope: NormalizedEnvelope<T> }).envelope
    const dedupeKey =
      event.envelopeVersion === 2 ? (event.eventId as string) : `${msg.topic}:${msg.partition}:${msg.offset}`
    const ids = { eventId: event.eventId, aggregateId: event.aggregateId, aggregateVersion: event.aggregateVersion }

    let lastError: Error = new Error('unknown')
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const outcome = await inbox!.transaction<ConsumeOutcome>(async (tx) => {
          if (!(await tx.markProcessed(groupId, dedupeKey))) return 'DUPLICATE'
          if (opts.getStoredVersion && event.envelopeVersion === 2) {
            const stored = (await opts.getStoredVersion(event, tx.sql)) ?? 0
            if ((event.aggregateVersion as number) <= Number(stored)) return 'IGNORED'
          }
          await opts.handler(event, {
            tx: tx.sql,
            consumer: groupId,
            dedupeKey,
            topic: msg.topic,
            partition: msg.partition,
            offset: msg.offset,
            log,
          })
          return 'APPLIED'
        })
        return done(outcome, { ...ids, attempts: attempt })
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        const final = attempt >= maxAttempts || lastError instanceof NonRetryableError
        log.warn(
          { op: 'consume', topic: msg.topic, offset: msg.offset, eventId: event.eventId, attempt, final, err: lastError.message },
          'handler failed; transaction rolled back'
        )
        if (final) {
          await deadLetter(msg, raw, lastError.message, attempt)
          log.error({ op: 'consume.dlq', topic: msg.topic, offset: msg.offset, eventId: event.eventId, attempts: attempt }, 'event dead-lettered')
          return done('DEAD_LETTERED', { ...ids, attempts: attempt })
        }
        hooks?.onRetry?.({ topic: msg.topic, offset: msg.offset, attempt, error: lastError })
        await sleep(backoff(attempt))
      }
    }
    // Unreachable (loop always returns), kept for the type checker.
    throw lastError
  }

  return {
    processMessage,
    async start() {
      if (!opts.kafka) throw new Error('createConsumer.start: provide `kafka`')
      dlqProducer = opts.kafka.producer()
      await dlqProducer.connect()
      consumer = opts.kafka.consumer({ groupId })
      await consumer.connect()
      for (const topic of opts.topics) {
        await consumer.subscribe({ topic, fromBeginning: opts.fromBeginning ?? false })
      }
      await consumer.run({
        eachMessage: async ({ topic, partition, message }) => {
          await processMessage({ topic, partition, offset: message.offset, value: message.value })
        },
      })
    },
    async stop() {
      if (consumer) await consumer.disconnect()
      if (dlqProducer) await dlqProducer.disconnect()
      consumer = undefined
      dlqProducer = undefined
    },
  }
}
