import { Knex } from 'knex'
import * as A from './adapter'

// Case 1 - outbox atomicity (tables.md "event_outbox"; standard section 3).
A.describeInfra('case 1: outbox atomicity', () => {
  let db: Knex
  beforeAll(async () => { db = A.connectDb(); await A.resetSchema(db) })
  afterAll(async () => { await A.closeRaw(); await db.destroy() })
  beforeEach(async () => { await db('event_outbox').del(); await db('acc_business').del() })

  const ev = (topic: string, agg: string, v = 1) =>
    A.buildEvent({ topic, aggregateType: 'organization', aggregateId: agg, aggregateVersion: v, payload: { id: agg, name: 'Acme' } })

  A.acc(A.accName('rollback leaves neither state change nor outbox row, and nothing is published'), async () => {
    const topic = A.newTopic(); await A.createTopic(topic)
    const agg = A.typeId('org')
    await expect(
      db.transaction(async (trx) => {
        await trx('acc_business').insert({ id: agg, name: 'Acme' })
        await A.enqueue(trx, ev(topic, agg))
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(await db('acc_business')).toHaveLength(0)
    expect(await db('event_outbox')).toHaveLength(0)
    await A.drain(db, { publish: await A.realPublisher() })
    expect(await A.readAll(topic, 2500)).toHaveLength(0)
  })

  A.acc(A.accName('commit writes a pending row carrying the contract columns'), async () => {
    const topic = A.newTopic(); const agg = A.typeId('org')
    const e = ev(topic, agg)
    await db.transaction(async (trx) => { await trx('acc_business').insert({ id: agg, name: 'Acme' }); await A.enqueue(trx, e) })
    const rows = await db('event_outbox')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ topic, aggregate_type: 'organization', aggregate_id: agg, status: 'pending', attempts: 0 })
    expect(Number(rows[0].aggregate_version)).toBe(1)
    expect(rows[0].event_id).toMatch(/^evt_[0-7][0-9a-hjkmnp-tv-z]{25}$/)
  })

  A.acc(A.accName('crash after commit, before relay: a later relay publishes exactly that event once'), async () => {
    const topic = A.newTopic(); await A.createTopic(topic); const agg = A.typeId('org')
    await db.transaction(async (trx) => { await A.enqueue(trx, ev(topic, agg)) })
    const [row] = await db('event_outbox')
    // "crash": no relay ran. A fresh relay (new connection/process equivalent) now drains.
    const db2 = A.connectDb()
    try { await A.drain(db2, { publish: await A.realPublisher() }) } finally { await db2.destroy() }
    await A.drain(db, { publish: await A.realPublisher() }) // second relay must not re-publish
    const msgs = await A.readAll(topic)
    expect(msgs).toHaveLength(1)
    expect(msgs[0].key).toBe(agg) // partition key = aggregateId
    expect(msgs[0].value.eventId).toBe(row.event_id)
    expect(A.validateEnvelopeV2(msgs[0].value)).toBe(true)
    expect(msgs[0].value.aggregateVersion).toBe(1)
    expect((await db('event_outbox'))[0].status).toBe('sent')
  })

  A.acc(A.accName('one event per aggregate version: a second writer at the same version fails'), async () => {
    const topic = A.newTopic(); const agg = A.typeId('org')
    await db.transaction(async (trx) => { await A.enqueue(trx, ev(topic, agg, 1)) })
    await expect(db.transaction(async (trx) => { await A.enqueue(trx, ev(topic, agg, 1)) })).rejects.toBeDefined()
    expect(await db('event_outbox')).toHaveLength(1)
  })
})
