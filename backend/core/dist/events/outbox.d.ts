import { Knex } from 'knex';
/**
 * True when the given knex/transaction is talking to Postgres. Used to apply
 * Postgres-only SQL (the explicit `::jsonb` cast here, `FOR UPDATE SKIP LOCKED`
 * in the relay) while still working against the in-memory sqlite fallback used
 * in tests.
 */
export declare function isPostgres(k: Knex | Knex.Transaction): boolean;
/**
 * Transactional-outbox write — the best-practice equivalent of "publish an
 * event when the entity is saved". Inserts a single `event_outbox` row INSIDE
 * the caller's transaction so the event is persisted atomically with the state
 * change it describes: no distributed transaction, no dual-write gap. A separate
 * relay (`startOutboxRelay`) later publishes pending rows to Kafka.
 *
 * MUST be called with the same `trx` that performs the state change — if the
 * transaction rolls back, the event is dropped with it (proven by tests).
 */
export declare function enqueueEvent(trx: Knex | Knex.Transaction, topic: string, payload: unknown, correlationId: string): Promise<void>;
//# sourceMappingURL=outbox.d.ts.map