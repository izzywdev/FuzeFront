import { Knex } from 'knex'
import * as A from './adapter'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

A.describeInfra('cases 3-6: consumer', () => {
  let db: Knex
  beforeAll(async () => { db = A.connectDb() })
  afterAll(async () => { await A.closeRaw(); await db.destroy() })
  beforeEach(async () => { await A.resetSchema(db) })

  /** Send events in order, then a sentinel on its own aggregate; single partition => total order, so
   *  sentinel applied == everything before it was consumed (applied or ignored). */
  async function run(events: any[], opts: { groupId?: string; topic?: string; handler?: any } = {}) {
    const topic = opts.topic || A.newTopic(); if (!opts.topic) await A.createTopic(topic)
    const groupId = opts.groupId || 'acc-g-' + A.rnd()
    const calls: any[] = []
    const h = await A.startConsumer({
      groupId, topics: [topic], db,
      handler: async (env, tx, ctx) => { calls.push(env); await (opts.handler || A.projectionHandler)(env, tx, ctx) },
    })
    const sentinel = A.rawEnvelope({ topic, aggregateId: A.SENTINEL_AGG(), aggregateVersion: 1, payload: { kind: 'created', data: { s: 1 } } })
    await A.produceRaw(topic, [...events, sentinel].map((e) => ({ key: e.aggregateId, value: e })))
    await A.waitFor(async () => calls.some((c) => c.eventId === sentinel.eventId), 40000, 'sentinel consumed')
    await h.stop()
    return { topic, groupId, h, calls: calls.filter((c) => c.eventId !== sentinel.eventId), sentinel }
  }
  const stateSansSentinel = async (sentinelAgg: string) => {
    const s = await A.projState(db); delete s[sentinelAgg]; return s
  }

  A.acc(A.accName('case 3: same eventId delivered twice -> effect once, one processed_events row'), async () => {
    const topic = A.newTopic()
    const e = A.rawEnvelope({ topic, aggregateId: A.typeId('org'), aggregateVersion: 1, payload: { kind: 'created', data: { n: 1 } } })
    const { calls } = await run([e, e, e], { topic: (await A.createTopic(topic), topic) })
    expect(calls.filter((c) => c.eventId === e.eventId)).toHaveLength(1)
    expect(await db('acc_effects').where({ event_key: e.eventId })).toHaveLength(1)
    expect(await db('processed_events').where({ event_id: e.eventId })).toHaveLength(1)
  })

  for (const c of A.vectors('versionGuard').cases) {
    A.acc(A.accName(`case 4: version-guard vector "${c.name}"`), async () => {
      const topic = A.newTopic()
      const evs = c.events.map((e: any) =>
        A.rawEnvelope({ topic, eventId: e.eventId, aggregateId: e.aggregateId, aggregateVersion: e.aggregateVersion, payload: { kind: e.kind, data: e.data } }))
      await A.createTopic(topic)
      const { calls, sentinel } = await run(evs, { topic })
      const applied = new Set(calls.map((x) => x.eventId))
      expect(evs.map((e: any) => (applied.has(e.eventId) ? 'applied' : 'ignored'))).toEqual(c.expectedOutcomes)
      expect(await stateSansSentinel(sentinel.aggregateId)).toEqual(c.expectedFinalState)
      // IGNORED events are still recorded in processed_events (tables.md)
      for (const e of evs) expect(await db('processed_events').where({ event_id: e.eventId })).toHaveLength(1)
    })
  }

  // Case 5 - same final state for ordered, shuffled and from-scratch replay
  const history = (topic: string) => {
    const evs: any[] = []
    for (let i = 0; i < 6; i++) {
      const agg = A.typeId('org')
      evs.push(A.rawEnvelope({ topic, aggregateId: agg, aggregateVersion: 1, payload: { kind: 'created', data: { n: 1 } } }))
      for (let v = 2; v <= 4; v++) evs.push(A.rawEnvelope({ topic, aggregateId: agg, aggregateVersion: v, payload: { kind: 'updated', data: { n: v } } }))
      if (i % 2) evs.push(A.rawEnvelope({ topic, aggregateId: agg, aggregateVersion: 5, payload: { kind: 'deleted', data: null } }))
    }
    return evs
  }
  const shuffle = <T,>(a: T[], seed = 42) => {
    const r = [...a]; let s = seed
    for (let i = r.length - 1; i > 0; i--) { s = (s * 1103515245 + 12345) & 0x7fffffff; const j = s % (i + 1); [r[i], r[j]] = [r[j], r[i]] }
    return r
  }

  A.acc(A.accName('case 5: ordered == shuffled == replay-from-scratch (final state), with duplicates mixed in'), async () => {
    const t1 = A.newTopic(); await A.createTopic(t1)
    const evs = history(t1)
    const ordered = await run(evs, { topic: t1 })
    const s1 = await stateSansSentinel(ordered.sentinel.aggregateId)
    // expected = highest version per aggregate wins; deleted tombstones stay
    const expected: Record<string, any> = {}
    for (const e of evs) {
      const cur = expected[e.aggregateId]
      if (!cur || e.aggregateVersion > cur.version)
        expected[e.aggregateId] = { version: e.aggregateVersion, deleted: e.payload.kind === 'deleted', data: e.payload.data }
    }
    expect(s1).toEqual(expected)

    // from-scratch replay: wipe consumer state, brand-new group, same topic
    await db('acc_proj').del(); await db('processed_events').del(); await db('acc_effects').del()
    const h = await A.startConsumer({ groupId: 'acc-replay-' + A.rnd(), topics: [t1], db, handler: A.projectionHandler })
    await A.waitFor(async () => Object.keys(await A.projState(db)).length === Object.keys(expected).length + 1, 40000, 'replay')
    await sleep(2000); await h.stop()
    const s2 = await stateSansSentinel(ordered.sentinel.aggregateId)
    expect(s2).toEqual(expected)

    // shuffled (+ duplicates) delivery into a fresh consumer state
    await db('acc_proj').del(); await db('processed_events').del(); await db('acc_effects').del()
    const t2 = A.newTopic(); await A.createTopic(t2)
    const mixed = shuffle([...evs, ...evs.slice(0, 5)]).map((e) => ({ ...e, topic: t2 }))
    const shuffled = await run(mixed, { topic: t2 })
    expect(await stateSansSentinel(shuffled.sentinel.aggregateId)).toEqual(expected)
  })

  // Case 6 - v1 envelope back-compat (standard section 3: "v1 envelopes remain readable").
  const v1 = (topic: string) => ({ version: '1.0', topic, correlationId: 'corr-v1-' + A.rnd(), occurredAt: '2026-10-05T12:00:00Z', payload: { id: 'x', note: 'legacy' } })

  A.acc(A.accName('case 6: a v1 envelope is still consumed (handler sees it, no eventId/aggregate fields)'), async () => {
    const topic = A.newTopic(); await A.createTopic(topic)
    const m = v1(topic)
    const { calls } = await run([m as any], { topic })
    expect(calls).toHaveLength(1)
    expect(calls[0].payload).toEqual(m.payload)
    expect(calls[0].eventId).toBeUndefined()
  })

  // tables.md: v1 dedupe key is `<topic>:<partition>:<offset>`; it absorbs redelivery of the SAME record, not a
  // logically duplicate event re-published as a new record.
  A.acc(A.accName('case 6b: v1 dedupe key is <topic>:<partition>:<offset>; redelivery of the same record is a no-op'), async () => {
    const topic = A.newTopic(); await A.createTopic(topic)
    const m = v1(topic)
    const seen: any[] = []
    const h = await A.startConsumer({ groupId: 'acc-v1-' + A.rnd(), topics: [topic], db, handler: async (env, tx, ctx) => { seen.push(ctx); await A.projectionHandler(env, tx) } })
    await A.produceRaw(topic, [{ value: m }])
    await A.waitFor(async () => seen.length === 1, 40000, 'v1 consumed')
    const { partition, offset } = seen[0]
    const rows = await db('processed_events').select('event_id')
    expect(rows.map((r: any) => r.event_id)).toEqual([`${topic}:${partition}:${offset}`])
    // broker redelivers the same record
    expect(await h.redeliver(topic, Number(partition), Number(offset), m)).toBe('DUPLICATE')
    expect(await db('acc_effects')).toHaveLength(1)
    // the same v1 payload re-published as a NEW record is a different key (documented limit)
    await A.produceRaw(topic, [{ value: m }])
    await A.waitFor(async () => seen.length === 2, 40000, 'second v1 record consumed')
    await h.stop()
    expect(await db('processed_events')).toHaveLength(2)
  })

  // Consumer DLQ-on-handler-failure (standard section 4.3): bounded retries, rollback, <topic>.dlq, consumer keeps going.
  A.acc(A.accName('consumer: a handler that always throws is retried, rolled back (no dedupe row) and dead-lettered; later events still flow'), async () => {
    const topic = A.newTopic(); await A.createTopic(topic)
    const bad = A.rawEnvelope({ topic, aggregateId: A.typeId('org'), aggregateVersion: 1, payload: { kind: 'created', data: { poison: true } } })
    const good = A.rawEnvelope({ topic, aggregateId: A.typeId('org'), aggregateVersion: 1, payload: { kind: 'created', data: { ok: true } } })
    let attempts = 0
    const handler = async (env: any, tx: any) => {
      await A.projectionHandler(env, tx)
      if (env.eventId === bad.eventId) { attempts++; throw new Error('handler boom') }
    }
    const r = await run([bad, good], { topic, handler })
    expect(attempts).toBeGreaterThanOrEqual(2) // retried
    expect(r.calls.some((c: any) => c.eventId === good.eventId)).toBe(true)
    // rolled back: no effect, no projection row, no dedupe row for the poison event
    expect(await db('acc_effects').where({ event_key: bad.eventId })).toHaveLength(0)
    expect(await db('acc_proj').where({ aggregate_id: bad.aggregateId })).toHaveLength(0)
    expect(await db('processed_events').where({ event_id: bad.eventId })).toHaveLength(0)
    // dead-lettered with the original message
    const dlq = await A.readAll(`${topic}.dlq`)
    expect(dlq.length).toBeGreaterThanOrEqual(1)
    expect(JSON.stringify(dlq[0].value)).toContain(bad.eventId)
    expect(JSON.stringify(dlq[0].value)).toContain('handler boom')
  })
})
