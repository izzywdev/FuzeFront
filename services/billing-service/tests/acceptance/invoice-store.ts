/**
 * INDEPENDENT in-memory invoice store used by the acceptance suite.
 *
 * This is NOT the implementation's PgInvoiceRepository — it is a self-contained,
 * behaviourally-faithful fake authored by the verification stream so the whole
 * GET /invoices / POST /invoices/sync surface can be walked end-to-end through
 * the REAL Express route + InvoiceService (+ StripePaymentProvider) with no DB.
 *
 * It re-implements the FROZEN pagination contract from scratch (issued_at DESC,
 * id DESC keyset; opaque base64 cursor; limit+1 look-ahead) so the suite is an
 * independent oracle rather than a mirror of the code under test. The real Pg
 * keyset SQL is verified separately in tests/integration/invoices.integration.test.ts.
 */
import { randomUUID } from 'crypto';
import type {
  InvoiceRepository,
  InvoiceRow,
  ListByCustomerArgs,
  ListByCustomerResult,
} from '../../src/repositories/invoice.repository';
import type { ProviderInvoice } from '../../src/providers/payment-provider';

/** Opaque cursor, independently defined: base64(`${issuedAtIso}|${id}`). */
export function encodeCursor(issuedAtIso: string, id: string): string {
  return Buffer.from(`${issuedAtIso}|${id}`, 'utf8').toString('base64');
}
export function decodeCursor(cursor: string): { issuedAt: string; id: string } | null {
  try {
    const raw = Buffer.from(cursor, 'base64').toString('utf8');
    const sep = raw.indexOf('|');
    if (sep <= 0) return null;
    const issuedAt = raw.slice(0, sep);
    const id = raw.slice(sep + 1);
    if (!issuedAt || !id || Number.isNaN(Date.parse(issuedAt))) return null;
    return { issuedAt, id };
  } catch {
    return null;
  }
}

/** Millisecond epoch of a row's issue timestamp. */
const ms = (d: Date): number => new Date(d).getTime();

/**
 * DESC comparator on (issued_at, id): newest first, id as the tiebreak.
 * Returns <0 when `a` sorts before `b` in the page ordering.
 */
function compareDesc(a: InvoiceRow, b: InvoiceRow): number {
  if (ms(a.issued_at) !== ms(b.issued_at)) return ms(b.issued_at) - ms(a.issued_at);
  // id DESC
  if (a.id === b.id) return 0;
  return a.id < b.id ? 1 : -1;
}

/**
 * Is `row` strictly PAST the keyset cursor in the DESC ordering, i.e.
 * (row.issued_at, row.id) < (cursor.issued_at, cursor.id) — the exact
 * row-value predicate the frozen contract's SQL uses.
 */
function pastCursor(row: InvoiceRow, cur: { issuedAt: string; id: string }): boolean {
  const rowMs = ms(row.issued_at);
  const curMs = Date.parse(cur.issuedAt);
  if (rowMs !== curMs) return rowMs < curMs;
  return row.id < cur.id;
}

export class InMemoryInvoiceStore implements InvoiceRepository {
  /** Keyed by `${provider}:${providerInvoiceId}` for idempotent upsert. */
  private byProviderKey = new Map<string, InvoiceRow>();

  constructor(private readonly provider = 'stripe') {}

  /** Test helper: current row count (proves no duplication on resync). */
  size(): number {
    return this.byProviderKey.size;
  }

  /** Test helper: seed a row directly (bypasses the provider path). */
  seedRow(row: Partial<InvoiceRow> & { customer_id: string; provider_invoice_id: string }): InvoiceRow {
    const now = new Date();
    const full: InvoiceRow = {
      id: row.id ?? randomUUID(),
      customer_id: row.customer_id,
      provider: row.provider ?? this.provider,
      provider_invoice_id: row.provider_invoice_id,
      number: row.number ?? null,
      status: row.status ?? 'paid',
      amount_due_cents: row.amount_due_cents ?? 900,
      amount_paid_cents: row.amount_paid_cents ?? 900,
      currency: row.currency ?? 'usd',
      hosted_invoice_url: row.hosted_invoice_url ?? null,
      invoice_pdf_url: row.invoice_pdf_url ?? null,
      issued_at: row.issued_at ?? now,
      created_at: row.created_at ?? now,
      updated_at: row.updated_at ?? now,
    };
    this.byProviderKey.set(`${full.provider}:${full.provider_invoice_id}`, full);
    return full;
  }

  async upsertFromProvider(customerId: string, invoice: ProviderInvoice): Promise<void> {
    const key = `${this.provider}:${invoice.providerInvoiceId}`;
    const existing = this.byProviderKey.get(key);
    // Idempotent on (provider, provider_invoice_id): keep the stable FuzeFront
    // uuid + created_at; refresh the mutable fields — exactly the ON CONFLICT
    // DO UPDATE semantics of the frozen migration 003.
    const row: InvoiceRow = {
      id: existing?.id ?? randomUUID(),
      customer_id: customerId,
      provider: this.provider,
      provider_invoice_id: invoice.providerInvoiceId,
      number: invoice.number ?? null,
      status: invoice.status,
      amount_due_cents: invoice.amountDueCents,
      amount_paid_cents: invoice.amountPaidCents,
      currency: invoice.currency,
      hosted_invoice_url: invoice.hostedInvoiceUrl ?? null,
      invoice_pdf_url: invoice.invoicePdfUrl ?? null,
      issued_at: invoice.issuedAt,
      created_at: existing?.created_at ?? new Date(),
      updated_at: new Date(),
    };
    this.byProviderKey.set(key, row);
  }

  async listByCustomer(args: ListByCustomerArgs): Promise<ListByCustomerResult> {
    const { customerId, limit } = args;
    const decoded = args.cursor ? decodeCursor(args.cursor) : null;

    const ordered = [...this.byProviderKey.values()]
      .filter((r) => r.customer_id === customerId)
      .sort(compareDesc);

    const afterCursor = decoded ? ordered.filter((r) => pastCursor(r, decoded)) : ordered;

    // limit+1 look-ahead to detect a further page without a COUNT.
    const slice = afterCursor.slice(0, limit + 1);
    const hasMore = slice.length > limit;
    const rows = hasMore ? slice.slice(0, limit) : slice;
    const last = rows[rows.length - 1];
    const nextCursor =
      hasMore && last ? encodeCursor(new Date(last.issued_at).toISOString(), last.id) : null;

    return { rows, nextCursor };
  }
}
