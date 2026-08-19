import { CustomerRepository } from '../repositories/customer.repository';
import {
  BillingInvoiceView,
  InvoiceRepository,
  mapInvoiceRow,
} from '../repositories/invoice.repository';
import { PaymentProvider } from '../providers/payment-provider';
import { BillingCustomer, EntityType } from '../types';

/** How many invoices to pull per provider page during a resync. */
const SYNC_PAGE_SIZE = 100;

export interface InvoiceServiceDeps {
  customerRepo: CustomerRepository;
  invoiceRepo: InvoiceRepository;
  provider: PaymentProvider;
}

/** The server-derived entity the money path re-verifies against. */
export interface InvoiceEntity {
  entityType: EntityType;
  entityId: string;
}

export interface ListInvoicesResult {
  invoices: BillingInvoiceView[];
  nextCursor: string | null;
}

/**
 * Vendor-neutral invoice read/sync service.
 *
 * Reads are served from the local billing.invoices store. On the FIRST page for
 * a known customer whose store is empty, we lazily sync once from the provider
 * then read — so a never-synced entity still returns its invoices without an
 * explicit POST /invoices/sync. Subsequent pages (cursor present) never trigger
 * a sync.
 */
export class InvoiceService {
  constructor(private readonly deps: InvoiceServiceDeps) {}

  async list(entity: InvoiceEntity, opts: { limit: number; cursor?: string }): Promise<ListInvoicesResult> {
    const customer = await this.deps.customerRepo.findByEntity(entity.entityType, entity.entityId);
    if (!customer) {
      // No billing relationship yet -> no invoices. Absence is not an error.
      return { invoices: [], nextCursor: null };
    }

    let page = await this.deps.invoiceRepo.listByCustomer({
      customerId: customer.id,
      limit: opts.limit,
      cursor: opts.cursor,
    });

    // Lazy first-load: a known customer with an empty store (and no cursor) is
    // synced once, then re-read. Idempotent: the upsert converges with webhooks.
    if (page.rows.length === 0 && !opts.cursor) {
      await this.syncCustomer(customer);
      page = await this.deps.invoiceRepo.listByCustomer({
        customerId: customer.id,
        limit: opts.limit,
        cursor: opts.cursor,
      });
    }

    return { invoices: page.rows.map(mapInvoiceRow), nextCursor: page.nextCursor };
  }

  /** Page all of a customer's provider invoices into the store; return count. */
  async syncCustomer(customer: BillingCustomer): Promise<number> {
    let synced = 0;
    let startingAfter: string | undefined;

    for (;;) {
      const { invoices, hasMore } = await this.deps.provider.listInvoices(customer.stripeCustomerId, {
        limit: SYNC_PAGE_SIZE,
        startingAfter,
      });
      for (const invoice of invoices) {
        await this.deps.invoiceRepo.upsertFromProvider(customer.id, invoice);
        synced += 1;
      }
      if (!hasMore || invoices.length === 0) break;
      startingAfter = invoices[invoices.length - 1].providerInvoiceId;
    }

    return synced;
  }

  /** Resolve the entity's customer and resync; 0 when there is no customer. */
  async syncEntity(entity: InvoiceEntity): Promise<number> {
    const customer = await this.deps.customerRepo.findByEntity(entity.entityType, entity.entityId);
    if (!customer) return 0;
    return this.syncCustomer(customer);
  }
}
