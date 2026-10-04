"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.drainOutboxOnce = drainOutboxOnce;
exports.startOutboxRelay = startOutboxRelay;
const outbox_1 = require("./outbox");
function parsePayload(raw) {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
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
async function drainOutboxOnce(opts) {
    const { db, publish, batchSize = 20, maxAttempts = 10, onDeadLetter, logger } = opts;
    let sent = 0;
    let failed = 0;
    await db.transaction(async (trx) => {
        let query = trx('event_outbox')
            .where('status', 'pending')
            .orderBy('created_at', 'asc')
            .limit(batchSize);
        if ((0, outbox_1.isPostgres)(trx)) {
            query = query.forUpdate().skipLocked();
        }
        const rows = await query;
        for (const row of rows) {
            const record = {
                id: row.id,
                topic: row.topic,
                payload: parsePayload(row.payload),
                correlationId: row.correlation_id,
                attempts: row.attempts,
            };
            try {
                await publish(record);
                await trx('event_outbox')
                    .where('id', row.id)
                    .update({ status: 'sent', attempts: row.attempts + 1, sent_at: new Date() });
                sent++;
            }
            catch (err) {
                const attempts = row.attempts + 1;
                const parked = attempts >= maxAttempts;
                await trx('event_outbox')
                    .where('id', row.id)
                    .update({
                    status: parked ? 'failed' : 'pending',
                    attempts,
                    last_error: String(err?.message ?? err).slice(0, 1000),
                });
                failed++;
                logger?.error(`outbox publish failed for ${row.topic} (${row.id}) attempt ${attempts}: ${String(err)}`);
                if (parked && onDeadLetter) {
                    try {
                        await onDeadLetter(record, err);
                    }
                    catch {
                        /* dead-letter is best-effort — never fail the drain */
                    }
                }
            }
        }
    });
    return { sent, failed };
}
/**
 * Start a background relay that calls `drainOutboxOnce` on an interval. The poll
 * interval is the base retry delay; a Kafka outage simply means rows accumulate
 * as 'pending' and drain once publishing recovers. Returns a handle to stop it
 * (call on graceful shutdown).
 */
function startOutboxRelay(opts) {
    const intervalMs = opts.intervalMs ?? 1000;
    let stopped = false;
    let timer = null;
    const tick = async () => {
        if (stopped)
            return;
        try {
            const { sent, failed } = await drainOutboxOnce(opts);
            if (sent || failed)
                opts.logger?.info(`outbox relay: sent=${sent} failed=${failed}`);
        }
        catch (err) {
            opts.logger?.error(`outbox relay drain error: ${String(err)}`);
        }
        finally {
            if (!stopped)
                timer = setTimeout(tick, intervalMs);
        }
    };
    timer = setTimeout(tick, intervalMs);
    return {
        stop() {
            stopped = true;
            if (timer)
                clearTimeout(timer);
        },
    };
}
//# sourceMappingURL=outboxRelay.js.map