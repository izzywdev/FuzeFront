import {
  FuzeEvent,
  IdentityUserDeletedPayloadV1,
} from '@fuzefront/shared/kafka';
import { CustomerRepository } from '../repositories/customer.repository';
import { SubscriptionRepository } from '../repositories/subscription.repository';
import { SubscriptionService } from '../services/subscription.service';

export interface UserDeletedHandlerDeps {
  customers: CustomerRepository;
  subscriptions: SubscriptionRepository;
  subscriptionService: Pick<SubscriptionService, 'cancel' | 'cancelImmediately'>;
}

/**
 * Reacts to `identity.user.deleted` by canceling any user-scoped Stripe
 * subscription the deleted user holds.
 *
 * FuzeFront subscriptions are primarily org-scoped, but a user may hold a
 * personal (user-scoped) subscription — e.g. a solo-plan or a legacy personal
 * account. This handler resolves
 *   user → billing.customers (entity_type='user') → subscription
 * and applies the same cancel semantics as the org-deleted handler:
 *   - 'soft' → cancel at period end (user may be reactivated before that).
 *   - 'hard' → cancel immediately (user is being purged).
 *
 * An org-scoped subscription linked to an org the user belongs to is NOT
 * touched here; org.deleted owns that path. This handler is strictly for
 * user-scoped billing customers.
 *
 * Best-effort + idempotent: no billing customer or no subscription is a no-op;
 * an already-canceled subscription is skipped.
 */
export async function handleUserDeleted(
  event: FuzeEvent<IdentityUserDeletedPayloadV1>,
  deps: UserDeletedHandlerDeps,
): Promise<void> {
  const { userId, cascade } = event.payload;

  const customer = await deps.customers.findByEntity('user', userId);
  if (!customer) {
    console.log(
      `[billing-service] user ${userId} has no billing customer — nothing to cancel (correlationId=${event.correlationId})`,
    );
    return;
  }

  const subscription = await deps.subscriptions.findByCustomer(customer.id);
  if (!subscription) {
    console.log(
      `[billing-service] user ${userId} has no subscription — nothing to cancel (correlationId=${event.correlationId})`,
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
      `[billing-service] hard-canceled subscription ${subscription.subscriptionId} for user ${userId} (correlationId=${event.correlationId})`,
    );
  } else {
    await deps.subscriptionService.cancel(subscription.subscriptionId);
    console.log(
      `[billing-service] soft-canceled (period-end) subscription ${subscription.subscriptionId} for user ${userId} (correlationId=${event.correlationId})`,
    );
  }
}
