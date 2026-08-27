import {
  FuzeEvent,
  IdentityOrgDeletedPayloadV1,
} from '@fuzefront/shared/kafka';
import { CustomerRepository } from '../repositories/customer.repository';
import { SubscriptionRepository } from '../repositories/subscription.repository';
import { SubscriptionService } from '../services/subscription.service';

/**
 * Collaborators the org-deleted reaction needs. Kept as an interface (not the
 * concrete wiring) so the handler is unit-testable against in-memory fakes.
 */
export interface OrgDeletedHandlerDeps {
  customers: CustomerRepository;
  subscriptions: SubscriptionRepository;
  subscriptionService: Pick<SubscriptionService, 'cancel' | 'cancelImmediately'>;
}

/**
 * Reacts to `identity.org.deleted` by canceling the deleted org's Stripe
 * subscription. The org→subscription link is indirect: billing stores no
 * `org_id` on subscriptions, so we resolve
 *   organization → billing.customers (entity_type='organization') → subscription.
 *
 * `cascade` picks the cancel semantics:
 *   - 'soft' (the default org DELETE) → cancel at period end (reversible; the
 *     org may be reactivated before the period closes).
 *   - 'hard' → cancel immediately (the org is being purged; nothing left to bill).
 *
 * Best-effort + idempotent: an org with no billing customer or no subscription
 * is a no-op, and an already-canceled subscription is skipped (so a redelivered
 * event does not hit Stripe again). The TypedConsumer already validated the
 * payload against identityOrgDeletedSchemaV1 before this handler is called.
 */
export async function handleOrgDeleted(
  event: FuzeEvent<IdentityOrgDeletedPayloadV1>,
  deps: OrgDeletedHandlerDeps,
): Promise<void> {
  const { organizationId, cascade } = event.payload;

  const customer = await deps.customers.findByEntity('organization', organizationId);
  if (!customer) {
    console.log(
      `[billing-service] org ${organizationId} has no billing customer — nothing to cancel (correlationId=${event.correlationId})`,
    );
    return;
  }

  const subscription = await deps.subscriptions.findByCustomer(customer.id);
  if (!subscription) {
    console.log(
      `[billing-service] org ${organizationId} has no subscription — nothing to cancel (correlationId=${event.correlationId})`,
    );
    return;
  }

  if (subscription.status === 'canceled') {
    console.log(
      `[billing-service] subscription ${subscription.subscriptionId} already canceled — skipping (correlationId=${event.correlationId})`,
    );
    return;
  }

  if (cascade === 'hard') {
    await deps.subscriptionService.cancelImmediately(subscription.subscriptionId);
    console.log(
      `[billing-service] hard-canceled subscription ${subscription.subscriptionId} for org ${organizationId} (correlationId=${event.correlationId})`,
    );
  } else {
    await deps.subscriptionService.cancel(subscription.subscriptionId);
    console.log(
      `[billing-service] soft-canceled (period-end) subscription ${subscription.subscriptionId} for org ${organizationId} (correlationId=${event.correlationId})`,
    );
  }
}
