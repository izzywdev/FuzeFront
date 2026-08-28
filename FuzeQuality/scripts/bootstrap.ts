import { Kafka, logLevel } from 'kafkajs'
import { TOPICS } from '@fuzequality/contracts'
import { runMigrations } from './migrate'

const configuredBrokers = process.env.KAFKA_BROKERS?.split(',').map(value => value.trim()).filter(Boolean) ?? []
if (!configuredBrokers.length) throw new Error('KAFKA_BROKERS is required')
const brokerList: string[] = configuredBrokers

const partitions = Number(process.env.FUZEQUALITY_KAFKA_TOPIC_PARTITIONS ?? 3)
const replicationFactor = Number(process.env.FUZEQUALITY_KAFKA_REPLICATION_FACTOR ?? 1)
const retentionMs = String(process.env.FUZEQUALITY_KAFKA_RETENTION_MS ?? 604800000)

if (!Number.isInteger(partitions) || partitions < 1) throw new Error('FUZEQUALITY_KAFKA_TOPIC_PARTITIONS must be a positive integer')
if (!Number.isInteger(replicationFactor) || replicationFactor < 1) throw new Error('FUZEQUALITY_KAFKA_REPLICATION_FACTOR must be a positive integer')

const topics = Object.values(TOPICS)

async function ensureTopics() {
  const kafka = new Kafka({ brokers: brokerList, clientId: 'fuzequality-bootstrap', logLevel: logLevel.NOTHING })
  const admin = kafka.admin()
  try {
    await admin.connect()
    // Kafka's createTopics is additive: existing topics are left untouched.
    await admin.createTopics({
      waitForLeaders: true,
      topics: topics.flatMap(topic => [
        { topic, numPartitions: partitions, replicationFactor, configEntries: [{ name: 'retention.ms', value: retentionMs }] },
        { topic: `${topic}.dlq`, numPartitions: 1, replicationFactor, configEntries: [{ name: 'retention.ms', value: '2592000000' }] },
      ]),
    })
    console.log(`Kafka topics ensured (${topics.length} primary topics and DLQs)`)
  } finally {
    await admin.disconnect().catch(() => undefined)
  }
}

await runMigrations()
await ensureTopics()
console.log('FuzeQuality bootstrap complete')
