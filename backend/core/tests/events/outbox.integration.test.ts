import knex, { Knex } from 'knex'
import { enqueueEvent, isPostgres } from '../../src/events/outbox'
import { drainOutboxOnce, OutboxRecord } from '../../src/events/outboxRelay'

/**
 * REAL-POSTGRES integration test for the transactional outbox (FFRNT-175).
 *
 * The unit test (`outbox.test.ts`) runs against in-memory sqlite, which cannot
 * exercise two things the production path depends on:
 *   1. the explicit `?::jsonb` cast in `enqueueEvent` (sqlite stores the JSON as
 *      text and `isPostgres()` is false, so that branch is never taken);
 *   2. `FOR UPDATE SKIP LOCKED` in the relay claim (a Postgres-only clause).
 *
 * This suite runs the SAME code against a real Postgres so both are covered, and
 * asserts business-write + event-enqueue commit/rollback atomically in one
 * transaction. It is SKIPPED unless a Postgres URL is provided (DATABASE_URL or
 * OUTBOX_TEST_PG_URL), so the normal infra-less test run is unaffected; CI's
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
})
