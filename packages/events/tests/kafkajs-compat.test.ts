import { Kafka } from 'kafkajs'
import type { KafkaLike } from '../src'

// Compile-time proof that a real kafkajs client satisfies the KafkaLike port.
describe('kafkajs compatibility', () => {
  it('a kafkajs Kafka is assignable to KafkaLike', () => {
    const kafka = new Kafka({ clientId: 't', brokers: ['localhost:9092'] })
    const like: KafkaLike = kafka as unknown as KafkaLike
    const typed: (k: Kafka) => KafkaLike = (k) => k
    expect(like).toBeDefined()
    expect(typeof typed).toBe('function')
  })
})
