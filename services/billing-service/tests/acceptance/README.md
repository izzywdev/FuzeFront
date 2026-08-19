# Billing invoice — independent verification suite

Authored by the **independent verification stream** (`test-engineer`), separate
from the implementer's own `tests/routes/invoices.test.ts` and
`tests/repositories/invoice.repository.test.ts`. These assert **behaviour against
the frozen contract** (`services/billing-service/openapi.yaml`, v1.1.0 —
`BillingInvoice`, `InvoiceListResponse`, `GET /invoices`, `POST /invoices/sync`),
not the implementation's internals. A failing test here against a real bug is a
valid deliverable; it is not "fixed" by weakening the assertion.

## Files

| File | Layer | DB? |
|------|-------|-----|
| `tests/acceptance/invoices.acceptance.test.ts` | HTTP acceptance/contract via supertest against the real `createApp()` | No (in-memory store) |
| `tests/acceptance/invoice-store.ts` | Independent in-memory keyset store — an oracle, not a mirror of `PgInvoiceRepository` | No |
| `tests/integration/invoices.integration.test.ts` | `PgInvoiceRepository` + migration 003 against real Postgres | Yes (gated) |

## What the acceptance suite verifies (no DB)

Drives the real Express route + `InvoiceService` + `StripePaymentProvider` with a
fully-mocked `AppDeps`, backing the invoice repo with an **independent in-memory
keyset store** so the whole pagination surface can be walked end-to-end.

- **Auth** — `GET /invoices` and `POST /invoices/sync` each require BOTH the
  internal Bearer token AND the proxy actor-context headers; either missing → 401.
- **Empty entity** — an entity with no billing customer → `200 { invoices: [],
  nextCursor: null }` (absence is not an error).
- **Schema** — every item conforms to `BillingInvoice` (required keys,
  `additionalProperties:false`, types); the envelope is exactly
  `{ invoices, nextCursor }`.
- **Neutral identity** — `id` IS an opaque FuzeFront UUID and is NOT a vendor
  `in_...` id; `nextCursor` is opaque and is NOT a vendor id.
- **Pagination (baseline §4.1)** — `limit` is enforced/clamped to `1..100` and
  **never** over-serves (a `limit=9999` request over a 150-row set returns 100);
  under-min clamps to 1; the opaque cursor **walks the whole set exactly once**
  (no gaps/dupes), across pages, and terminates at `nextCursor: null` — including
  across an `issued_at` tie (id DESC tiebreak).
- **Sync** — `200 { synced: <int> }`; idempotent: a second resync does NOT
  duplicate rows and keeps the stable FuzeFront uuid.

Run:

```bash
cd services/billing-service
npx jest tests/acceptance
```

## What the integration suite verifies (real Postgres)

Proves store → read → paginate against real Postgres with migration 003 applied:
neutral-view mapping (id = DB uuid), keyset ordering `(issued_at DESC, id DESC)`
including a tie, idempotent `ON CONFLICT (provider, provider_invoice_id)` upsert
(updates in place, no dup, stable uuid), and a full cross-page cursor walk.

**Gating:** skipped unless `DATABASE_URL` points at a reachable Postgres (same
convention as `tests/db.test.ts`). The billing schema is normally created by a
superuser bootstrap Job (the least-privilege migrations never `CREATE SCHEMA`);
the test creates it once up-front, then runs the real migrations.

Run against the repo's version-pinned harness (`docker-compose.test.yml` →
`postgres:15` on `:5433`):

```bash
# from services/billing-service
docker compose -f ../../docker-compose.test.yml up -d postgres-test
DATABASE_URL=postgres://postgres:postgres@localhost:5433/fuzefront_platform_test \
  npx jest tests/integration/invoices.integration.test.ts
docker compose -f ../../docker-compose.test.yml down -v
```

Any reachable Postgres 13+ works (`gen_random_uuid()` is core). With no
`DATABASE_URL` the suite reports as skipped, cleanly.
