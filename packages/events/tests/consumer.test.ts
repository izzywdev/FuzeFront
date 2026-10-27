import { createConsumer, createOutboxRelay, NonRetryableError, silentLogger, type ConsumeOutcome } from '../src'
import { InMemoryKafka, MemoryInboxStore, MemoryOutboxStore, ProjectionGuard, duplicate, shuffle, replay } from '../src/testkit'
import { cases, ev, ORG_A, withId } from './helpers'

const msg = (value: unknown, offset = '0', topic = 'identity.org.updated') => ({
  topic,
  partition: 0,
  offset,
  value: Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)),
})

function mk(over: Partial<Parameters<typeof createConsumer>[0]> = {}) {
  const inbox = new MemoryInboxStore()
  const kafka = new InMemoryKafka()
  const calls: string[] = []
  const outcomes: ConsumeOutcome[] = []
  const consumer = createConsumer({
    groupId: 'g1',
    topics: ['identity.org.updated'],
    inbox,
    kafka,
    logger: silentLogger,
    sleep: async () => undefined,
    handler: async (e) => {
      calls.push(e.eventId as string)
    },
    hooks: { onProcessed: (i) => outcomes.push(i.outcome) },
    ...over,
  })
  return { inbox, kafka, calls, outcomes, consumer }
}

describe('consumer runtime', () => {
  it('dedupes: second delivery of the same eventId is a DUPLICATE and does not re-run the handler', async () => {
    const { consumer, calls } = mk()
    const e = ev(1)
    expect(await consumer.processMessage(msg(e, '0'))).toBe('APPLIED')
    expect(await consumer.processMessage(msg(e, '1'))).toBe('DUPLICATE')
    expect(calls).toHaveLength(1)
  })

  it('v1 envelope (no eventId): dedupe key is <topic>:<partition>:<offset>', async () => {
    const keys: string[] = []
    const { consumer, calls } = mk({ handler: async (_e, ctx) => { keys.push(ctx.dedupeKey) } })
    const v1 = { version: '1.0', topic: 'identity.org.updated', correlationId: 'c', occurredAt: '2026-10-05T12:00:00Z', payload: { a: 1 } }
    expect(await consumer.processMessage(msg(v1, '7'))).toBe('APPLIED')
    expect(await consumer.processMessage(msg(v1, '7'))).toBe('DUPLICATE') // same physical message (redelivery)
    expect(await consumer.processMessage(msg(v1, '8'))).toBe('APPLIED') // new offset: no identity in v1
    expect(keys).toEqual(['identity.org.updated:0:7', 'identity.org.updated:0:8'])
    void calls
  })

  it('handler failure rolls back the dedupe row, then retries and succeeds', async () => {
    let n = 0
    const retries: number[] = []
    const { consumer, inbox } = mk({
      handler: async () => { if (++n < 3) throw new Error('transient') },
      hooks: { onRetry: (i) => retries.push(i.attempt) },
    })
    expect(await consumer.processMessage(msg(ev(1)))).toBe('APPLIED')
    expect(n).toBe(3)
    expect(retries).toEqual([1, 2])
    expect(inbox.processed.size).toBe(1)
  })

  it('after bounded attempts: <topic>.dlq, dedupe row NOT recorded, offset committed', async () => {
    const { consumer, kafka, inbox } = mk({ maxAttempts: 3, handler: async () => { throw new Error('always') } })
    await consumer.start()
    const e = ev(1)
    kafka.produce(e.topic, JSON.stringify(e), e.aggregateId)
    await kafka.drain()
    expect(kafka.errors).toHaveLength(0)
    expect(inbox.processed.size).toBe(0)
    const [dlq] = kafka.json<any>('identity.org.updated.dlq')
    expect(dlq).toMatchObject({ reason: 'always', attempts: 3, sourceTopic: 'identity.org.updated', consumer: 'g1' })
  })

  it('NonRetryableError dead-letters immediately', async () => {
    let n = 0
    const { consumer, kafka } = mk({ handler: async () => { n++; throw new NonRetryableError('poison') } })
    await consumer.start()
    const e = ev(1)
    kafka.produce(e.topic, JSON.stringify(e))
    await kafka.drain()
    expect(n).toBe(1)
    expect(kafka.messages('identity.org.updated.dlq')).toHaveLength(1)
  })

  it.each([['non-JSON', 'not json{'], ['invalid envelope', JSON.stringify({ eventId: 'evt_bad', topic: 'x.y' })]])(
    '%s goes straight to <topic>.dlq without invoking the handler',
    async (_n, raw) => {
      const { consumer, kafka, calls } = mk()
      await consumer.start()
      kafka.produce('identity.org.updated', raw)
      await kafka.drain()
      expect(calls).toHaveLength(0)
      expect(kafka.json<any>('identity.org.updated.dlq')[0].attempts).toBe(0)
    }
  )

  it('rethrows (so Kafka redelivers) when the DLQ publish itself fails', async () => {
    const { consumer, kafka } = mk()
    await consumer.start()
    kafka.sendFailure = () => new Error('broker down')
    kafka.produce('identity.org.updated', 'garbage')
    await kafka.drain()
    expect(kafka.errors).toHaveLength(1)
    kafka.sendFailure = undefined
    await kafka.drain() // redelivered
    expect(kafka.messages('identity.org.updated.dlq')).toHaveLength(1)
  })

  it('getStoredVersion guard: aggregateVersion <= stored => IGNORED but eventId still recorded', async () => {
    const stored = new Map<string, number>([[ORG_A, 5]])
    const { consumer, inbox, calls } = mk({ getStoredVersion: async (e) => stored.get(e.aggregateId as string) })
    expect(await consumer.processMessage(msg(ev(5)))).toBe('IGNORED')
    expect(await consumer.processMessage(msg(ev(4)))).toBe('IGNORED')
    expect(await consumer.processMessage(msg(ev(6)))).toBe('APPLIED')
    expect(calls).toHaveLength(1)
    expect(inbox.processed.size).toBe(3)
  })
})

