import { Knex } from 'knex';
/** One decoded outbox row handed to the publisher. */
export interface OutboxRecord {
    id: string;
    topic: string;
    payload: unknown;
    correlationId: string;
    attempts: number;
}
/** Publishes one record to the bus. Throw to signal a retryable failure. */
export type OutboxPublish = (record: OutboxRecord) => Promise<void>;
export interface OutboxRelayOptions {
    db: Knex;
    /**
     * Transport-agnostic publish. The caller injects the Kafka wiring (envelope,
     * Zod schema, partition key) so this module stays free of a broker
     * dependency and is trivially unit-testable with a fake.
     */
    publish: OutboxPublish;
    /** Rows claimed per drain pass. Default 20 (small — the claim holds a row lock across the publish). */
    batchSize?: number;
    /** Attempts before a row is parked as 'failed'. Default 10. */
    maxAttempts?: number;
    /** Optional hook invoked when a row is parked 'failed' (e.g. route to a DLQ). */
    onDeadLetter?: (record: OutboxRecord, error: Error) => Promise<void>;
    logger?: {
        info: (m: string) => void;
        error: (m: string) => void;
    };
}
export interface DrainResult {
    sent: number;
    failed: number;
}
/**
 * Drain one batch of pending outbox rows.
 *
 * On Postgres the claim uses `FOR UPDATE SKIP LOCKED`, so multiple relay
 * replicas never publish the same row. Publishing happens inside the claiming
 * transaction: a publish failure increments `attempts` and leaves the row
 * 'pending' (retried on a later pass) until `maxAttempts`, after which it is
 * parked 'failed' (and dead-lettered if a hook is provided). Returns counts for
 * observability and tests.
 */
export declare function drainOutboxOnce(opts: OutboxRelayOptions): Promise<DrainResult>;
export interface OutboxRelayHandle {
    stop(): void;
}
/**
 * Start a background relay that calls `drainOutboxOnce` on an interval. The poll
 * interval is the base retry delay; a Kafka outage simply means rows accumulate
 * as 'pending' and drain once publishing recovers. Returns a handle to stop it
 * (call on graceful shutdown).
 */
export declare function startOutboxRelay(opts: OutboxRelayOptions & {
    intervalMs?: number;
}): OutboxRelayHandle;
//# sourceMappingURL=outboxRelay.d.ts.map