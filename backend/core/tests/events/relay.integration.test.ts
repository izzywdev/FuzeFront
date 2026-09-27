import knex, { Knex } from 'knex'
import {
  createKafkaClient,
  TypedProducer,
  TOPICS,
  dlqTopic,
} from '@fuzefront/shared/kafka'
import { enqueueEvent } from '../../src/events/outbox'
import { drainOutboxOnce } from '../../src/events/outboxRelay'
import {
  createKafkaOutboxPublisher,
  makeOutboxPublisher,
  ProducerLike,
} from '../../src/events/kafkaPublisher'

/**
 * REAL-BROKER integration test for the outbox → Kafka relay (FFRNT-175).
 *
 * Exercises the full relay against a real Kafka broker (CI's kafka-test, KRaft):
 *   - broker DOWN → rows stay `pending` (accumulate, no data loss); broker
 *     RECOVERS → the next drain publishes them and a consumer receives the
 *     FuzeEvent envelope (outbox durability + at-least-once delivery);
 *   - a poison row (payload fails its topic's frozen Zod schema, so the producer
 *     throws) is retried to `maxAttempts`, parked `failed`, and dead-lettered to
 *     `<topic>.dlq` — verified by consuming the DLQ.
 *
 * SKIPPED unless BOTH a Postgres URL and KAFKA_BROKERS are set; CI's
 * `event-propagation-integration` job provides both.
 */

const PG_URL = process.env.OUTBOX_TEST_PG_URL || process.env.DATABASE_URL
const BROKERS = (process.env.KAFKA_BROKERS || '')
  .split(',')
  .map(b => b.trim())
  .filter(Boolean)
const describeKafka = PG_URL && BROKERS.length ? describe : describe.skip

// Unique per run so a consumer reading a shared topic from the beginning can
// isolate exactly the messages this run produced.
const NONCE = `ffrnt175-${Date.now()}`
const ORG = '00000000-0000-4000-8000-0000000000aa'

/** Consume `topic` from the beginning, collecting messages that `match`, until
 *  `want` are seen or `timeoutMs` elapses. Fresh group id → replays history. */
async function collect(
  topic: string,
  opts: { match: (parsed: any) => boolean; want: number; timeoutMs?: number }
): Promise<any[]> {
  const kafka = createKafkaClient({ clientId: `it-consumer-${Date.now()}`, brokers: BROKERS })
  const consumer = kafka.consumer({ groupId: `it-group-${Date.now()}-${Math.random()}` })
  const got: any[] = []
  await consumer.connect()
  await consumer.subscribe({ topic, fromBeginning: true })
  await consumer.run({
    eachMessage: async ({ message }) => {
      const v = message.value?.toString()
      if (!v) return
      try {
        const parsed = JSON.parse(v)
        if (opts.match(parsed)) got.push(parsed)
      } catch {
        /* ignore non-JSON */
      }
    },
  })
  const deadline = Date.now() + (opts.timeoutMs ?? 15000)
  while (got.length < opts.want && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 250))
  }
  await consumer.disconnect()
  return got
}