describe('conformance vectors: dedupe', () => {
  it.each(cases('dedupe.json', 'cases'))('%s', async (_n, c: any) => {
    const inbox = new MemoryInboxStore()
    const effects: Record<string, number> = {}
    const consumers = new Map<string, ReturnType<typeof createConsumer>>()
    const get = (g: string) => {
      if (!consumers.has(g)) {
        consumers.set(g, createConsumer({
          groupId: g, topics: [], inbox, logger: silentLogger,
          handler: async () => { effects[g] = (effects[g] ?? 0) + 1 },
        }))
      }
      return consumers.get(g)!
    }
    const outcomes: string[] = []
    let off = 0
    for (const d of c.deliveries) {
      const o = await get(d.consumer).processMessage(msg(withId(ev(1), d.eventId), String(off++)))
      outcomes.push(o.toLowerCase())
    }
    expect(outcomes).toEqual(c.expectedOutcomes)
    expect(effects).toEqual(c.expectedEffects)
  })
})

describe('conformance vectors: version guard', () => {
  it.each(cases('version-guard.json', 'cases'))('%s', async (_n, c: any) => {
    const proj = new ProjectionGuard<unknown>()
    const inbox = new MemoryInboxStore()
    const outcomes: string[] = []
    let off = 0
    for (const v of c.events) {
      // Handler is built per message so it can close over the vector's kind/data.
      const consumer = createConsumer({
        groupId: 'g', topics: [], inbox, logger: silentLogger,
        getStoredVersion: proj.getStoredVersion,
        handler: async (e) => { proj.apply(e as any, v.kind, v.data) },
      })
      const e = { ...ev(v.aggregateVersion, { aggregateId: v.aggregateId, topic: `identity.org.${v.kind}` }), eventId: v.eventId }
      const o = await consumer.processMessage(msg(e, String(off++), e.topic))
      outcomes.push(o === 'APPLIED' ? 'applied' : 'ignored')
    }
    expect(outcomes).toEqual(c.expectedOutcomes)
    for (const [id, st] of Object.entries<any>(c.expectedFinalState)) expect(proj.state.get(id)).toEqual(st)
  })
})

describe('end to end: relay -> Kafka -> consumer under duplicate + shuffled delivery', () => {
  it('converges: effects applied once per event, final state = highest version', async () => {
    const store = new MemoryOutboxStore()
    const kafka = new InMemoryKafka(3)
    const events = [1, 2, 3, 4, 5].map((v) => ev(v, { payload: { name: `n${v}` } }))
    events.forEach((e) => store.enqueue(e))
    const p = kafka.producer()
    await createOutboxRelay({ store, logger: silentLogger, transport: { send: (t, m) => p.send({ topic: t, messages: [m] }) as Promise<void> } }).drain()
    expect(kafka.messages('identity.org.updated')).toHaveLength(5)

    const proj = new ProjectionGuard<any>()
    let effects = 0
    const consumer = createConsumer({
      groupId: 'g', topics: ['identity.org.updated'], inbox: new MemoryInboxStore(), kafka, logger: silentLogger,
      getStoredVersion: proj.getStoredVersion,
      handler: async (e) => { effects++; proj.apply(e as any, 'updated', e.payload) },
    })
    await consumer.start()
    await kafka.drain()
    expect(effects).toBe(5)

    // Replay everything twice over, in hostile order: nothing re-applies.
    for (const seed of [1, 2, 3]) {
      replay(kafka, 'g', 'identity.org.updated')
      for (const m of shuffle(duplicate(kafka.messages('identity.org.updated'), 2), seed)) {
        await consumer.processMessage({ topic: 'identity.org.updated', partition: m.partition, offset: m.offset, value: Buffer.from(m.value) })
      }
    }
    expect(effects).toBe(5)
    expect(proj.state.get(ORG_A)).toEqual({ version: 5, deleted: false, data: { name: 'n5' } })
  })
})
