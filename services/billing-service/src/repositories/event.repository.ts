import { Pool } from 'pg';

export interface EventRepository {
  /**
   * Records a Stripe event id for idempotency. Returns true if this is the
   * first time we've seen it (caller should process), false if it was already
   * recorded (caller should no-op and return 200).
   */
  recordIfNew(stripeEventId: string, eventType: string, payload: unknown): Promise<boolean>;
}

export class PgEventRepository implements EventRepository {
  constructor(private readonly pool: Pool) {}

  async recordIfNew(
    stripeEventId: string,
    eventType: string,
    payload: unknown,
  ): Promise<boolean> {
    const res = await this.pool.query(
      `INSERT INTO billing.stripe_events (stripe_event_id, event_type, payload)
            VALUES ($1, $2, $3)
       ON CONFLICT (stripe_event_id) DO NOTHING`,
      [stripeEventId, eventType, JSON.stringify(payload)],
    );
    // pg sets rowCount to the number of inserted rows; 0 means the ON CONFLICT
    // path fired (already processed).
    return (res.rowCount ?? 0) > 0;
  }
}
