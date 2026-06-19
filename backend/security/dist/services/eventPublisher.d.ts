import { IdentityUserCreatedPayloadV1, NotifyEmailRequestedPayloadV1 } from '@fuzefront/shared/kafka';
/**
 * Thin, injectable Kafka publish surface used by provisioning.
 *
 * Tests pass a fake implementing `EventPublisher` so nothing touches a real
 * broker. In production a lazily-connected shared `TypedProducer` is used.
 * When `KAFKA_BROKERS` is unset the publisher is a logging no-op so the backend
 * still runs (and provisioning still completes) without Kafka — events are also
 * recorded in `event_outbox`, so a later drainer can replay them.
 */
export interface EventPublisher {
    publishIdentityUserCreated(payload: IdentityUserCreatedPayloadV1, correlationId: string): Promise<void>;
    publishNotifyEmailRequested(payload: NotifyEmailRequestedPayloadV1, correlationId: string): Promise<void>;
}
export declare const defaultEventPublisher: EventPublisher;
/** Disconnect the shared producer (graceful shutdown). */
export declare function disconnectEventPublisher(): Promise<void>;
//# sourceMappingURL=eventPublisher.d.ts.map