import { createOutboxRelay, silentLogger, type RelayTransport } from '../src'
import { MemoryOutboxStore, InMemoryKafka } from '../src/testkit'
import { ev, ORG_A, ORG_B } from './helpers'

function setup(opts: { maxAttempts?: number; transport?: RelayTransport } = {}) {
  const store = new MemoryOutboxStore()
  const kafka = new InMemoryKafka(3)
  const producer = kafka.producer()
  const transport: RelayTransport = opts.transport ?? {
    send: (topic, m) => producer.send({ topic, messages: [m] }) as Promise<void>,
  }
  const relay = createOutboxRelay({ store, transport, maxAttempts: opts.maxAttempts ?? 3, logger: silentLogger })
  return { store, kafka, relay, transport }
}

describe('outbox relay', () => {
  it('publishes pending rows keyed by aggregateId and marks them sent', async () => {
    const { store, kafka, relay } = setup()
    const e = ev(1)
    store.enqueue(e)
    expect(await relay.drainOnce()).toEqual({ sent: 1, retried: 0, deadLettered: 0 })
    expect(store.status(e.eventId)).toBe('sent')
    const [m] = kafka.messages(e.topic)
    expect(m.key).toBe(ORG_A)
    expect(JSON.parse(m.value)).toEqual(e)
  })

  it('orders per aggregate by aggregate_version regardless of insert/created order', async () => {
    const { store, kafka, relay } = setup()
    const v1 = ev(1), v2 = ev(2), v3 = ev(3)
    // Enqueue out of order with identical timestamps; version must win.
    for (const e of [v3, v1, v2]) store.enqueue({ ...e, occurredAt: '2026-10-05T12:00:00.000Z' })
    await relay.drain()
    expect(kafka.json<any>(v1.topic).map((m) => m.aggregateVersion)).toEqual([1, 2, 3])
  })

  it('interleaves different aggregates freely', async () => {
    const { store, kafka, relay } = setup()
    store.enqueue(ev(1, { aggregateId: ORG_A }))
    store.enqueue(ev(1, { aggregateId: ORG_B }))
    expect((await relay.drainOnce()).sent).toBe(2)
    expect(kafka.messages('identity.org.updated')).toHaveLength(2)
  })

  it('crash between commit and publish: the row stays pending and the next relay publishes it', async () => {
    const store = new MemoryOutboxStore()
    const e = ev(1)
    store.enqueue(e) // "state change committed"
    const crashing = createOutboxRelay({
      store,
      logger: silentLogger,
      transport: { send: async () => { throw new Error('process killed') } },
    })
    await crashing.drainOnce()
    expect(store.status(e.eventId)).toBe('pending')
    const kafka = new InMemoryKafka()
    const p = kafka.producer()
    const survivor = createOutboxRelay({
      store,
      logger: silentLogger,
      transport: { send: (t, m) => p.send({ topic: t, messages: [m] }) as Promise<void> },
    })
    await survivor.drainOnce()
    expect(store.status(e.eventId)).toBe('sent')
    expect(kafka.messages(e.topic)).toHaveLength(1)
  })

  it('head-of-line: a failing v1 blocks v2 of the same aggregate but not other aggregates', async () => {
    const sent: string[] = []
    const failFor = new Set<string>([ORG_A])
    const { store, relay } = setup({
      maxAttempts: 5,
      transport: {
        send: async (_t, m) => {
          if (failFor.has(m.key)) throw new Error('broker down')
          sent.push(m.key + ':' + JSON.parse(m.value).aggregateVersion)
        },
      },
    })
    store.enqueue(ev(1, { aggregateId: ORG_A }))
    store.enqueue(ev(2, { aggregateId: ORG_A }))
    store.enqueue(ev(1, { aggregateId: ORG_B }))
    const r = await relay.drainOnce()
    expect(r).toMatchObject({ sent: 1, retried: 1 })
    expect(sent).toEqual([`${ORG_B}:1`])
    // A's v2 was never attempted while v1 pending.
    expect(store.rows.find((x) => x.aggregateId === ORG_A && x.aggregateVersion === 2)!.attempts).toBe(0)
    failFor.clear()
    await relay.drain()
    expect(sent).toEqual([`${ORG_B}:1`, `${ORG_A}:1`, `${ORG_A}:2`])
  })

  it('bounded attempts then DLQ: <topic>.dlq, row parked failed, a failed head STILL blocks later versions; other aggregates unaffected; requeue unblocks', async () => {
    const store = new MemoryOutboxStore()
    const kafka = new InMemoryKafka(3)
    const producer = kafka.producer()
    const dead: string[] = []
    let healthy = false
    const v1 = ev(1), v2 = ev(2)
    const relay = createOutboxRelay({
      store,
      maxAttempts: 2,
      logger: silentLogger,
      hooks: { onDeadLetter: (row) => dead.push(row.eventId) },
      transport: {
        send: async (topic, m) => {
          // v1 never publishes on its main topic; the DLQ and v2 work.
          if (!topic.endsWith('.dlq') && !healthy && m.key === ORG_A && JSON.parse(m.value).aggregateVersion === 1) throw new Error('boom')
          await producer.send({ topic, messages: [m] })
        },
      },
    })
    store.enqueue(v1)
    store.enqueue(v2)
    expect((await relay.drainOnce()).retried).toBe(1) // attempt 1; v2 blocked while v1 pending
    expect(store.status(v2.eventId)).toBe('pending')
    expect((await relay.drainOnce()).deadLettered).toBe(1) // attempt 2 => DLQ
    expect(store.status(v1.eventId)).toBe('failed')
    expect(dead).toEqual([v1.eventId])
    const [dlq] = kafka.json<any>('identity.org.updated.dlq')
    expect(dlq.raw.eventId).toBe(v1.eventId)
    expect(dlq.reason).toMatch(/max attempts/)
    expect(await relay.drainOnce()).toEqual({ sent: 0, retried: 0, deadLettered: 0 }) // v2 blocked by failed v1
    expect(store.status(v2.eventId)).toBe('pending')
    // other aggregates are unaffected
    store.enqueue(ev(1, { aggregateId: ORG_B }))
    expect((await relay.drainOnce()).sent).toBe(1)
    expect(store.status(v2.eventId)).toBe('pending')
    // operator requeue unblocks (transport now healthy for v1)
    expect(store.requeue(v1.eventId)).toBe(true)
    expect(store.rows.find((r) => r.eventId === v1.eventId)).toMatchObject({ attempts: 0, lastError: 'boom' })
    healthy = true
    await relay.drain()
    expect(store.status(v1.eventId)).toBe('sent')
    expect(store.status(v2.eventId)).toBe('sent')
  })

  it('crash after publish but before mark-sent republishes the SAME eventId', async () => {
    const store = new MemoryOutboxStore()
    const kafka = new InMemoryKafka()
    const p = kafka.producer()
    const e = ev(1)
    store.enqueue(e)
    const transport = { send: (t: string, m: any) => p.send({ topic: t, messages: [m] }) as Promise<void> }
    // First relay publishes but its transaction "dies" before commit: simulate by claiming then throwing.
    await expect(
      store.claim(10, async (rows) => {
        await transport.send(rows[0].topic, { key: rows[0].aggregateId, value: JSON.stringify(e) })
        throw new Error('killed before mark-sent')
      })
    ).rejects.toThrow('killed')
    expect(store.status(e.eventId)).toBe('pending')
    await createOutboxRelay({ store, transport, logger: silentLogger }).drainOnce()
    const ids = kafka.json<any>(e.topic).map((m) => m.eventId)
    expect(ids).toEqual([e.eventId, e.eventId])
  })

  it('does not park a row whose DLQ copy could not be written', async () => {
    const { store, relay: _r } = setup()
    const relay = createOutboxRelay({
      store,
      maxAttempts: 1,
      logger: silentLogger,
      transport: { send: async () => { throw new Error('everything down') } },
    })
    const e = ev(1)
    store.enqueue(e)
    const r = await relay.drainOnce()
    expect(r).toMatchObject({ deadLettered: 0, retried: 1 })
    expect(store.status(e.eventId)).toBe('pending')
  })

  it('start()/stop() drains on an interval and stop() is graceful', async () => {
    const { store, kafka, relay: _x } = setup()
    const p = kafka.producer()
    const relay = createOutboxRelay({
      store,
      intervalMs: 5,
      logger: silentLogger,
      transport: { send: (t, m) => p.send({ topic: t, messages: [m] }) as Promise<void> },
    })
    store.enqueue(ev(1))
    relay.start()
    await new Promise((r) => setTimeout(r, 60))
    await relay.stop()
    expect(kafka.messages('identity.org.updated')).toHaveLength(1)
    store.enqueue(ev(2))
    await new Promise((r) => setTimeout(r, 30))
    expect(kafka.messages('identity.org.updated')).toHaveLength(1) // stopped: nothing more published
  })
})
