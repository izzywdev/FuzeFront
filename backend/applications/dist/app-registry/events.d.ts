export interface AppRegisteredPayloadV1 {
    slug: string;
    name: string;
    mode: 'portal' | 'standalone';
    integrationType: 'module-federation' | 'iframe' | 'web-component' | 'spa';
    builtin: boolean;
    organizationId?: string | null;
    registeredAt: string;
}
export interface AppActivatedPayloadV1 {
    slug: string;
    organizationId?: string | null;
    actorUserId?: string;
    activatedAt: string;
}
export interface AppSuspendedPayloadV1 {
    slug: string;
    organizationId?: string | null;
    actorUserId?: string;
    suspendedAt: string;
}
export interface AppHeartbeatPayloadV1 {
    slug: string;
    status: 'online' | 'degraded';
    metadata?: Record<string, unknown>;
    seenAt: string;
}
export interface AppRegistryEventEmitter {
    appRegistered(payload: AppRegisteredPayloadV1, correlationId?: string): Promise<void>;
    appActivated(payload: AppActivatedPayloadV1, correlationId?: string): Promise<void>;
    appSuspended(payload: AppSuspendedPayloadV1, correlationId?: string): Promise<void>;
    appHeartbeat(payload: AppHeartbeatPayloadV1, correlationId?: string): Promise<void>;
}
interface ProducerLike {
    send(topic: string, event: unknown, schema: unknown): Promise<void>;
}
/**
 * Kafka-backed emitter over the shared TypedProducer. The shared Zod schemas are
 * resolved lazily from @fuzefront/shared so each send is validated against the
 * frozen contract; if a schema is unavailable we send without local validation
 * (the broker still receives the envelope) rather than dropping the event.
 */
export declare class KafkaAppRegistryEmitter implements AppRegistryEventEmitter {
    private readonly producer;
    private schemas;
    constructor(producer: ProducerLike);
    appRegistered(payload: AppRegisteredPayloadV1, correlationId?: any): Promise<void>;
    appActivated(payload: AppActivatedPayloadV1, correlationId?: any): Promise<void>;
    appSuspended(payload: AppSuspendedPayloadV1, correlationId?: any): Promise<void>;
    appHeartbeat(payload: AppHeartbeatPayloadV1, correlationId?: any): Promise<void>;
    private emit;
}
/**
 * Wraps any emitter so emit failures NEVER propagate to the HTTP request — they
 * are logged and swallowed (Kafka is system-of-record but must not break the
 * synchronous API path). Also the default when Kafka is unconfigured.
 */
export declare class FailSoftEmitter implements AppRegistryEventEmitter {
    private readonly inner;
    private readonly logger;
    constructor(inner: AppRegistryEventEmitter | null, logger?: Pick<Console, 'warn' | 'error'>);
    private guard;
    appRegistered(payload: AppRegisteredPayloadV1, correlationId?: string): Promise<void>;
    appActivated(payload: AppActivatedPayloadV1, correlationId?: string): Promise<void>;
    appSuspended(payload: AppSuspendedPayloadV1, correlationId?: string): Promise<void>;
    appHeartbeat(payload: AppHeartbeatPayloadV1, correlationId?: string): Promise<void>;
}
/** Test/DI seam — inject a stub emitter. */
export declare function setAppRegistryEmitter(e: AppRegistryEventEmitter | null): void;
/**
 * Lazily builds the process-wide fail-soft emitter. Connects a Kafka producer
 * only when KAFKA_BROKERS is set; otherwise returns a fail-soft emitter that
 * logs+skips so local/dev/test keep working with no broker.
 */
export declare function getAppRegistryEmitter(): AppRegistryEventEmitter;
export {};
//# sourceMappingURL=events.d.ts.map