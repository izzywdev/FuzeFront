import type Stripe from 'stripe';
import { UsageRepository, UsageEvent } from '../repositories/usage.repository';

const DEFAULT_BATCH = 1000;

/**
 * Buffers usage events and flushes them to Stripe Billing Meter Events.
 *
 * Idempotency: each event uses its `correlationId` as the Stripe meter event
 * `identifier`, so Stripe dedups even if we flush the same event twice. Locally
 * we also dedup at insert via the unique correlation_id column.
 */
export class MeteringService {
  constructor(
    private readonly stripe: { billing: { meterEvents: Pick<Stripe.Billing.MeterEventsResource, 'create'> } },
    private readonly repo: UsageRepository,
    private readonly batchSize: number = DEFAULT_BATCH,
    private readonly logger: Pick<Console, 'error' | 'info'> = console,
  ) {}

  /** Buffer a single usage event (called by the Kafka consumer). */
  async record(e: UsageEvent): Promise<boolean> {
    return this.repo.buffer(e);
  }

  /**
   * Flush unreported events to Stripe. Returns the number reported.
   * On a per-event Stripe failure the event is left unreported (reported_at
   * stays NULL) so the next flush retries it; the unique `identifier` makes
   * retries safe.
   */
  async flush(): Promise<number> {
    const pending = await this.repo.listUnreported(this.batchSize);
    if (pending.length === 0) return 0;

    let reported = 0;
    for (const e of pending) {
      try {
        const meterEvent = await this.stripe.billing.meterEvents.create(
          {
            event_name: e.meterEventName,
            identifier: e.correlationId,
            timestamp: Math.floor(new Date(e.occurredAt).getTime() / 1000),
            payload: {
              stripe_customer_id: e.entityId,
              value: String(e.quantity),
            },
          } as Stripe.Billing.MeterEventCreateParams,
          { idempotencyKey: e.correlationId },
        );
        await this.repo.markReported([e.id], (meterEvent as { identifier?: string }).identifier ?? e.correlationId);
        reported++;
      } catch (err) {
        this.logger.error(
          `[metering] failed to report usage event ${e.correlationId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        // leave unreported for next flush (retry)
      }
    }
    return reported;
  }
}
