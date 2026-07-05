import { MeteringService } from '../../src/services/metering.service';
import { UsageRepository, UsageEvent, PendingUsageEvent } from '../../src/repositories/usage.repository';

class FakeUsageRepo implements UsageRepository {
  events: PendingUsageEvent[] = [];
  reported = new Map<string, string>();
  private seq = 0;

  async buffer(e: UsageEvent): Promise<boolean> {
    if (this.events.some((x) => x.correlationId === e.correlationId)) return false;
    this.events.push({ id: `u_${++this.seq}`, ...e });
    return true;
  }
  async listUnreported(limit: number): Promise<PendingUsageEvent[]> {
    return this.events.filter((e) => !this.reported.has(e.id)).slice(0, limit);
  }
  async markReported(ids: string[], stripeMeterEventId: string): Promise<void> {
    for (const id of ids) this.reported.set(id, stripeMeterEventId);
  }
}

describe('MeteringService', () => {
  it('dedups buffered events by correlationId', async () => {
    const repo = new FakeUsageRepo();
    const svc = new MeteringService({ billing: { meterEvents: { create: jest.fn() } } } as any, repo);

    const e: UsageEvent = {
      entityId: 'ent-1', meterEventName: 'api_calls', quantity: 5,
      occurredAt: new Date().toISOString(), correlationId: 'corr-1',
    };
    expect(await svc.record(e)).toBe(true);
    expect(await svc.record(e)).toBe(false); // duplicate
    expect(repo.events).toHaveLength(1);
  });

  it('flushes unreported events to Stripe with correlationId as identifier + idempotency key', async () => {
    const repo = new FakeUsageRepo();
    await repo.buffer({
      entityId: 'ent-1', meterEventName: 'api_calls', quantity: 5,
      occurredAt: '2026-01-01T00:00:00.000Z', correlationId: 'corr-1',
    });
    const create = jest.fn().mockResolvedValue({ identifier: 'corr-1' });
    const svc = new MeteringService({ billing: { meterEvents: { create } } } as any, repo);

    const reported = await svc.flush();

    expect(reported).toBe(1);
    const [params, opts] = create.mock.calls[0];
    expect(params.identifier).toBe('corr-1');
    expect(params.event_name).toBe('api_calls');
    expect(opts.idempotencyKey).toBe('corr-1');
    // marked reported → not flushed again
    expect(await svc.flush()).toBe(0);
  });

  it('leaves an event unreported when Stripe errors (retry on next flush)', async () => {
    const repo = new FakeUsageRepo();
    await repo.buffer({
      entityId: 'ent-1', meterEventName: 'api_calls', quantity: 5,
      occurredAt: '2026-01-01T00:00:00.000Z', correlationId: 'corr-err',
    });
    const create = jest
      .fn()
      .mockRejectedValueOnce(new Error('stripe 500'))
      .mockResolvedValueOnce({ identifier: 'corr-err' });
    const logger = { error: jest.fn(), info: jest.fn() };
    const svc = new MeteringService({ billing: { meterEvents: { create } } } as any, repo, 1000, logger);

    expect(await svc.flush()).toBe(0); // failed
    expect(logger.error).toHaveBeenCalled();
    expect(await svc.flush()).toBe(1); // retried and succeeded
  });
});
