/**
 * INDEPENDENT acceptance / contract verification for the vendor-neutral,
 * DB-backed invoice surface — GET /api/v1/billing/invoices and
 * POST /api/v1/billing/invoices/sync (openapi.yaml 1.1.0).
 *
 * Authored by the verification stream (test-engineer), separate from the
 * implementer's own tests/routes/invoices.test.ts. These drive the REAL
 * createApp() wiring via supertest and assert BEHAVIOUR against the FROZEN
 * contract:
 *
 *   - auth: internal token AND proxy actor-context headers are both required;
 *   - envelope: { invoices, nextCursor } with additionalProperties:false and
 *     every item conforming to components/schemas/BillingInvoice;
 *   - identity: `id` is an opaque FuzeFront UUID, never a vendor `in_...` id;
 *     `nextCursor` is opaque and is NOT a vendor id;
 *   - pagination (baseline §4.1): limit is enforced/clamped to 1..100 and can
 *     NEVER return more than the max; the opaque cursor walks the WHOLE set —
 *     every item exactly once, no gaps/dupes — and terminates (nextCursor:null);
 *   - sync: 200 { synced:<int> }, idempotent — a second resync does not
 *     duplicate rows in the store.
 *
 * Pagination is driven end-to-end through the real route + InvoiceService
 * against an INDEPENDENT in-memory keyset store (invoice-store.ts), so the walk
 * is a true oracle and not a mirror of the code under test. The real Postgres
 * keyset SQL is verified in tests/integration/invoices.integration.test.ts.
 *
 * A failing assertion here against a real bug is a valid deliverable — it is
 * NOT fixed by weakening the test.
 */
import request from 'supertest';
import {
  buildApp,
  authHeader,
  actorOrgHeaders,
  INTERNAL_TOKEN,
  ORG_ID,
  USER_ID,
} from '../contract/helpers';
import {
  assertBillingInvoice,
  assertInvoiceListResponse,
} from '../contract/schema-assertions';
import { InMemoryInvoiceStore } from './invoice-store';

const URL = '/api/v1/billing/invoices';
const SYNC_URL = '/api/v1/billing/invoices/sync';

const CUSTOMER_ID = 'cust-accept-1';
const STRIPE_CUSTOMER_ID = 'cus_accept_1';

/** RFC-4122 v4 UUID matcher (crypto.randomUUID output). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Anything that looks like a Stripe/vendor object id. */
const VENDOR_ID_RE = /^(in_|cus_|sub_|pi_|cs_)/;

/** customerRepo stub: the authorized org HAS a billing customer. */
function customerRepoStub() {
  return {
    customerRepo: {
      findByEntity: jest.fn().mockResolvedValue({
        id: CUSTOMER_ID,
        entityType: 'organization',
        entityId: ORG_ID,
        stripeCustomerId: STRIPE_CUSTOMER_ID,
      }),
      findByStripeCustomerId: jest.fn().mockResolvedValue(null),
      insert: jest.fn(),
    },
  } as any;
}

/** Full Stripe stub whose invoices.list feeds the provider sync path. */
function stripeStub(listImpl?: jest.Mock) {
  return {
    stripe: {
      setupIntents: { create: jest.fn() },
      customers: { createBalanceTransaction: jest.fn() },
      checkout: { sessions: { create: jest.fn(), retrieve: jest.fn() } },
      billingPortal: { sessions: { create: jest.fn() } },
      invoices: { list: listImpl ?? jest.fn() },
      webhooks: { constructEvent: jest.fn() },
    },
  } as any;
}

/** A Stripe.Invoice-shaped object as returned by stripe.invoices.list().data. */
function stripeInvoice(i: number) {
  return {
    id: `in_${i}`,
    object: 'invoice',
    number: `FF-2026-${String(i).padStart(4, '0')}`,
    // Unix seconds; distinct + descending index => distinct issued_at.
    created: 1_700_000_000 + i * 86_400,
    amount_due: 900 + i,
    amount_paid: 900 + i,
    currency: i % 2 === 0 ? 'USD' : 'usd', // provider casing varies; we assert lowercase
    status: 'paid',
    hosted_invoice_url: `https://invoice.provider/i/in_${i}`,
    invoice_pdf: `https://invoice.provider/i/in_${i}.pdf`,
    customer: STRIPE_CUSTOMER_ID,
  };
}

