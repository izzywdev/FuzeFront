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
    await A.drain(db, { transport: await A.realTransport() })
    const msgs = await A.readAll(topic)
    expect(msgs).toHaveLength(6)
    for (const agg of [a, b]) {
      const versions = msgs.filter((m) => m.key === agg).map((m) => m.value.aggregateVersion)
      expect(versions).toEqual([...versions].sort((x, y) => x - y))
    }
    expect(msgs.filter((m) => m.key === a).map((m) => m.value.aggregateVersion)).toEqual([1, 2, 3, 4])
  })

  A.acc(A.accName('failed head: DLQ after max attempts, STILL blocks its aggregate (not others); requeue then publishes in order'), async () => {
    const topic = A.newTopic(); await A.createTopic(topic)
    const a = A.typeId('org'), b = A.typeId('org')
    for (const v of [1, 2, 3]) { await enq(topic, a, v); await enq(topic, b, v) }
    const real = await A.realTransport()
    const MAX = 3
    let poisoned = true
    const failing: A.Transport = {
      send: async (t, m) => {
        const env = JSON.parse(m.value)
        if (poisoned && t === topic && m.key === a && env.aggregateVersion === 1) throw new Error('broker rejected')
        return real.send(t, m)
      },
    }
    await A.drain(db, { transport: failing, maxAttempts: MAX, rounds: MAX + 3 })

    const rows = async () => db('event_outbox').orderBy(['aggregate_id', 'aggregate_version'])
    const st = (rs: any[], agg: string, v: number) => rs.find((r: any) => r.aggregate_id === agg && Number(r.aggregate_version) === v)
    let rs = await rows()
    for (const v of [1, 2, 3]) expect(st(rs, b, v).status).toBe('sent') // other aggregate unaffected
    expect(st(rs, a, 1).status).toBe('failed')
    expect(st(rs, a, 1).attempts).toBeGreaterThanOrEqual(MAX)
    expect(st(rs, a, 1).last_error).toContain('broker rejected')
    expect(st(rs, a, 2).status).toBe('pending'); expect(st(rs, a, 3).status).toBe('pending')
    let main = await A.readAll(topic)
    expect(main.filter((m) => m.key === a)).toHaveLength(0) // v2/v3 never published past a failed head
    expect(main.filter((m) => m.key === b).map((m) => m.value.aggregateVersion)).toEqual([1, 2, 3])
    const dlq = await A.readAll(`${topic}.dlq`)
    expect(dlq.length).toBeGreaterThanOrEqual(1)
    expect(JSON.stringify(dlq[0].value)).toContain(st(rs, a, 1).event_id)

    // dead-lettering does NOT unblock: more passes (even with a healthy transport) publish nothing for `a`
    poisoned = false
    await A.drain(db, { transport: failing, maxAttempts: MAX, rounds: 3 })
    expect((await A.readAll(topic)).filter((m) => m.key === a)).toHaveLength(0)

    // operator requeue: back to pending, last_error kept as audit trail, then ordered publish
    expect(await A.requeue(db, st(rs, a, 1).event_id)).toBe(true)
    rs = await rows()
    expect(st(rs, a, 1).status).toBe('pending'); expect(st(rs, a, 1).attempts).toBe(0)
    expect(st(rs, a, 1).last_error).toContain('broker rejected')
    await A.drain(db, { transport: failing, maxAttempts: MAX, rounds: 5 })
    main = await A.readAll(topic)
    expect(main.filter((m) => m.key === a).map((m) => m.value.aggregateVersion)).toEqual([1, 2, 3])
    rs = await rows()
    for (const v of [1, 2, 3]) expect(st(rs, a, v).status).toBe('sent')
  })

  A.acc(A.accName('two concurrent relays never publish the same row twice (FOR UPDATE SKIP LOCKED); per-aggregate order kept'), async () => {
    const topic = A.newTopic(); await A.createTopic(topic)
    const aggs = Array.from({ length: 10 }, () => A.typeId('org'))
    for (const agg of aggs) for (const v of [1, 2, 3]) await enq(topic, agg, v)
    const real = await A.realTransport()
    const sent: string[] = []
    const slow: A.Transport = { send: async (t, m) => { await new Promise((r) => setTimeout(r, 40)); sent.push(JSON.parse(m.value).eventId); return real.send(t, m) } }
    const db2 = A.connectDb()
    try {
      await Promise.all([
        A.drain(db, { transport: slow, rounds: 12, batchSize: 4 }),
        A.drain(db2, { transport: slow, rounds: 12, batchSize: 4 }),
      ])
    } finally { await db2.destroy() }
    expect(sent).toHaveLength(30)
    expect(new Set(sent).size).toBe(30) // no double publish
    expect((await db('event_outbox').where({ status: 'sent' })).length).toBe(30)
    const msgs = await A.readAll(topic)
    for (const agg of aggs) expect(msgs.filter((m) => m.key === agg).map((m) => m.value.aggregateVersion)).toEqual([1, 2, 3])
  })
})