describeKafka('outbox → Kafka relay against a real broker (FFRNT-175)', () => {
  let db: Knex

  beforeAll(async () => {
    db = knex({ client: 'pg', connection: PG_URL, pool: { min: 0, max: 5 } })
    await db.raw('DROP TABLE IF EXISTS event_outbox')
    await db.raw(`
      CREATE TABLE event_outbox (
        id uuid PRIMARY KEY,
        topic varchar(255) NOT NULL,
        payload jsonb NOT NULL,
        correlation_id varchar(128) NOT NULL,
        status varchar(20) NOT NULL DEFAULT 'pending',
        attempts integer NOT NULL DEFAULT 0,
        last_error text,
        created_at timestamptz NOT NULL DEFAULT now(),
        sent_at timestamptz
      )
    `)
  })

  afterAll(async () => {
    if (db) {
      await db.raw('DROP TABLE IF EXISTS event_outbox')
      await db.destroy()
    }
  })

  beforeEach(async () => {
    await db('event_outbox').del()
  })

  it(
    'accumulates pending rows while the broker is down, then drains and delivers on recovery',
    async () => {
      const c1 = `${NONCE}-recover-1`
      const c2 = `${NONCE}-recover-2`
      await db.transaction(trx =>
        enqueueEvent(trx, TOPICS.IDENTITY_ORG_DELETED, { organizationId: ORG, slug: 'acme', ownerId: null, cascade: 'soft' }, c1)
      )
      await db.transaction(trx =>
        enqueueEvent(trx, TOPICS.IDENTITY_ORG_DELETED, { organizationId: ORG, slug: 'acme', ownerId: null, cascade: 'hard' }, c2)
      )

      // ── Broker DOWN: point the publisher at an unreachable broker (retries:0
      //    → connect fails fast). Rows must survive as pending, not vanish.
      const deadKafka = createKafkaClient({
        clientId: 'it-relay-dead',
        brokers: ['localhost:9099'],
        retry: { retries: 0 },
      })
      const deadProducer = new TypedProducer(deadKafka)
      let deadConnected = false
      const deadPub = makeOutboxPublisher(async () => {
        if (!deadConnected) {
          await deadProducer.connect()
          deadConnected = true
        }
        return deadProducer as unknown as ProducerLike
      })

      const down = await drainOutboxOnce({ db, publish: deadPub.publish })
      expect(down).toEqual({ sent: 0, failed: 2 })
      const pendingStatuses = await db('event_outbox').pluck('status')
      expect(pendingStatuses).toEqual(['pending', 'pending'])

      // ── Broker RECOVERS: real publisher drains the accumulated rows.
      const publisher = createKafkaOutboxPublisher({ brokers: BROKERS, clientId: 'it-relay-real' })
      try {
        const up = await drainOutboxOnce({ db, publish: publisher.publish })
        expect(up).toEqual({ sent: 2, failed: 0 })
        const sentStatuses = await db('event_outbox').pluck('status')
        expect(sentStatuses.every(s => s === 'sent')).toBe(true)
      } finally {
        await publisher.disconnect()
      }

      // ── A consumer receives both events as FuzeEvent envelopes.
      const msgs = await collect(TOPICS.IDENTITY_ORG_DELETED, {
        match: p => typeof p?.correlationId === 'string' && p.correlationId.startsWith(`${NONCE}-recover-`),
        want: 2,
      })
      expect(msgs).toHaveLength(2)
      const byCorr = Object.fromEntries(msgs.map(m => [m.correlationId, m]))
      expect(byCorr[c1].topic).toBe(TOPICS.IDENTITY_ORG_DELETED)
      expect(byCorr[c1].payload).toMatchObject({ organizationId: ORG, cascade: 'soft' })
      expect(byCorr[c2].payload).toMatchObject({ organizationId: ORG, cascade: 'hard' })
    },
    30000
  )

  it(
    'dead-letters a poison row (schema-invalid payload) to <topic>.dlq after maxAttempts',
    async () => {
      const corr = `${NONCE}-poison`
      // Invalid: organizationId is not a UUID → identityOrgDeletedSchemaV1 rejects
      // it inside TypedProducer.send, so every publish attempt throws.
      await db.transaction(trx =>
        enqueueEvent(trx, TOPICS.IDENTITY_ORG_DELETED, { organizationId: 'not-a-uuid', slug: 'x', ownerId: null, cascade: 'soft' }, corr)
      )

      const publisher = createKafkaOutboxPublisher({ brokers: BROKERS, clientId: 'it-relay-dlq' })
      try {
        // maxAttempts:1 → first failure parks it 'failed' and dead-letters.
        const res = await drainOutboxOnce({
          db,
          publish: publisher.publish,
          onDeadLetter: publisher.deadLetter,
          maxAttempts: 1,
        })
        expect(res).toEqual({ sent: 0, failed: 1 })
      } finally {
        await publisher.disconnect()
      }

      const [row] = await db('event_outbox')
      expect(row.status).toBe('failed')
      expect(row.attempts).toBe(1)
      expect(row.last_error).toBeTruthy()

      const dlq = await collect(dlqTopic(TOPICS.IDENTITY_ORG_DELETED), {
        match: p => p?.raw?.correlationId === corr,
        want: 1,
      })
      expect(dlq).toHaveLength(1)
      expect(dlq[0].reason).toMatch(/max attempts/i)
      expect(dlq[0].raw.topic).toBe(TOPICS.IDENTITY_ORG_DELETED)
    },
    30000
  )
})
