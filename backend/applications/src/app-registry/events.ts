// Kafka event producer for the app-registry surface. Kafka is the durable
// system-of-record (the Socket.IO emits stay as a live UI push). Uses the shared
// TypedProducer + the FROZEN Zod schemas in shared/src/kafka/schemas/app.* (the
// schema VALUES are resolved at runtime from @fuzefront/shared so emission
// validates against the single source of truth; payload shapes are mirrored here
// as structural types so this slice compiles independently of the shared dist
// regeneration that adds the app.* exports).
//
// FAIL-SOFT: if Kafka is not configured (no KAFKA_BROKERS) or a send fails, we
// log and continue so local/dev/test and the HTTP request itself never break on
// a broker outage. The emitter is an interface so routes can be unit-tested with
// a stub (no broker required), mirroring services/billing-service's pattern.
import { randomUUID } from 'crypto'

// Payload shapes — structurally identical to the frozen Zod schemas
// (shared/src/kafka/schemas/app.*). Kept local so the build does not depend on
// the shared dist exposing the app.* types yet.
export interface AppRegisteredPayloadV1 {
  slug: string
  name: string
  mode: 'portal' | 'standalone'
  integrationType: 'module-federation' | 'iframe' | 'web-component' | 'spa'
  builtin: boolean
  organizationId?: string | null
  registeredAt: string
}
export interface AppActivatedPayloadV1 {
  slug: string
  organizationId?: string | null
  actorUserId?: string
  activatedAt: string
}
export interface AppSuspendedPayloadV1 {
  slug: string
  organizationId?: string | null
  actorUserId?: string
  suspendedAt: string
}
export interface AppHeartbeatPayloadV1 {
  slug: string
  status: 'online' | 'degraded'
  metadata?: Record<string, unknown>
  seenAt: string
}

const TOPIC = {
  APP_REGISTERED: 'app.registered',
  APP_ACTIVATED: 'app.activated',
  APP_SUSPENDED: 'app.suspended',
  APP_HEARTBEAT: 'app.heartbeat',
} as const

export interface AppRegistryEventEmitter {
  appRegistered(payload: AppRegisteredPayloadV1, correlationId?: string): Promise<void>
  appActivated(payload: AppActivatedPayloadV1, correlationId?: string): Promise<void>
  appSuspended(payload: AppSuspendedPayloadV1, correlationId?: string): Promise<void>
  appHeartbeat(payload: AppHeartbeatPayloadV1, correlationId?: string): Promise<void>
}

// Minimal shape of the shared TypedProducer we rely on (validate + send).
interface ProducerLike {
  send(topic: string, event: unknown, schema: unknown): Promise<void>
}

/**
 * Kafka-backed emitter over the shared TypedProducer. The shared Zod schemas are
 * resolved lazily from @fuzefront/shared so each send is validated against the
 * frozen contract; if a schema is unavailable we send without local validation
 * (the broker still receives the envelope) rather than dropping the event.
 */
export class KafkaAppRegistryEmitter implements AppRegistryEventEmitter {
  private schemas: Record<string, unknown> = {}

  constructor(private readonly producer: ProducerLike) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const shared = require('@fuzefront/shared/dist/kafka')
      this.schemas = {
        [TOPIC.APP_REGISTERED]: shared.appRegisteredSchemaV1,
        [TOPIC.APP_ACTIVATED]: shared.appActivatedSchemaV1,
        [TOPIC.APP_SUSPENDED]: shared.appSuspendedSchemaV1,
        [TOPIC.APP_HEARTBEAT]: shared.appHeartbeatSchemaV1,
      }
    } catch {
      this.schemas = {}
    }
  }

  appRegistered(payload: AppRegisteredPayloadV1, correlationId = randomUUID()): Promise<void> {
    return this.emit(TOPIC.APP_REGISTERED, payload, correlationId)
  }
  appActivated(payload: AppActivatedPayloadV1, correlationId = randomUUID()): Promise<void> {
    return this.emit(TOPIC.APP_ACTIVATED, payload, correlationId)
  }
  appSuspended(payload: AppSuspendedPayloadV1, correlationId = randomUUID()): Promise<void> {
    return this.emit(TOPIC.APP_SUSPENDED, payload, correlationId)
  }
  appHeartbeat(payload: AppHeartbeatPayloadV1, correlationId = randomUUID()): Promise<void> {
    return this.emit(TOPIC.APP_HEARTBEAT, payload, correlationId)
  }

  private emit(topic: string, payload: unknown, correlationId: string): Promise<void> {
    const schema = this.schemas[topic] ?? passthroughSchema()
    return this.producer.send(
      topic,
      {
        version: '1.0',
        topic,
        correlationId,
        occurredAt: new Date().toISOString(),
        payload,
      },
      schema
    )
  }
}

