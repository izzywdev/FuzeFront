import { Knex } from 'knex'
import * as A from './adapter'

// Case 2 - relay ordering, head-of-line blocking, DLQ (tables.md "Relay ordering and claim rule").
A.describeInfra('case 2: relay ordering', () => {
  let db: Knex
  beforeAll(async () => { db = A.connectDb(); await A.resetSchema(db) })
  afterAll(async () => { await A.closeRaw(); await db.destroy() })
  beforeEach(async () => { await db('event_outbox').del() })

  const enq = (topic: string, agg: string, v: number) =>
    db.transaction((trx) =>
      A.enqueue(trx, A.buildEvent({ topic, aggregateType: 'organization', aggregateId: agg, aggregateVersion: v, payload: { id: agg, v } })),
    )

  A.acc(A.accName('published per aggregate in aggregate_version order, regardless of insertion order'), async () => {
    const topic = A.newTopic(); await A.createTopic(topic)
    const a = A.typeId('org'), b = A.typeId('org')
    // insertion order deliberately scrambled; created_at order != version order
    for (const [agg, v] of [[a, 3], [b, 1], [a, 1], [b, 2], [a, 2], [a, 4]] as [string, number][]) await enq(topic, agg, v)
    await A.drain(db, { publish: await A.realPublisher() })
    const msgs = await A.readAll(topic)
    expect(msgs).toHaveLength(6)
    for (const agg of [a, b]) {
      const versions = msgs.filter((m) => m.key === agg).map((m) => m.value.aggregateVersion)
      expect(versions).toEqual([...versions].sort((x, y) => x - y))
    }
    expect(msgs.filter((m) => m.key === a).map((m) => m.value.aggregateVersion)).toEqual([1, 2, 3, 4])
  })

  A.acc(A.accName('a failed head row blocks later versions of its aggregate but not other aggregates; then DLQ after max attempts'), async () => {
    const topic = A.newTopic(); await A.createTopic(topic)
    const a = A.typeId('org'), b = A.typeId('org')
    for (const v of [1, 2, 3]) { await enq(topic, a, v); await enq(topic, b, v) }
    const real = await A.realPublisher()
    const MAX = 3
    const failing: A.Publish = async (t, key, env) => {
      if (t === topic && key === a && env.aggregateVersion === 1) throw new Error('broker rejected')
      return real(t, key, env)
    }
    await A.drain(db, { publish: failing, maxAttempts: MAX, rounds: MAX + 2 })

    const rows = await db('event_outbox').orderBy(['aggregate_id', 'aggregate_version'])
    const st = (agg: string, v: number) => rows.find((r: any) => r.aggregate_id === agg && Number(r.aggregate_version) === v)
    // other aggregate fully delivered
    for (const v of [1, 2, 3]) expect(st(b, v).status).toBe('sent')
    // head failed + dead-lettered; successors NEVER published (a consumer must not see v2 without v1)
    expect(st(a, 1).status).toBe('failed')
    expect(st(a, 1).attempts).toBeGreaterThanOrEqual(MAX)
    expect(st(a, 2).status).toBe('pending'); expect(st(a, 3).status).toBe('pending')
    const main = await A.readAll(topic)
    expect(main.filter((m) => m.key === a)).toHaveLength(0)
    expect(main.filter((m) => m.key === b).map((m) => m.value.aggregateVersion)).toEqual([1, 2, 3])
    const dlq = await A.readAll(`${topic}.dlq`)
    expect(dlq.length).toBeGreaterThanOrEqual(1)
    expect(JSON.stringify(dlq[0].value)).toContain(st(a, 1).event_id)
  })
})
