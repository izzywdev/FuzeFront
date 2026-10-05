import knex, { Knex } from 'knex'
import { Pool } from 'pg'
import {
  createConsumer, createEventTables, createOutboxRelay, dropEventTables, enqueueEvent, knexDb, pgDb,
  requeueFailedEvent, silentLogger, upgradeEventOutboxToV2, finalizeEventOutboxV2, PRUNE_PROCESSED_EVENTS_SQL,
  pgSql, knexSql, type RelayTransport,
} from '../src'
import { mintId } from '@izzywdev/fuzefront-identity'
import { ProjectionGuard } from '../src/testkit'
import { ev, ORG_A, ORG_B } from './helpers'

const PG_URL = process.env.EVENTS_TEST_PG_URL || process.env.DATABASE_URL
const describePg = PG_URL ? describe : describe.skip

describePg('Postgres-backed outbox / relay / consumer', () => {
  let k: Knex
  let pool: Pool
  const db = () => knexDb(k as any)

  beforeAll(async () => {
    k = knex({ client: 'pg', connection: PG_URL, pool: { min: 0, max: 8 } })
    pool = new Pool({ connectionString: PG_URL, max: 8 })
    await k.raw('DROP TABLE IF EXISTS event_outbox, processed_events, it_effects CASCADE')
    await createEventTables(k as any)
    await k.raw('CREATE TABLE it_effects (event_id text PRIMARY KEY, v int)')
  })
  afterAll(async () => {
    await k.raw('DROP TABLE IF EXISTS event_outbox, processed_events, it_effects CASCADE')
    await k.destroy()
    await pool.end()
  })
  beforeEach(async () => {
    await k.raw('TRUNCATE event_outbox, processed_events, it_effects')
  })

  const collect = () => {
    const sent: Array<{ topic: string; key: string; v: any }> = []
    const transport: RelayTransport = { send: async (topic, m) => { sent.push({ topic, key: m.key, v: JSON.parse(m.value) }) } }
    return { sent, transport }
  }

  it('enqueueEvent writes the v2 columns via knex trx and via node-postgres client; rollback drops the event', async () => {
    const a = ev(1, { payload: [1, 2] }) // array payload must survive as jsonb
    await k.transaction(async (trx) => { await enqueueEvent(trx, a) })
    const b = ev(1, { aggregateId: ORG_B, causationId: a.eventId })
    const c = await pool.connect()
    try { await c.query('BEGIN'); await enqueueEvent(c, b); await c.query('COMMIT') } finally { c.release() }
    const lost = ev(2)
    await expect(k.transaction(async (trx) => { await enqueueEvent(trx, lost); throw new Error('rollback') })).rejects.toThrow('rollback')

    const rows = (await k.raw('SELECT * FROM event_outbox ORDER BY created_at')).rows
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ event_id: a.eventId, aggregate_type: 'organization', aggregate_id: ORG_A, producer: 'security-service', status: 'pending', schema_version: 1, payload: [1, 2] })
    expect(Number(rows[0].aggregate_version)).toBe(1)
    expect(rows[1].causation_id).toBe(a.eventId)
    expect(rows.map((r: any) => r.event_id)).not.toContain(lost.eventId)
  })

  it('unique (aggregate, version) rejects a forked history', async () => {
    await enqueueEvent(knexSql(k as any), ev(1))
    await expect(enqueueEvent(pgSql(pool), ev(1))).rejects.toThrow(/duplicate key|unique/i)
  })

  it('relay publishes per-aggregate in version order, marks sent; crash-before-publish leaves pending', async () => {
    const e3 = ev(3), e1 = ev(1), e2 = ev(2)
    for (const e of [e3, e1, e2]) await enqueueEvent(knexSql(k as any), e)
    const failing = createOutboxRelay({ db: db(), logger: silentLogger, transport: { send: async () => { throw new Error('killed') } } })
    await failing.drainOnce()
    expect((await k.raw(`SELECT count(*)::int n FROM event_outbox WHERE status='pending'`)).rows[0].n).toBe(3)
    const { sent, transport } = collect()
    await createOutboxRelay({ db: db(), transport, logger: silentLogger }).drain()
    expect(sent.map((s) => s.v.aggregateVersion)).toEqual([1, 2, 3])
    expect(sent.every((s) => s.key === ORG_A)).toBe(true)
    expect((await k.raw(`SELECT count(*)::int n FROM event_outbox WHERE status='sent' AND sent_at IS NOT NULL`)).rows[0].n).toBe(3)
  })

  it('FOR UPDATE SKIP LOCKED: concurrent relays never publish the same row', async () => {
    for (let i = 0; i < 40; i++) await enqueueEvent(knexSql(k as any), ev(1, { aggregateId: mintId('organization') }))
    const { sent, transport } = collect()
    const relays = [0, 1, 2, 3].map(() => createOutboxRelay({ db: db(), transport, batchSize: 5, logger: silentLogger }))
    await Promise.all(relays.map((r) => r.drain()))
    const ids = sent.map((s) => s.v.eventId)
    expect(ids).toHaveLength(40)
    expect(new Set(ids).size).toBe(40)
  })

  it('bounded attempts -> DLQ, row failed, failed head blocks later versions; requeue unblocks', async () => {
    const e1 = ev(1), e2 = ev(2)
    await enqueueEvent(knexSql(k as any), e1)
    await enqueueEvent(knexSql(k as any), e2)
    const sent: string[] = []
    let healthy = false
    const relay = createOutboxRelay({
      db: db(), maxAttempts: 2, logger: silentLogger,
      transport: { send: async (t, m) => {
        const v = JSON.parse(m.value)
        if (!t.endsWith('.dlq') && !healthy && v.aggregateVersion === 1) throw new Error('poison')
        sent.push(t + '#' + (v.aggregateVersion ?? v.raw.aggregateVersion))
      } },
    })
    await relay.drainOnce() // attempt 1 (v1 retry, v2 blocked)
    await relay.drainOnce() // attempt 2 -> dlq
    await relay.drainOnce() // v2 stays blocked by the failed v1
    expect(sent).toEqual(['identity.org.updated.dlq#1'])
    const st = (await k.raw(`SELECT status, attempts, last_error FROM event_outbox WHERE event_id=?`, [e1.eventId])).rows[0]
    expect(st).toMatchObject({ status: 'failed', attempts: 2, last_error: 'poison' })
    expect(await requeueFailedEvent(knexSql(k as any), e1.eventId)).toBe(true)
    expect((await k.raw(`SELECT status FROM event_outbox WHERE event_id=?`, [e1.eventId])).rows[0].status).toBe('pending')
    healthy = true
    await relay.drain()
    expect(sent.slice(1)).toEqual(['identity.org.updated#1', 'identity.org.updated#2'])
  })

  describe('consumer', () => {
    const mkConsumer = (handler: any, extra: any = {}) => createConsumer({
      groupId: 'pg-g', topics: [], db: db(), logger: silentLogger, sleep: async () => undefined, handler, ...extra,
    })
    const m = (e: any, offset = '0') => ({ topic: e.topic, partition: 0, offset, value: Buffer.from(JSON.stringify(e)) })

    it('effect + dedupe row commit atomically; duplicate skips the effect', async () => {
      const c = mkConsumer(async (e: any, ctx: any) => { await ctx.tx.query('INSERT INTO it_effects VALUES ($1, 1)', [e.eventId]) })
      const e = ev(1)
      expect(await c.processMessage(m(e))).toBe('APPLIED')
      expect(await c.processMessage(m(e, '1'))).toBe('DUPLICATE')
      expect((await k.raw('SELECT count(*)::int n FROM it_effects')).rows[0].n).toBe(1)
      expect((await k.raw('SELECT count(*)::int n FROM processed_events WHERE consumer=?', ['pg-g'])).rows[0].n).toBe(1)
    })

    it('handler failure after writing rolls back BOTH the effect and the dedupe row', async () => {
      let n = 0
      const c = mkConsumer(async (e: any, ctx: any) => {
        await ctx.tx.query('INSERT INTO it_effects VALUES ($1, 1)', [e.eventId])
        if (++n === 1) throw new Error('after write')
      })
      const e = ev(1)
      expect(await c.processMessage(m(e))).toBe('APPLIED')
      expect(n).toBe(2)
      expect((await k.raw('SELECT count(*)::int n FROM it_effects')).rows[0].n).toBe(1) // not 2 (no PK violation either)
    })

    it('concurrent deliveries of one event apply exactly once', async () => {
      const c = mkConsumer(async (e: any, ctx: any) => { await ctx.tx.query('INSERT INTO it_effects VALUES ($1, 1)', [e.eventId]) })
      const e = ev(1)
      const outs = await Promise.all([0, 1, 2, 3, 4].map((i) => c.processMessage(m(e, String(i)))))
      expect(outs.filter((o) => o === 'APPLIED')).toHaveLength(1)
      expect(outs.filter((o) => o === 'DUPLICATE')).toHaveLength(4)
    })

    it('getStoredVersion reads the projection inside the tx; stale event is IGNORED but recorded', async () => {
      await k.raw('CREATE TABLE IF NOT EXISTS it_proj (aggregate_id text PRIMARY KEY, v bigint NOT NULL)')
      await k.raw('TRUNCATE it_proj')
      const c = mkConsumer(
        async (e: any, ctx: any) => {
          await ctx.tx.query('INSERT INTO it_proj VALUES ($1,$2) ON CONFLICT (aggregate_id) DO UPDATE SET v = EXCLUDED.v', [e.aggregateId, e.aggregateVersion])
        },
        { getStoredVersion: async (e: any, trx: any) => (await trx.query('SELECT v FROM it_proj WHERE aggregate_id=$1', [e.aggregateId])).rows[0]?.v }
      )
      expect(await c.processMessage(m(ev(2)))).toBe('APPLIED')
      const old = ev(1)
      expect(await c.processMessage(m(old, '1'))).toBe('IGNORED')
      expect((await k.raw('SELECT count(*)::int n FROM processed_events WHERE event_id=?', [old.eventId])).rows[0].n).toBe(1)
      await k.raw('DROP TABLE it_proj')
      void ProjectionGuard
    })
  })

  it('migration helpers: up/down, v1 -> v2 upgrade then finalize, prune SQL', async () => {
    await k.raw('DROP TABLE IF EXISTS event_outbox, processed_events')
    await k.raw(`DO $$ BEGIN CREATE TYPE outbox_status_enum AS ENUM ('pending','sent','failed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`)
    await k.raw(`CREATE TABLE event_outbox (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), topic varchar(255) NOT NULL, payload jsonb NOT NULL,
      correlation_id varchar(128) NOT NULL, status outbox_status_enum NOT NULL DEFAULT 'pending', attempts int NOT NULL DEFAULT 0,
      last_error text, created_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz)`)
    await k.raw(`INSERT INTO event_outbox (topic, payload, correlation_id) VALUES ('a.b', '{}', 'c')`) // legacy v1 row
    await upgradeEventOutboxToV2(k as any)
    await upgradeEventOutboxToV2(k as any) // idempotent
    await enqueueEvent(knexSql(k as any), ev(1)) // v2 writes work during the window
    await k.raw(`DELETE FROM event_outbox WHERE event_id IS NULL`) // "backfill" stand-in
    await finalizeEventOutboxV2(k as any)
    await expect(k.raw(`INSERT INTO event_outbox (topic,payload,correlation_id) VALUES ('a.b','{}','c')`)).rejects.toThrow(/null value/)
    await k.raw(`INSERT INTO processed_events (consumer,event_id,processed_at) VALUES ('c','old', now() - interval '40 days'), ('c','new', now())`)
    await knexSql(k as any).query(PRUNE_PROCESSED_EVENTS_SQL, [30])
    expect((await k.raw('SELECT event_id FROM processed_events')).rows.map((r: any) => r.event_id)).toEqual(['new'])
    await dropEventTables(k as any)
    expect((await k.raw(`SELECT to_regclass('event_outbox') r`)).rows[0].r).toBeNull()
  })
})
