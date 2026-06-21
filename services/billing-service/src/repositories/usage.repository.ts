import { Pool } from 'pg';

export interface UsageEvent {
  entityId: string;
  meterEventName: string;
  quantity: number;
  occurredAt: string;
  correlationId: string;
}

export interface PendingUsageEvent extends UsageEvent {
  id: string;
}

export interface UsageRepository {
  /** Buffer a usage event. Idempotent on correlation_id (dedup at insert). */
  buffer(e: UsageEvent): Promise<boolean>;
  /** Fetch up to `limit` events not yet reported to Stripe. */
  listUnreported(limit: number): Promise<PendingUsageEvent[]>;
  /** Mark events as reported with the Stripe meter event id echo. */
  markReported(ids: string[], stripeMeterEventId: string): Promise<void>;
}

interface UsageRow {
  id: string;
  entity_id: string;
  meter_event_name: string;
  quantity: string; // BIGINT comes back as string from pg
  occurred_at: Date;
  correlation_id: string;
}

export class PgUsageRepository implements UsageRepository {
  constructor(private readonly pool: Pool) {}

  async buffer(e: UsageEvent): Promise<boolean> {
    const res = await this.pool.query(
      `INSERT INTO billing.usage_events
         (entity_id, meter_event_name, quantity, occurred_at, correlation_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (correlation_id) DO NOTHING`,
      [e.entityId, e.meterEventName, e.quantity, e.occurredAt, e.correlationId],
    );
    return (res.rowCount ?? 0) > 0;
  }

  async listUnreported(limit: number): Promise<PendingUsageEvent[]> {
    const res = await this.pool.query<UsageRow>(
      `SELECT id, entity_id, meter_event_name, quantity, occurred_at, correlation_id
         FROM billing.usage_events
        WHERE reported_at IS NULL
        ORDER BY occurred_at ASC
        LIMIT $1`,
      [limit],
    );
    return res.rows.map((r) => ({
      id: r.id,
      entityId: r.entity_id,
      meterEventName: r.meter_event_name,
      quantity: Number(r.quantity),
      occurredAt: new Date(r.occurred_at).toISOString(),
      correlationId: r.correlation_id,
    }));
  }

  async markReported(ids: string[], stripeMeterEventId: string): Promise<void> {
    if (ids.length === 0) return;
    await this.pool.query(
      `UPDATE billing.usage_events
          SET reported_at = now(), stripe_meter_event_id = $2
        WHERE id = ANY($1::uuid[])`,
      [ids, stripeMeterEventId],
    );
  }
}