/** Zod-like no-op validator used only if the shared schema export is missing. */
function passthroughSchema(): unknown {
  return { parse: (v: unknown) => v }
}

/**
 * Wraps any emitter so emit failures NEVER propagate to the HTTP request — they
 * are logged and swallowed (Kafka is system-of-record but must not break the
 * synchronous API path). Also the default when Kafka is unconfigured.
 */
export class FailSoftEmitter implements AppRegistryEventEmitter {
  constructor(
    private readonly inner: AppRegistryEventEmitter | null,
    private readonly logger: Pick<Console, 'warn' | 'error'> = console
  ) {}

  private async guard(name: string, fn: () => Promise<void>): Promise<void> {
    if (!this.inner) {
      this.logger.warn(`[app-registry][events] Kafka not configured — skipping ${name}`)
      return
    }
    try {
      await fn()
    } catch (err) {
      this.logger.error(
        `[app-registry][events] failed to emit ${name} (continuing):`,
        err instanceof Error ? err.message : String(err)
      )
    }
  }

  appRegistered(payload: AppRegisteredPayloadV1, correlationId?: string): Promise<void> {
    return this.guard('app.registered', () => this.inner!.appRegistered(payload, correlationId))
  }
  appActivated(payload: AppActivatedPayloadV1, correlationId?: string): Promise<void> {
    return this.guard('app.activated', () => this.inner!.appActivated(payload, correlationId))
  }
  appSuspended(payload: AppSuspendedPayloadV1, correlationId?: string): Promise<void> {
    return this.guard('app.suspended', () => this.inner!.appSuspended(payload, correlationId))
  }
  appHeartbeat(payload: AppHeartbeatPayloadV1, correlationId?: string): Promise<void> {
    return this.guard('app.heartbeat', () => this.inner!.appHeartbeat(payload, correlationId))
  }
}

let cachedEmitter: AppRegistryEventEmitter | null = null

/** Test/DI seam — inject a stub emitter. */
export function setAppRegistryEmitter(e: AppRegistryEventEmitter | null): void {
  cachedEmitter = e
}

/**
 * Lazily builds the process-wide fail-soft emitter. Connects a Kafka producer
 * only when KAFKA_BROKERS is set; otherwise returns a fail-soft emitter that
 * logs+skips so local/dev/test keep working with no broker.
 */
export function getAppRegistryEmitter(): AppRegistryEventEmitter {
  if (cachedEmitter) return cachedEmitter

  const brokers = (process.env.KAFKA_BROKERS || '').trim()
  if (!brokers) {
    cachedEmitter = new FailSoftEmitter(null)
    return cachedEmitter
  }

  try {
    // Lazy require so kafkajs + the shared producer are only needed where Kafka
    // is configured.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Kafka } = require('kafkajs')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { TypedProducer } = require('@fuzefront/shared/dist/kafka')
    const kafka = new Kafka({
      clientId: 'applications-service',
      brokers: brokers.split(',').map((b: string) => b.trim()),
    })
    const producer = new TypedProducer(kafka) as ProducerLike & { connect(): Promise<void> }
    producer.connect().catch((err: unknown) => {
      console.error(
        '[app-registry][events] producer connect failed (will fail-soft):',
        err instanceof Error ? err.message : String(err)
      )
    })
    cachedEmitter = new FailSoftEmitter(new KafkaAppRegistryEmitter(producer))
  } catch (err) {
    console.error(
      '[app-registry][events] kafka init failed — fail-soft (no events):',
      err instanceof Error ? err.message : String(err)
    )
    cachedEmitter = new FailSoftEmitter(null)
  }
  return cachedEmitter
}
