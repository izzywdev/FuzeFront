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
      handler: async (env, trx) => { calls.push(env); await (opts.handler || A.projectionHandler)(env, trx) },
    })
    const sentinel = A.rawEnvelope({ topic, aggregateId: A.SENTINEL_AGG(), aggregateVersion: 1, payload: { kind: 'created', data: { s: 1 } } })
    await A.produceRaw(topic, [...events, sentinel].map((e) => ({ key: e.aggregateId, value: e })))
    await A.waitFor(async () => calls.some((c) => c.eventId === sentinel.eventId), 40000, 'sentinel consumed')
    await h.stop()
    return { topic, groupId, calls: calls.filter((c) => c.eventId !== sentinel.eventId), sentinel }
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

  for (const c of A.vectors('version-guard.json').cases) {
    A.acc(A.accName(`case 4: version-guard vector "${c.name}"`), async () => {
      const topic = A.newTopic()
      const evs = c.events.map((e: any) =>
        A.rawEnvelope({ topic, eventId: e.eventId, aggregateId: e.aggregateId, aggregateVersion: e.aggregateVersion, payload: { kind: e.kind, data: e.data } }))
      await A.createTopic(topic)
      const { calls, sentinel } = await run(evs, { topic })
      const applied = new Set(calls.map((x) => x.eventId))
      expect(evs.map((e: any) => (applied.has(e.eventId) ? 'applied' : 'ignored'))).toEqual(c.expectedOutcomes)
      expect(await stateSansSentinel(sentinel.aggregateId)).toEqual(c.expectedFinalState)
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

  // NOTE: the contract does not NAME the v1 fallback dedupe key (envelope.ts says only "a consumer that needs
  // dedupe ... must reject (or dead-letter) v1"). This asserts the BEHAVIOUR any fallback must give; the key
  // itself is not asserted. See PR description - question raised with the orchestrator.
  A.acc(A.accName('case 6b: the same v1 message redelivered is applied once (fallback dedupe)'), async () => {
    const topic = A.newTopic(); await A.createTopic(topic)
    const m = v1(topic)
    const { calls } = await run([m as any, m as any], { topic })
    expect(calls).toHaveLength(1)
    expect(await db('processed_events')).toHaveLength(2 - 1 + 1) // this one + the sentinel
  })
})
