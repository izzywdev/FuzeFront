"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isPostgres = isPostgres;
exports.enqueueEvent = enqueueEvent;
const uuid_1 = require("uuid");
/**
 * True when the given knex/transaction is talking to Postgres. Used to apply
 * Postgres-only SQL (the explicit `::jsonb` cast here, `FOR UPDATE SKIP LOCKED`
 * in the relay) while still working against the in-memory sqlite fallback used
 * in tests.
 */
function isPostgres(k) {
    const client = k.client;
    const dialect = client?.dialect || client?.config?.client;
    return dialect === 'postgresql' || dialect === 'pg';
}
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
async function enqueueEvent(trx, topic, payload, correlationId) {
    const json = JSON.stringify(payload);
    await trx('event_outbox').insert({
        id: (0, uuid_1.v4)(),
        topic,
        // Postgres rejects an implicit text->jsonb coercion in a parameterized
        // query, so cast explicitly; sqlite (tests) stores the JSON string as-is.
        payload: isPostgres(trx) ? trx.raw('?::jsonb', [json]) : json,
        correlation_id: correlationId,
        status: 'pending',
        attempts: 0,
    });
}
//# sourceMappingURL=outbox.js.map