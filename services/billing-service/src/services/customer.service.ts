import type Stripe from 'stripe';
import { BillingCustomer, EntityType } from '../types';
import { CustomerRepository } from '../repositories/customer.repository';

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

    return this.repo.insert({
      entityType,
      entityId,
      stripeCustomerId: customer.id,
    });
  }
}
