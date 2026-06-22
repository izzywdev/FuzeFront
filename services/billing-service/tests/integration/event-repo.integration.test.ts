/**
 * Webhook idempotency integration test against a real Postgres.
 *
 * Gated behind DATABASE_URL — runs in CI (where the billing-tests workflow
 * provisions Postgres) and is skipped automatically in local unit runs. It
 * exercises the real PgEventRepository.recordIfNew dedup path (the ON CONFLICT
 * branch), which the unit suite can only stub.
 */
import { createPool, runMigrations } from '../../src/db';
import { PgEventRepository } from '../../src/repositories/event.repository';
import { randomUUID } from 'crypto';

const DB_URL = process.env.DATABASE_URL;

(DB_URL ? describe : describe.skip)(
  'PgEventRepository.recordIfNew idempotency (requires DATABASE_URL)',
  () => {
    let pool: ReturnType<typeof createPool>;
    let repo: PgEventRepository;

    beforeAll(async () => {
      pool = createPool(DB_URL!);
      await runMigrations(pool);
      repo = new PgEventRepository(pool);
    });

    afterAll(async () => {
      await pool.end();
    });

    it('returns true the first time an event id is seen, false thereafter', async () => {
      const eventId = `evt_${randomUUID()}`;
      const first = await repo.recordIfNew(eventId, 'customer.subscription.updated', {
        id: eventId,
        hello: 'world',
      });
      expect(first).toBe(true);

      const second = await repo.recordIfNew(eventId, 'customer.subscription.updated', {
        id: eventId,
        hello: 'world',
      });
      expect(second).toBe(false);
    });

    it('treats distinct event ids independently', async () => {
      const a = `evt_${randomUUID()}`;
      const b = `evt_${randomUUID()}`;
      expect(await repo.recordIfNew(a, 'invoice.payment_succeeded', {})).toBe(true);
      expect(await repo.recordIfNew(b, 'invoice.payment_failed', {})).toBe(true);
    });

    it('persists the payload as JSONB and the event_type', async () => {
      const eventId = `evt_${randomUUID()}`;
      await repo.recordIfNew(eventId, 'customer.subscription.deleted', { foo: 42 });
      const row = await pool.query(
        `SELECT event_type, payload FROM billing.stripe_events WHERE stripe_event_id = $1`,
        [eventId],
      );
      expect(row.rows).toHaveLength(1);
      expect(row.rows[0].event_type).toBe('customer.subscription.deleted');
      expect(row.rows[0].payload).toEqual({ foo: 42 });
    });
  },
);
