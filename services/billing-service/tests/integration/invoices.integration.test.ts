/**
 * INDEPENDENT Postgres integration test for the DB-backed invoice store
 * (migration 003 + PgInvoiceRepository). Proves store -> read -> paginate
 * against a REAL Postgres, not a fake:
 *
 *   - migration 003 applies (idempotently) and GET-side keyset ordering is
 *     (issued_at DESC, id DESC);
 *   - upsertFromProvider is idempotent on (provider, provider_invoice_id):
 *     a re-sync UPDATES the row in place (no duplicate) and keeps the stable
 *     FuzeFront uuid;
 *   - the opaque keyset cursor walks the whole set exactly once across pages
 *     and terminates.
 *
 * GATING: this suite is SKIPPED unless DATABASE_URL points at a reachable
 * Postgres (same convention as tests/db.test.ts). To run it locally against the
 * repo's version-pinned harness (docker-compose.test.yml -> postgres:15 on
 * :5433):
 *
 *   docker compose -f ../../docker-compose.test.yml up -d postgres-test
 *   DATABASE_URL=postgres://postgres:postgres@localhost:5433/fuzefront_platform_test \
 *     npx jest tests/integration/invoices.integration.test.ts
 *   docker compose -f ../../docker-compose.test.yml down -v
 *
 * The billing schema is normally created by a superuser bootstrap Job (the
 * least-privilege migrations never CREATE SCHEMA). For this self-contained test
 * we create it once up-front as the test superuser, then run the real migrations.
 */
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';
import { createPool, runMigrations } from '../../src/db';
import { PgCustomerRepository } from '../../src/repositories/customer.repository';
import {
  PgInvoiceRepository,
  mapInvoiceRow,
} from '../../src/repositories/invoice.repository';
import type { ProviderInvoice } from '../../src/providers/payment-provider';

const DB_URL = process.env.DATABASE_URL;

function providerInvoice(overrides: Partial<ProviderInvoice> = {}): ProviderInvoice {
  return {
    providerInvoiceId: `in_${randomUUID()}`,
    number: 'FF-2026-0001',
    status: 'paid',
    amountDueCents: 900,
    amountPaidCents: 900,
    currency: 'usd',
    hostedInvoiceUrl: 'https://invoice.provider/i/x',
    invoicePdfUrl: 'https://invoice.provider/i/x.pdf',
    issuedAt: new Date('2026-06-01T00:00:00.000Z'),
    ...overrides,
  };
}

