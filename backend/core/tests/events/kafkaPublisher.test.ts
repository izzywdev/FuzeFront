import { makeOutboxPublisher, startOutboxRelayFromEnv, ProducerLike } from '../../src/events/kafkaPublisher'
import { OutboxRecord } from '../../src/events/outboxRelay'

type SendCall = { topic: string; event: any; hasSchema: boolean; key?: string }
type RawCall = { topic: string; key?: string; value: string }

function fakeProducer() {
  const sends: SendCall[] = []
  const raws: RawCall[] = []
  let disconnected = false
  const producer: ProducerLike = {
    async send(topic, event, schema, options) {
      sends.push({ topic, event, hasSchema: !!schema, key: options?.key })
    },
    raw: {
      async send(payload) {
        for (const m of payload.messages) raws.push({ topic: payload.topic, key: m.key, value: m.value })
        return undefined
      },
    },
    async disconnect() {
      disconnected = true
    },
  }
  return { producer, sends, raws, get disconnected() { return disconnected } }
}

const rec = (topic: string, payload: unknown, correlationId = 'c1'): OutboxRecord => ({
  id: 'id-1',
  topic,
  payload,
  correlationId,
  attempts: 0,
})

describe('makeOutboxPublisher', () => {
  it('validates against the registry schema and keys by organizationId for a mapped topic', async () => {
    const f = fakeProducer()
    const pub = makeOutboxPublisher(async () => f.producer)

    await pub.publish(rec('identity.org.created', { organizationId: 'org-9', slug: 'acme' }))

    expect(f.sends).toHaveLength(1)
    expect(f.raws).toHaveLength(0)
    const call = f.sends[0]
    expect(call.topic).toBe('identity.org.created')
    expect(call.hasSchema).toBe(true)
    expect(call.key).toBe('org-9')
    expect(call.event).toMatchObject({
      version: '1.0',
      topic: 'identity.org.created',
      correlationId: 'c1',
      payload: { organizationId: 'org-9', slug: 'acme' },
    })
    expect(typeof call.event.occurredAt).toBe('string')
  })

  it('publishes raw (no schema) for an unmapped topic, still keyed by the entity id', async () => {
    const f = fakeProducer()
    const pub = makeOutboxPublisher(async () => f.producer)

    await pub.publish(rec('billing.trial.ending', { userId: 'user-3' }))

    expect(f.sends).toHaveLength(0)
    expect(f.raws).toHaveLength(1)
    expect(f.raws[0].topic).toBe('billing.trial.ending')
    expect(f.raws[0].key).toBe('user-3')
    expect(JSON.parse(f.raws[0].value)).toMatchObject({ topic: 'billing.trial.ending', payload: { userId: 'user-3' } })
  })

  it('dead-letters to <topic>.dlq', async () => {
    const f = fakeProducer()
    const pub = makeOutboxPublisher(async () => f.producer)

    await pub.deadLetter(rec('identity.org.created', { organizationId: 'org-9' }))

    expect(f.raws).toHaveLength(1)
    expect(f.raws[0].topic).toBe('identity.org.created.dlq')
    expect(JSON.parse(f.raws[0].value)).toMatchObject({ reason: 'outbox max attempts exhausted' })
  })

  it('propagates a producer failure so the relay keeps the row pending', async () => {
    const pub = makeOutboxPublisher(async () => {
      throw new Error('kafka down')
    })
    await expect(pub.publish(rec('identity.org.created', { organizationId: 'o' }))).rejects.toThrow('kafka down')
  })
})

describe('startOutboxRelayFromEnv', () => {
  it('is a no-op (returns null) when no broker is configured', () => {
    const logs: string[] = []
    const handle = startOutboxRelayFromEnv({
      db: {} as any,
      brokers: '',
      logger: { info: m => logs.push(m), error: () => undefined },
    })
    expect(handle).toBeNull()
    expect(logs.join(' ')).toMatch(/disabled/)
  })
})
