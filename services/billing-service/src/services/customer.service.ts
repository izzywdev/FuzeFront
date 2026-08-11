import type Stripe from 'stripe';
import { BillingCustomer, EntityType } from '../types';
import { CustomerRepository } from '../repositories/customer.repository';
import { BillingEventEmitter } from '../kafka/producer';

/**
 * Owns the dual-entity Stripe Customer mapping:
 *  - personal account  (entityType 'user')         → Customer keyed on user.id
 *  - organization      (entityType 'organization') → Customer keyed on org.id
 *
 * `ensureCustomer` is idempotent: it returns an existing local mapping if one
 * exists, otherwise creates a Stripe Customer and persists the mapping.
 */
export class CustomerService {
  constructor(
    private readonly stripe: Pick<Stripe, 'customers'>,
    private readonly repo: CustomerRepository,
    /**
     * Optional so existing unit tests / degraded-mode boot don't need to wire
     * one; when present, a new organization Customer emits
     * billing.tenant.registered (FuzeFinance's "new corporate tenant" signal).
     */
    private readonly emitter?: Pick<BillingEventEmitter, 'tenantRegistered'>,
  ) {}

  async ensureCustomer(
    entityType: EntityType,
    entityId: string,
    opts: { email?: string; name?: string } = {},
  ): Promise<BillingCustomer> {
    const existing = await this.repo.findByEntity(entityType, entityId);
    if (existing) return existing;

    const customer = await this.stripe.customers.create(
      {
        email: opts.email,
        name: opts.name,
        metadata: { fuzefront_entity_type: entityType, fuzefront_entity_id: entityId },
      },
      // Idempotency key: a retry of the same entity's first-customer creation
      // will not create a duplicate Stripe Customer.
      { idempotencyKey: `customer-create-${entityType}-${entityId}` },
    );

    const created = await this.repo.insert({
      entityType,
      entityId,
      stripeCustomerId: customer.id,
    });

    // Best-effort, never blocks/fails customer creation: ensureCustomer runs
    // inline in user-facing request paths (checkout, setup-intent, payments,
    // credits), unlike the webhook handlers where an emit failure is fine to
    // throw and let Stripe retry the whole event.
    if (entityType === 'organization' && this.emitter) {
      this.emitter
        .tenantRegistered({
          entityId,
          entityType: 'organization',
          stripeCustomerId: customer.id,
        })
        .catch((err) =>
          console.error(
            `[customer.service] tenantRegistered emit failed for org ${entityId}:`,
            err,
          ),
        );
    }

    return created;
  }
}
