import { Pool } from 'pg';
import { ProviderInvoice } from '../providers/payment-provider';

/**
 * The contract-frozen, vendor-neutral invoice projection exposed by
 * GET /invoices. `id` is OUR FuzeFront uuid (never a provider id); `created` is
 * the ISO-8601 issue timestamp; amountDue/amountPaid are cents; currency is
 * lowercased. This is the stable shape the billing UI depends on.
 */
export interface BillingInvoiceView {
  id: string;
  number: string | null;
  created: string;
  amountDue: number;
  amountPaid: number;
  currency: string;
  status: string;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
}

/** A row of billing.invoices. */
export interface InvoiceRow {
  id: string;
  customer_id: string;
  provider: string;
  provider_invoice_id: string;
  number: string | null;
  status: string;
  amount_due_cents: number;
  amount_paid_cents: number;
  currency: string;
  hosted_invoice_url: string | null;
  invoice_pdf_url: string | null;
  issued_at: Date;
  created_at: Date;
  updated_at: Date;
}

export interface ListByCustomerArgs {
  customerId: string;
  limit: number;
  /** Opaque keyset cursor (previous page's nextCursor); undefined for page 1. */
  cursor?: string;
}

export interface ListByCustomerResult {
  rows: InvoiceRow[];
  /** Opaque keyset cursor for the next page; null on the last page. */
  nextCursor: string | null;
}

/**
 * Data-access for billing.invoices. Defined as an interface so services/handlers
 * can be unit-tested against an in-memory fake without a live Postgres.
 */
export interface InvoiceRepository {
  /** Upsert a provider invoice for a customer (idempotent on provider id). */
  upsertFromProvider(customerId: string, invoice: ProviderInvoice): Promise<void>;
  /** Keyset page a customer's invoices, newest first. */
  listByCustomer(args: ListByCustomerArgs): Promise<ListByCustomerResult>;
}

/** Maps a billing.invoices row to the neutral BillingInvoiceView. */
export function mapInvoiceRow(r: InvoiceRow): BillingInvoiceView {
  return {
    id: r.id,
    number: r.number ?? null,
    created: new Date(r.issued_at).toISOString(),
    amountDue: r.amount_due_cents,
    amountPaid: r.amount_paid_cents,
    currency: r.currency,
    status: r.status,
    hostedInvoiceUrl: r.hosted_invoice_url ?? null,
    invoicePdf: r.invoice_pdf_url ?? null,
  };
}

/** Encode a keyset cursor: base64(`${issued_at_iso}|${id}`). */
export function encodeInvoiceCursor(issuedAtIso: string, id: string): string {
  return Buffer.from(`${issuedAtIso}|${id}`, 'utf8').toString('base64');
}

/**
 * Decode a keyset cursor back to {issuedAt, id}. Returns null when the cursor is
 * malformed (treated as page 1 rather than an error).
 */
export function decodeInvoiceCursor(cursor: string): { issuedAt: string; id: string } | null {
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

export class PgInvoiceRepository implements InvoiceRepository {
  constructor(
    private readonly pool: Pool,
    /** Provider name persisted in billing.invoices.provider. */
    private readonly provider = 'stripe',
  ) {}

  async upsertFromProvider(customerId: string, invoice: ProviderInvoice): Promise<void> {
    // Idempotent on (provider, provider_invoice_id): a webhook and a full resync
    // that both see the same invoice converge on one row; the mutable fields are
    // refreshed on every landing.
    await this.pool.query(
      `INSERT INTO billing.invoices
         (customer_id, provider, provider_invoice_id, number, status,
          amount_due_cents, amount_paid_cents, currency,
          hosted_invoice_url, invoice_pdf_url, issued_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (provider, provider_invoice_id) DO UPDATE SET
          status             = EXCLUDED.status,
          amount_due_cents   = EXCLUDED.amount_due_cents,
          amount_paid_cents  = EXCLUDED.amount_paid_cents,
          currency           = EXCLUDED.currency,
          number             = EXCLUDED.number,
          hosted_invoice_url = EXCLUDED.hosted_invoice_url,
          invoice_pdf_url    = EXCLUDED.invoice_pdf_url,
          issued_at          = EXCLUDED.issued_at,
          updated_at         = now()`,
      [
        customerId,
        this.provider,
        invoice.providerInvoiceId,
        invoice.number,
        invoice.status,
        invoice.amountDueCents,
        invoice.amountPaidCents,
        invoice.currency,
        invoice.hostedInvoiceUrl,
        invoice.invoicePdfUrl,
        invoice.issuedAt,
      ],
    );
  }

  async listByCustomer(args: ListByCustomerArgs): Promise<ListByCustomerResult> {
    const { customerId, limit } = args;
    const decoded = args.cursor ? decodeInvoiceCursor(args.cursor) : null;

    // Fetch limit+1 to detect a further page without a second COUNT query.
    // Keyset predicate uses the row-value comparison on (issued_at, id) so the
    // ordering and the "less than the cursor" boundary stay consistent.
    const params: unknown[] = [customerId];
    let where = 'customer_id = $1';
    if (decoded) {
      params.push(decoded.issuedAt, decoded.id);
      where += ` AND (issued_at, id) < ($2::timestamptz, $3::uuid)`;
    }
    params.push(limit + 1);
    const limitParam = `$${params.length}`;

    const res = await this.pool.query<InvoiceRow>(
      `SELECT id, customer_id, provider, provider_invoice_id, number, status,
              amount_due_cents, amount_paid_cents, currency,
              hosted_invoice_url, invoice_pdf_url, issued_at, created_at, updated_at
         FROM billing.invoices
        WHERE ${where}
        ORDER BY issued_at DESC, id DESC
        LIMIT ${limitParam}`,
      params,
    );

    const hasMore = res.rows.length > limit;
    const rows = hasMore ? res.rows.slice(0, limit) : res.rows;
    const last = rows[rows.length - 1];
    const nextCursor =
      hasMore && last ? encodeInvoiceCursor(new Date(last.issued_at).toISOString(), last.id) : null;

    return { rows, nextCursor };
  }
}
