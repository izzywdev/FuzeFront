import knex, { Knex } from 'knex'
import { enqueueEvent, isPostgres } from '../../src/events/outbox'
import { drainOutboxOnce, OutboxRecord } from '../../src/events/outboxRelay'

/**
 * REAL-POSTGRES integration test for the transactional outbox (FFRNT-175).
 *
 * Postgres is the only supported datastore (the in-memory sqlite test fallback
 * was removed). This suite therefore owns the full outbox/relay coverage against
 * a real Postgres — the two production-only concerns a portable-SQL fake could
 * never exercise:
 *   1. the explicit `?::jsonb` cast in `enqueueEvent`;
 *   2. `FOR UPDATE SKIP LOCKED` in the relay claim;
 * plus atomic business-write + event-enqueue commit/rollback, and the drain
 * control-flow (retry / attempts / dead-letter / recovery) over real rows.
 *
 * It is SKIPPED unless a Postgres URL is provided (DATABASE_URL or
 * OUTBOX_TEST_PG_URL), so an infra-less `npm test` is unaffected; CI's
 * `event-propagation-integration` job sets it.
 */

const PG_URL = process.env.OUTBOX_TEST_PG_URL || process.env.DATABASE_URL
const describePg = PG_URL ? describe : describe.skip

describePg('transactional outbox against real Postgres (FFRNT-175)', () => {
  let db: Knex

  beforeAll(async () => {
    db = knex({ client: 'pg', connection: PG_URL, pool: { min: 0, max: 5 } })
    // Recreate the shared tables fresh so the suite is self-contained and
    // idempotent regardless of what else ran against this CI database.
    await db.raw('DROP TABLE IF EXISTS event_outbox')
    await db.raw('DROP TABLE IF EXISTS it_business')
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
    await db.raw(`CREATE TABLE it_business (id uuid PRIMARY KEY, name text NOT NULL)`)
  })

  afterAll(async () => {
    if (db) {
      await db.raw('DROP TABLE IF EXISTS event_outbox')
      await db.raw('DROP TABLE IF EXISTS it_business')
      await db.destroy()
    }
  })

  beforeEach(async () => {
    await db('event_outbox').del()
    await db('it_business').del()
  })

  it('takes the Postgres (::jsonb) branch — isPostgres() is true for the real connection', async () => {
    expect(isPostgres(db)).toBe(true)
    await db.transaction(async trx => {
      expect(isPostgres(trx)).toBe(true)
    })
  })

  it('commits the business row and the event atomically, and stores payload as real jsonb', async () => {
    const orgId = '00000000-0000-4000-8000-000000000001'
    await db.transaction(async trx => {
      await trx('it_business').insert({ id: orgId, name: 'acme' })
      await enqueueEvent(
        trx,
        'identity.org.created',
        { organizationId: orgId, slug: 'acme', nested: { a: 1, b: [true, null, 'x'] } },
        'corr-pg-1'
      )
    })

    expect(await db('it_business').count({ n: '*' }).first()).toEqual({ n: '1' })
    const rows = await db('event_outbox')
    expect(rows).toHaveLength(1)
    // pg returns a jsonb column already parsed into an object (NOT a string) —
    // proof the `?::jsonb` cast stored real jsonb, not a quoted text blob.
    expect(typeof rows[0].payload).toBe('object')
    expect(rows[0].payload).toEqual({
      organizationId: orgId,
      slug: 'acme',
      nested: { a: 1, b: [true, null, 'x'] },
    })
    expect(rows[0].status).toBe('pending')
  })

  it('rolls back the event WITH the business write when the transaction fails', async () => {
    const orgId = '00000000-0000-4000-8000-000000000002'
    await expect(
      db.transaction(async trx => {
        await trx('it_business').insert({ id: orgId, name: 'doomed' })
        await enqueueEvent(trx, 'identity.org.created', { organizationId: orgId }, 'corr-pg-2')
        throw new Error('business rule failed after enqueue')
      })
    ).rejects.toThrow('business rule failed after enqueue')

    // No dual-write gap: neither side survived.
    expect(await db('it_business').count({ n: '*' }).first()).toEqual({ n: '0' })
    expect(await db('event_outbox').count({ n: '*' }).first()).toEqual({ n: '0' })
  })

  it('drains pending rows over the FOR UPDATE SKIP LOCKED claim and decodes jsonb payloads', async () => {
    await db.transaction(trx =>
      enqueueEvent(trx, 'identity.org.created', { organizationId: 'o1', k: 'v1' }, 'c1')
    )
    await db.transaction(trx =>
      enqueueEvent(trx, 'identity.org.deleted', { organizationId: 'o1', cascade: 'soft' }, 'c2')
    )

    const published: OutboxRecord[] = []
    const result = await drainOutboxOnce({
      db,
      publish: async record => {
        published.push(record)
      },
    })

    expect(result).toEqual({ sent: 2, failed: 0 })
    // Payloads handed to the publisher are decoded objects (from jsonb), ready to
    // wrap in a FuzeEvent envelope — no double-encoding.
    expect(published.map(r => r.payload)).toEqual([
      { organizationId: 'o1', k: 'v1' },
      { organizationId: 'o1', cascade: 'soft' },
    ])
    const statuses = await db('event_outbox').orderBy('created_at').pluck('status')
    expect(statuses).toEqual(['sent', 'sent'])
  })

  // Drain control-flow (retry / attempts / dead-letter / recovery). These assert
  // the relay's own logic with a fake publish fn — no broker — but over real
  // Postgres rows, which is why they live here (the sqlite unit suite that used
  // to cover them was removed with the sqlite fallback). The real-broker
  // transport is covered separately in relay.integration.test.ts.
  async function seed(topic: string, payload: unknown, correlationId: string): Promise<void> {
    await db.transaction(trx => enqueueEvent(trx, topic, payload, correlationId))
  }

  it('keeps a row pending and increments attempts on a publish failure', async () => {
    await seed('identity.org.created', { organizationId: 'o1' }, 'c1')

    const result = await drainOutboxOnce({
      db,
      publish: async () => {
        throw new Error('kafka down')
      },
    })

    expect(result).toEqual({ sent: 0, failed: 1 })
    const [row] = await db('event_outbox')
    expect(row.status).toBe('pending')
    expect(row.attempts).toBe(1)
    expect(row.last_error).toContain('kafka down')
  })

  it('parks a row as failed and dead-letters it after maxAttempts', async () => {
    await seed('identity.org.created', { organizationId: 'o1' }, 'c1')
    const deadLettered: OutboxRecord[] = []

    // maxAttempts=2 → first drain leaves it pending(attempts=1), second parks it.
    const opts = {
      db,
      maxAttempts: 2,
      publish: async () => {
        throw new Error('permanent')
      },
      onDeadLetter: async (record: OutboxRecord) => {
        deadLettered.push(record)
      },
    }
    await drainOutboxOnce(opts)
    await drainOutboxOnce(opts)

    const [row] = await db('event_outbox')
    expect(row.status).toBe('failed')
    expect(row.attempts).toBe(2)
    expect(deadLettered).toHaveLength(1)
    expect(deadLettered[0].topic).toBe('identity.org.created')
  })

  it('drains accumulated rows once publishing recovers (Kafka-down resilience)', async () => {
    await seed('identity.org.created', { organizationId: 'o1' }, 'c1')
    await seed('identity.org.created', { organizationId: 'o2' }, 'c2')
    await seed('identity.org.created', { organizationId: 'o3' }, 'c3')

    let brokerUp = false
    const publish = async () => {
      if (!brokerUp) throw new Error('kafka down')
    }

    // Broker down: all three stay pending.
    const down = await drainOutboxOnce({ db, publish })
    expect(down).toEqual({ sent: 0, failed: 3 })
    expect(await db('event_outbox').where('status', 'pending').count({ n: '*' }).first()).toEqual({ n: '3' })

    // Broker recovers: next drain sends all three.
    brokerUp = true
    const up = await drainOutboxOnce({ db, publish })
    expect(up).toEqual({ sent: 3, failed: 0 })
    expect(await db('event_outbox').where('status', 'sent').count({ n: '*' }).first()).toEqual({ n: '3' })
  })
})
