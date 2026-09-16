import { Kafka, type EachMessagePayload } from 'kafkajs'
import { z } from 'zod'

export const MAX_DELIVERY_ATTEMPTS = 3

export function retryDelayMs(attempt: number) {
  return Math.min(5_000, 250 * 2 ** Math.max(0, attempt - 1))
}

export function failureCode(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (/jira/i.test(message)) return 'JIRA_UNAVAILABLE'
  if (/chroma|embedding|semantic/i.test(message)) return 'SEMANTIC_INDEX_UNAVAILABLE'
  return 'INTELLIGENCE_UNAVAILABLE'
}

export async function retry<T>(operation: () => Promise<T>, wait: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  let lastError: unknown
  for (let attempt = 1; attempt <= MAX_DELIVERY_ATTEMPTS; attempt++) {
    try { return await operation() } catch (error) {
      lastError = error
      if (attempt < MAX_DELIVERY_ATTEMPTS) await wait(retryDelayMs(attempt))
    }
  }
  throw lastError
}

const envelopeSchema = z.object({
  version: z.literal('1.0'),
  topic: z.string(),
  correlationId: z.string(),
  occurredAt: z.string(),
  payload: z.unknown(),
})

export async function runConsumer(
  groupId: string,
  topics: string[],
  handler: (
    topic: string,
    payload: unknown,
    correlationId: string,
    controls: { heartbeat: () => Promise<void> }
  ) => Promise<void>
) {
  const brokers = process.env.KAFKA_BROKERS?.split(',').filter(Boolean)
  if (!brokers?.length) throw new Error('KAFKA_BROKERS is required for worker processes')
  const kafka = new Kafka({ clientId: groupId, brokers })
  const consumer = kafka.consumer({
    groupId,
    sessionTimeout: 240_000,
    heartbeatInterval: 3_000,
  })
  const producer = kafka.producer()
  await consumer.connect()
  await producer.connect()
  for (const topic of topics) await consumer.subscribe({ topic })

  await consumer.run({
    eachMessage: async ({ topic, message, heartbeat }: EachMessagePayload) => {
      const raw = message.value?.toString()
      if (!raw) return
      try {
        const envelope = envelopeSchema.parse(JSON.parse(raw))
        await retry(() => handler(topic, envelope.payload, envelope.correlationId, { heartbeat }))
      } catch (error) {
        await producer.send({
          topic: `${topic}.dlq`,
          messages: [
            {
              key: message.key,
              value: JSON.stringify({
                sourceTopic: topic,
                code: failureCode(error),
                attempts: MAX_DELIVERY_ATTEMPTS,
                occurredAt: new Date().toISOString(),
              }),
            },
          ],
        })
      }
    },
  })
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const baseUrl = process.env.FUZEQUALITY_API_URL ?? 'http://fuzequality-backend:4180'
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(process.env.FUZEQUALITY_API_TOKEN
        ? { authorization: `Bearer ${process.env.FUZEQUALITY_API_TOKEN}` }
        : {}),
      ...init?.headers,
    },
  })
  if (!response.ok) throw new Error(`FuzeQuality API ${path} returned ${response.status}`)
  return response.json() as Promise<T>
}