/** Seed `n` invoices into the store, newest = index 0 (largest issued_at). */
function seedStore(store: InMemoryInvoiceStore, n: number): void {
  const base = Date.parse('2026-07-14T00:00:00.000Z');
  for (let i = 0; i < n; i++) {
    store.seedRow({
      customer_id: CUSTOMER_ID,
      provider_invoice_id: `in_${i}`,
      number: `FF-2026-${String(i).padStart(4, '0')}`,
      status: 'paid',
      amount_due_cents: 900 + i,
      amount_paid_cents: 900 + i,
      currency: 'usd',
      hosted_invoice_url: `https://invoice.provider/i/in_${i}`,
      invoice_pdf_url: `https://invoice.provider/i/in_${i}.pdf`,
      // Distinct, strictly descending with i => deterministic newest-first order.
      issued_at: new Date(base - i * 86_400_000),
    });
  }
}

function appWithStore(store: InMemoryInvoiceStore, listImpl?: jest.Mock) {
  return buildApp({
    internalToken: INTERNAL_TOKEN,
    stubs: {
      ...customerRepoStub(),
      ...stripeStub(listImpl),
      invoiceRepo: store as any,
    },
  });
}

/** GET one page with the given query, returning the parsed body. */
async function getPage(app: any, query = ''): Promise<any> {
  const res = await request(app)
    .get(`${URL}${query}`)
    .set(...authHeader())
    .set(actorOrgHeaders(ORG_ID, USER_ID));
  expect(res.status).toBe(200);
  assertInvoiceListResponse(res.body);
  return res.body;
}

describe('GET /invoices — auth contract', () => {
  it('401 when the internal token is missing (actor headers present)', async () => {
    const { app } = appWithStore(new InMemoryInvoiceStore());
    const res = await request(app).get(URL).set(actorOrgHeaders(ORG_ID, USER_ID));
    expect(res.status).toBe(401);
  });

  it('401 when the proxy actor-context headers are missing (token present)', async () => {
    const { app } = appWithStore(new InMemoryInvoiceStore());
    const res = await request(app).get(URL).set(...authHeader());
    expect(res.status).toBe(401);
  });

  it('200 with the empty envelope for an entity that has never had billing', async () => {
    // Default customerRepo.findByEntity resolves null => no customer, no store read.
    const { app } = buildApp({ internalToken: INTERNAL_TOKEN });
    const body = await getPage(app);
    expect(body).toEqual({ invoices: [], nextCursor: null });
  });
});

