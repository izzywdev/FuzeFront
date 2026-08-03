import knex, { Knex } from 'knex'
import { enqueueEvent } from '../../src/events/outbox'
import { drainOutboxOnce, OutboxRecord } from '../../src/events/outboxRelay'

// In-memory sqlite stand-in for the shared `event_outbox` table (migration 009).
async function makeDb(): Promise<Knex> {
  const db = knex({
    client: 'sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  })
  await db.schema.createTable('event_outbox', table => {
    table.uuid('id').primary()
    table.string('topic').notNullable()
    table.text('payload').notNullable()
    table.string('correlation_id').notNullable()
    table.string('status').notNullable().defaultTo('pending')
    table.integer('attempts').notNullable().defaultTo(0)
    table.text('last_error').nullable()
    table.timestamp('created_at').notNullable().defaultTo(db.fn.now())
    table.timestamp('sent_at').nullable()
  })
  return db
}

describe('enqueueEvent (transactional outbox write)', () => {
  let db: Knex
  beforeEach(async () => {
    db = await makeDb()
  })
  afterEach(async () => {
    await db.destroy()
  })

  it('writes a pending row with the topic, payload and correlationId', async () => {
    await db.transaction(async trx => {
      await enqueueEvent(trx, 'identity.org.created', { organizationId: 'o1', slug: 'acme' }, 'corr-1')
    })

    const rows = await db('event_outbox')
    expect(rows).toHaveLength(1)
    expect(rows[0].topic).toBe('identity.org.created')
    expect(rows[0].status).toBe('pending')
    expect(rows[0].attempts).toBe(0)
    expect(rows[0].correlation_id).toBe('corr-1')
    expect(JSON.parse(rows[0].payload)).toEqual({ organizationId: 'o1', slug: 'acme' })
  })

  it('is atomic — a rolled-back transaction drops the event', async () => {
    await expect(
      db.transaction(async trx => {
        await enqueueEvent(trx, 'identity.org.created', { organizationId: 'o2' }, 'corr-2')
        // Simulate the state-change failing AFTER the event was enqueued.
        throw new Error('org insert failed')
      })
    ).rejects.toThrow('org insert failed')

    const rows = await db('event_outbox')
    expect(rows).toHaveLength(0)
  })
})

describe('drainOutboxOnce', () => {
  let db: Knex
  beforeEach(async () => {
    db = await makeDb()
  })
  afterEach(async () => {
    await db.destroy()
  })

  async function seed(topic: string, payload: unknown, correlationId: string): Promise<void> {
    await db.transaction(trx => enqueueEvent(trx, topic, payload, correlationId))
  }

  it('publishes every pending row and marks it sent', async () => {
    await seed('identity.org.created', { organizationId: 'o1' }, 'c1')
    await seed('identity.org.deleted', { organizationId: 'o1', cascade: 'soft' }, 'c2')

    const published: OutboxRecord[] = []
    const result = await drainOutboxOnce({
      db,
      publish: async record => {
        published.push(record)
      },
    })

    expect(result).toEqual({ sent: 2, failed: 0 })
    expect(published.map(r => r.topic)).toEqual(['identity.org.created', 'identity.org.deleted'])
    expect(published[0].payload).toEqual({ organizationId: 'o1' })
    const statuses = await db('event_outbox').pluck('status')
    expect(statuses).toEqual(['sent', 'sent'])
    const sentAts = await db('event_outbox').pluck('sent_at')
    expect(sentAts.every(Boolean)).toBe(true)
  })

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
    expect(await db('event_outbox').where('status', 'pending').count({ n: '*' }).first()).toEqual({ n: 3 })

    // Broker recovers: next drain sends all three.
    brokerUp = true
    const up = await drainOutboxOnce({ db, publish })
    expect(up).toEqual({ sent: 3, failed: 0 })
    expect(await db('event_outbox').where('status', 'sent').count({ n: '*' }).first()).toEqual({ n: 3 })
  })
})