(DB_URL ? describe : describe.skip)(
  'billing.invoices integration (requires DATABASE_URL)',
  () => {
    let pool: Pool;
    let customerRepo: PgCustomerRepository;
    let invoiceRepo: PgInvoiceRepository;
    let customerId: string;

    beforeAll(async () => {
      pool = createPool(DB_URL!);
      // Bootstrap superuser normally owns the schema; create it for the test DB.
      await pool.query('CREATE SCHEMA IF NOT EXISTS billing');
      await runMigrations(pool);
      customerRepo = new PgCustomerRepository(pool);
      invoiceRepo = new PgInvoiceRepository(pool);
      const customer = await customerRepo.insert({
        entityType: 'organization',
        entityId: randomUUID(),
        stripeCustomerId: `cus_${randomUUID()}`,
      });
      customerId = customer.id;
    });

    afterAll(async () => {
      if (pool) {
        // ON DELETE CASCADE removes this customer's invoices too.
        await pool.query('DELETE FROM billing.customers WHERE id = $1', [customerId]);
        await pool.end();
      }
    });

    // Isolate each test: clear only this customer's invoices.
    beforeEach(async () => {
      await pool.query('DELETE FROM billing.invoices WHERE customer_id = $1', [customerId]);
    });

    it('migration 003 is idempotent (re-running the migrations does not throw)', async () => {
      await expect(runMigrations(pool)).resolves.not.toThrow();
      const res = await pool.query(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'billing' AND table_name = 'invoices'`,
      );
      expect(res.rows).toHaveLength(1);
    });

    it('stores provider invoices and reads them back as the neutral view (id = DB uuid)', async () => {
      const inv = providerInvoice({ providerInvoiceId: 'in_read_1', number: 'FF-READ-1' });
      await invoiceRepo.upsertFromProvider(customerId, inv);

      const page = await invoiceRepo.listByCustomer({ customerId, limit: 100 });
      expect(page.rows).toHaveLength(1);
      const view = mapInvoiceRow(page.rows[0]);
      // id is OUR uuid, not the provider `in_...` id.
      expect(view.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(view.id).not.toMatch(/^in_/);
      expect(view.number).toBe('FF-READ-1');
      expect(view.currency).toBe('usd');
      expect(view.created).toBe('2026-06-01T00:00:00.000Z');
    });

    it('keyset orders by (issued_at DESC, id DESC) — including an issued_at tie', async () => {
      const tie = new Date('2026-06-15T00:00:00.000Z');
      await invoiceRepo.upsertFromProvider(customerId, providerInvoice({ providerInvoiceId: 'in_new', issuedAt: new Date('2026-07-01T00:00:00.000Z') }));
      await invoiceRepo.upsertFromProvider(customerId, providerInvoice({ providerInvoiceId: 'in_tie_a', issuedAt: tie }));
      await invoiceRepo.upsertFromProvider(customerId, providerInvoice({ providerInvoiceId: 'in_tie_b', issuedAt: tie }));
      await invoiceRepo.upsertFromProvider(customerId, providerInvoice({ providerInvoiceId: 'in_old', issuedAt: new Date('2026-05-01T00:00:00.000Z') }));

      const page = await invoiceRepo.listByCustomer({ customerId, limit: 100 });
      expect(page.rows).toHaveLength(4);
      // Verify the ordering invariant holds for every adjacent pair.
      for (let i = 1; i < page.rows.length; i++) {
        const prev = page.rows[i - 1];
        const cur = page.rows[i];
        const pt = new Date(prev.issued_at).getTime();
        const ct = new Date(cur.issued_at).getTime();
        expect(pt).toBeGreaterThanOrEqual(ct);
        if (pt === ct) expect(prev.id > cur.id).toBe(true); // id DESC tiebreak
      }
    });

    it('upsert is idempotent on (provider, provider_invoice_id): updates in place, keeps the uuid', async () => {
      const pid = 'in_conflict_1';
      await invoiceRepo.upsertFromProvider(
        customerId,
        providerInvoice({ providerInvoiceId: pid, status: 'open', amountPaidCents: 0, amountDueCents: 900 }),
      );
      const afterFirst = await invoiceRepo.listByCustomer({ customerId, limit: 100 });
      expect(afterFirst.rows).toHaveLength(1);
      const originalId = afterFirst.rows[0].id;
      expect(afterFirst.rows[0].status).toBe('open');

      // Re-sync the SAME provider invoice with mutated fields.
      await invoiceRepo.upsertFromProvider(
        customerId,
        providerInvoice({ providerInvoiceId: pid, status: 'paid', amountPaidCents: 900, amountDueCents: 900, number: 'FF-UPDATED' }),
      );
      const afterSecond = await invoiceRepo.listByCustomer({ customerId, limit: 100 });
      // No duplication...
      expect(afterSecond.rows).toHaveLength(1);
      // ...same stable uuid, updated mutable fields.
      expect(afterSecond.rows[0].id).toBe(originalId);
      expect(afterSecond.rows[0].status).toBe('paid');
      expect(afterSecond.rows[0].amount_paid_cents).toBe(900);
      expect(afterSecond.rows[0].number).toBe('FF-UPDATED');
    });

    it('the opaque cursor walks the whole set exactly once, across pages, then terminates', async () => {
      const TOTAL = 7;
      const PAGE = 3;
      const base = Date.parse('2026-06-01T00:00:00.000Z');
      for (let i = 0; i < TOTAL; i++) {
        await invoiceRepo.upsertFromProvider(
          customerId,
          providerInvoice({
            providerInvoiceId: `in_walk_${i}`,
            issuedAt: new Date(base + i * 86_400_000), // distinct instants
          }),
        );
      }

      const seen: string[] = [];
      let cursor: string | undefined;
      let pages = 0;
      for (;;) {
        const page = await invoiceRepo.listByCustomer({ customerId, limit: PAGE, cursor });
        expect(page.rows.length).toBeLessThanOrEqual(PAGE);
        for (const r of page.rows) seen.push(r.id);
        pages += 1;
        if (page.nextCursor === null) break;
        cursor = page.nextCursor;
        expect(pages).toBeLessThan(TOTAL); // must terminate
      }

      expect(seen).toHaveLength(TOTAL);
      expect(new Set(seen).size).toBe(TOTAL); // every row exactly once, no gaps/dupes
      expect(pages).toBe(Math.ceil(TOTAL / PAGE));
    });
  },
);