describe('GET /invoices — BillingInvoice shape & neutral identity', () => {
  it('maps stored rows to the neutral schema; id is a UUID (never a vendor id)', async () => {
    const store = new InMemoryInvoiceStore();
    seedStore(store, 3);
    const { app } = appWithStore(store);

    const body = await getPage(app, '?limit=100');
    expect(body.invoices).toHaveLength(3);

    for (const inv of body.invoices) {
      assertBillingInvoice(inv); // required keys, additionalProperties:false, types
      expect(inv.id).toMatch(UUID_RE); // IS an opaque FuzeFront uuid
      expect(inv.id).not.toMatch(/^in_/); // NOT a Stripe invoice id
      expect(inv.currency).toBe(inv.currency.toLowerCase());
    }
    // Newest-first ordering: issued_at strictly descending.
    const times = body.invoices.map((i: any) => Date.parse(i.created));
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it('nextCursor is opaque and is NOT a vendor id', async () => {
    const store = new InMemoryInvoiceStore();
    seedStore(store, 5);
    const { app } = appWithStore(store);

    const body = await getPage(app, '?limit=2');
    expect(typeof body.nextCursor).toBe('string');
    expect(body.nextCursor).not.toMatch(VENDOR_ID_RE);
    // Opaque cursor must not simply echo any invoice's provider id or our uuid.
    for (const inv of body.invoices) {
      expect(body.nextCursor).not.toContain(inv.id);
    }
  });
});

describe('GET /invoices — pagination contract (baseline §4.1)', () => {
  it('enforces limit: over-max is clamped to 100 and NEVER returns more', async () => {
    const store = new InMemoryInvoiceStore();
    seedStore(store, 150);
    const { app } = appWithStore(store);

    const body = await getPage(app, '?limit=9999');
    expect(body.invoices).toHaveLength(100); // clamped to the declared max
    expect(body.nextCursor).not.toBeNull(); // more remain
  });

  it('enforces limit: under-min is clamped to 1', async () => {
    const store = new InMemoryInvoiceStore();
    seedStore(store, 5);
    const { app } = appWithStore(store);

    const body = await getPage(app, '?limit=0');
    expect(body.invoices).toHaveLength(1);
    expect(body.nextCursor).not.toBeNull();
  });

  it('page 1 -> page 2 via nextCursor: disjoint, ordered, no overlap', async () => {
    const store = new InMemoryInvoiceStore();
    seedStore(store, 5);
    const { app } = appWithStore(store);

    const p1 = await getPage(app, '?limit=2');
    expect(p1.invoices).toHaveLength(2);
    expect(p1.nextCursor).not.toBeNull();

    const p2 = await getPage(app, `?limit=2&cursor=${encodeURIComponent(p1.nextCursor)}`);
    const ids1 = p1.invoices.map((i: any) => i.id);
    const ids2 = p2.invoices.map((i: any) => i.id);
    expect(ids1.filter((id: string) => ids2.includes(id))).toEqual([]); // no overlap
    // Continuity: page 2's newest is strictly older than page 1's oldest.
    const oldestP1 = Math.min(...p1.invoices.map((i: any) => Date.parse(i.created)));
    const newestP2 = Math.max(...p2.invoices.map((i: any) => Date.parse(i.created)));
    expect(newestP2).toBeLessThanOrEqual(oldestP1);
  });

  it('the cursor walks the WHOLE set exactly once, then terminates', async () => {
    const TOTAL = 150;
    const PAGE = 25;
    const store = new InMemoryInvoiceStore();
    seedStore(store, TOTAL);
    const { app } = appWithStore(store);

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    for (;;) {
      const q = `?limit=${PAGE}` + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
      const body: any = await getPage(app, q);
      expect(body.invoices.length).toBeLessThanOrEqual(PAGE); // never over-serves
      for (const inv of body.invoices) seen.push(inv.id);
      cursor = body.nextCursor;
      pages += 1;
      if (cursor === null) break;
      expect(pages).toBeLessThan(TOTAL); // guard against a non-terminating cursor
    }

    expect(seen).toHaveLength(TOTAL); // every item visited...
    expect(new Set(seen).size).toBe(TOTAL); // ...exactly once (no dupes/gaps)
    expect(pages).toBe(Math.ceil(TOTAL / PAGE));
  });

  it('walks correctly across an issued_at tie (id DESC tiebreak, no dup/gap)', async () => {
    const store = new InMemoryInvoiceStore();
    const sameInstant = new Date('2026-06-01T00:00:00.000Z');
    // Three invoices share issued_at; the keyset must still visit each once.
    for (let i = 0; i < 3; i++) {
      store.seedRow({
        customer_id: CUSTOMER_ID,
        provider_invoice_id: `in_tie_${i}`,
        number: `FF-TIE-${i}`,
        issued_at: sameInstant,
      });
    }
    // Plus two on distinct instants to force paging across the tie boundary.
    store.seedRow({ customer_id: CUSTOMER_ID, provider_invoice_id: 'in_new', issued_at: new Date('2026-07-01T00:00:00.000Z') });
    store.seedRow({ customer_id: CUSTOMER_ID, provider_invoice_id: 'in_old', issued_at: new Date('2026-05-01T00:00:00.000Z') });
    const { app } = appWithStore(store);

    const seen: string[] = [];
    let cursor: string | null = null;
    for (;;) {
      const q = `?limit=2` + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
      const body: any = await getPage(app, q);
      for (const inv of body.invoices) seen.push(inv.id);
      cursor = body.nextCursor;
      if (cursor === null) break;
    }
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
  });
});

describe('POST /invoices/sync — provider->store resync', () => {
  it('401 when the internal token is missing', async () => {
    const { app } = appWithStore(new InMemoryInvoiceStore());
    const res = await request(app).post(SYNC_URL).set(actorOrgHeaders(ORG_ID, USER_ID));
    expect(res.status).toBe(401);
  });

  it('401 when the proxy actor-context headers are missing', async () => {
    const { app } = appWithStore(new InMemoryInvoiceStore());
    const res = await request(app).post(SYNC_URL).set(...authHeader());
    expect(res.status).toBe(401);
  });

  it('200 { synced:<int> } counting upserted invoices', async () => {
    const store = new InMemoryInvoiceStore();
    const list = jest.fn().mockResolvedValue({
      data: [stripeInvoice(1), stripeInvoice(2), stripeInvoice(3)],
      has_more: false,
    });
    const { app } = appWithStore(store, list);

    const res = await request(app)
      .post(SYNC_URL)
      .set(...authHeader())
      .set(actorOrgHeaders(ORG_ID, USER_ID));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ synced: 3 });
    expect(typeof res.body.synced).toBe('number');
    expect(Number.isInteger(res.body.synced)).toBe(true);
    expect(store.size()).toBe(3);
  });

  it('200 { synced:0 } when the entity has no billing customer', async () => {
    const store = new InMemoryInvoiceStore();
    const { app } = buildApp({
      internalToken: INTERNAL_TOKEN,
      // default customerRepo.findByEntity => null
      stubs: { ...stripeStub(jest.fn()), invoiceRepo: store as any },
    });
    const res = await request(app)
      .post(SYNC_URL)
      .set(...authHeader())
      .set(actorOrgHeaders(ORG_ID, USER_ID));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ synced: 0 });
    expect(store.size()).toBe(0);
  });

  it('is idempotent: a second resync does NOT duplicate rows in the store', async () => {
    const store = new InMemoryInvoiceStore();
    const list = jest.fn().mockResolvedValue({
      data: [stripeInvoice(1), stripeInvoice(2)],
      has_more: false,
    });
    const { app } = appWithStore(store, list);

    const first = await request(app)
      .post(SYNC_URL)
      .set(...authHeader())
      .set(actorOrgHeaders(ORG_ID, USER_ID));
    expect(first.body).toEqual({ synced: 2 });
    expect(store.size()).toBe(2);

    const idsAfterFirst = [...(store as any).byProviderKey.values()].map((r: any) => r.id).sort();

    const second = await request(app)
      .post(SYNC_URL)
      .set(...authHeader())
      .set(actorOrgHeaders(ORG_ID, USER_ID));
    expect(second.body).toEqual({ synced: 2 });
    // Store still holds exactly 2 rows (no duplication)...
    expect(store.size()).toBe(2);
    // ...and the FuzeFront uuids are STABLE across the resync (upsert in place).
    const idsAfterSecond = [...(store as any).byProviderKey.values()].map((r: any) => r.id).sort();
    expect(idsAfterSecond).toEqual(idsAfterFirst);

    // GET reflects the deduped store: exactly 2 neutral invoices.
    const body = await getPage(app, '?limit=100');
    expect(body.invoices).toHaveLength(2);
    body.invoices.forEach((inv: any) => {
      assertBillingInvoice(inv);
      expect(inv.id).toMatch(UUID_RE);
      expect(inv.id).not.toMatch(/^in_/);
    });
  });
});
