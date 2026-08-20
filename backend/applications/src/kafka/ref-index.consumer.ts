import { z } from 'zod'
// Dynamic require so the path resolves against the dist output without a
// tsconfig `paths` alias (applications-service follows this pattern for all
// shared/kafka imports — see app-registry/events.ts).
//
// The subpath MUST be the one @fuzefront/shared declares in its `exports` map.
// `./dist/kafka` is not exported, and an `exports` field makes every
// undeclared subpath unreachable — so requiring it throws
// ERR_PACKAGE_PATH_NOT_EXPORTED. This require is top-level and unguarded, so
// that threw at module load and crash-looped the whole service in prod. The
// pattern was copied from app-registry/events.ts, where the identical deep
// path has always been broken too — its require just sits inside a try/catch
// that silently swallowed the failure.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createKafkaClient, TypedConsumer } = require('@fuzefront/shared/kafka')
import {
  applyEventToRefIndex,
  REF_INDEX_TOPICS,
  type RefIndexStore,
} from '@izzywdev/fuzefront-identity'

/**
 * Tolerant envelope schema — see billing-service's ref-index consumer for the
 * full reasoning. The projection only needs an id (and sometimes a tenant);
 * applyEventToRefIndex already skips payloads that lack one.
 */
const anyPayload = z.record(z.any())

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let consumer: any = null

function kafkaEnabled(): boolean {
  return !!process.env.KAFKA_BROKERS
}

/**
 * Keeps app_ref_index current from the lifecycle events the owning services
 * already publish (FFRNT P2 / identifier-standard.md §5, layer L1).
 *
 * Applications-service references organizationId from bodies (app registration,
 * organization-scoped installs). Organizations are owned by security-service /
 * host backend. The identity.org.* topics are projected here so assertRefExists
 * can answer at write-time without an RPC.
 *
 * Kafka-unavailable: logs a warning and returns. The projection degrades
 * gracefully — assertRefExists auto-downgrades to warn mode when stale.
 */
export async function startRefIndexProjection(store: RefIndexStore): Promise<void> {
  if (!kafkaEnabled()) {
    console.log(
      '[applications-service] Kafka disabled — app_ref_index projection not started (KAFKA_BROKERS unset)',
    )
    return
  }

  try {
    const brokers = (process.env.KAFKA_BROKERS as string)
      .split(',')
      .map((b) => b.trim())
      .filter(Boolean)

    const kafka = createKafkaClient({
      clientId: process.env.KAFKA_CLIENT_ID || 'applications-service',
      brokers,
    })

    consumer = new TypedConsumer(
      kafka,
      (process.env.KAFKA_GROUP_ID || 'applications-service') + '-ref-index',
    )

    await consumer.connect()

    const rebuilding = await store.isEmpty()
    if (rebuilding) {
      console.log(
        '[applications-service] app_ref_index is empty — replaying lifecycle topics from the ' +
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
          console.error('[applications-service] app_ref_index apply error:', err)
        }
      },
      anyPayload,
    )

    console.log(
      `[applications-service] app_ref_index projection consuming: ${REF_INDEX_TOPICS.join(', ')}`,
    )
  } catch (err) {
    console.warn(
      '[applications-service] Failed to start app_ref_index projection (continuing without it):',
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
