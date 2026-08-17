import { z } from 'zod'
import { createKafkaClient, TypedConsumer } from '@fuzefront/shared/kafka'
import {
  applyEventToRefIndex,
  REF_INDEX_TOPICS,
  type RefIndexStore,
} from '@izzywdev/fuzefront-identity'

/**
 * Tolerant envelope schema — the projection only needs an id (and sometimes a
 * tenant); applyEventToRefIndex already skips payloads that lack one.
 */
const anyPayload = z.record(z.any())

let consumer: TypedConsumer | null = null

function kafkaEnabled(): boolean {
  return !!process.env.KAFKA_BROKERS
}

/**
 * Keeps ref_index current from the lifecycle events the owning services
 * already publish (FFRNT P2 / identifier-standard.md §5, layer L1).
 *
 * The monolith references userId (from JWT) and orgId (from JWT / body).
 * These entities are owned by security-service / host backend. The
 * identity.user.* and identity.org.* topics are projected here so
 * assertRefExists can answer at request time without an RPC.
 *
 * Kafka-unavailable: logs a warning and returns. The projection degrades
 * gracefully — assertRefExists auto-downgrades to warn mode when stale.
 */
export async function startRefIndexProjection(store: RefIndexStore): Promise<void> {
  if (!kafkaEnabled()) {
    console.log(
      '[fuzefront-backend] Kafka disabled — ref_index projection not started (KAFKA_BROKERS unset)',
    )
    return
  }

  try {
    const brokers = (process.env.KAFKA_BROKERS as string)
      .split(',')
      .map((b) => b.trim())
      .filter(Boolean)

    const kafka = createKafkaClient({
      clientId: process.env.KAFKA_CLIENT_ID || 'fuzefront-backend',
      brokers,
    })

    consumer = new TypedConsumer(
      kafka,
      (process.env.KAFKA_GROUP_ID || 'fuzefront-backend') + '-ref-index',
    )

    await consumer.connect()

    const rebuilding = await store.isEmpty()
    if (rebuilding) {
      console.log(
        '[fuzefront-backend] ref_index is empty — replaying lifecycle topics from the ' +
          'beginning to rebuild the projection',
      )
    }

    for (const topic of REF_INDEX_TOPICS) {
      await consumer.subscribe(topic, rebuilding)
    }

    void consumer.run(
      async (event: { topic: string; payload: Record<string, unknown> }) => {
        try {
          await applyEventToRefIndex(store, event.topic, event.payload)
        } catch (err) {
          console.error('[fuzefront-backend] ref_index apply error:', err)
        }
      },
      anyPayload,
    )

    console.log(
      `[fuzefront-backend] ref_index projection consuming: ${REF_INDEX_TOPICS.join(', ')}`,
    )
  } catch (err) {
    console.warn(
      '[fuzefront-backend] Failed to start ref_index projection (continuing without it):',
      err,
    )
  }
}

/** Disconnect the projection consumer (graceful shutdown). */
export async function stopRefIndexProjection(): Promise<void> {
  if (consumer) {
    try {
      await consumer.disconnect()
    } finally {
      consumer = null
    }
  }
}
