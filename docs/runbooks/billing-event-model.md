# Billing event model

Describes every Kafka topic the billing-service produces and consumes, the
shared Zod schema for each, and the lifecycle rules each event enforces.

## Consumed events

### `identity.org.created`

**Schema:** `identityOrgCreatedSchemaV1`  
**Consumer group:** `billing-service-group-ref-index`  
**Handler:** ref-index projection only  
**Billing action:** None at publish time — customer creation is **lazy** (on
first `/checkout` call). `ensureCustomer()` creates the Stripe Customer the
first time billing is accessed for the org, and emits `billing.tenant.registered`.

> **Design note:** Eager creation on `org.created` is explicitly deferred. A
> Stripe Customer is only needed once an org initiates a billing action, and
> creating one for every org (including trial/free orgs that never subscribe)
> inflates Stripe customer count and makes clean-up harder. If proactive
> provisioning is ever needed, add an `org-created.consumer.ts` following the
> same pattern as `org-deleted.consumer.ts`.

---

### `identity.org.deleted`

**Schema:** `identityOrgDeletedSchemaV1`  
**Consumer group:** `billing-service-group-org-deleted`  
**Handler:** `services/billing-service/src/kafka/org-deleted.handler.ts`  
**Billing action:**
- `cascade: 'soft'` → cancel subscription at period end (reversible)
- `cascade: 'hard'` → cancel subscription immediately

No billing customer record is deleted — the history is preserved for
chargebacks and audit.

---

### `identity.user.deleted`

**Schema:** `identityUserDeletedSchemaV1`  
**Consumer group:** `billing-service-group-user-deleted`  
**Handler:** `services/billing-service/src/kafka/user-deleted.handler.ts`  
**Billing action:** Cancels any **user-scoped** Stripe subscription.

FuzeFront subscriptions are primarily org-scoped; this handler covers the
minority case of a personal (user-scoped) billing customer. Apply the same
cascade semantics as org.deleted:
- `cascade: 'soft'` → cancel at period end
- `cascade: 'hard'` → cancel immediately

An org-scoped subscription belonging to an org the user is a member of is NOT
touched by this handler; `org.deleted` owns that path.

---

### `identity.user.created` / `identity.user.updated` / `identity.org.updated` / `identity.membership.*`

**Consumer group:** `billing-service-group-ref-index`  
**Handler:** ref-index projection only  
**Billing action:** Maintains `billing.ref_index` — a local read projection of
user/org identities for fast entity lookups without cross-service joins.

---

### `billing.usage.recorded`

**Schema:** `billingUsageRecordedSchemaV1`  
**Consumer group:** `billing-service-group`  
**Handler:** `services/billing-service/src/kafka/consumer.ts`  
**Billing action:** Forwards metered usage to Stripe Usage Records API.

---

## Published events

All events use the `FuzeEvent<T>` envelope:
```json
{
  "version": "1.0",
  "topic": "<topic>",
  "correlationId": "<uuid>",
  "occurredAt": "<ISO-8601>",
  "payload": { ... }
}
```

---

### `billing.tenant.registered`

**Schema:** `billingTenantRegisteredSchemaV1`  
**Trigger:** A new Stripe Customer is created for an organization (first checkout).  
**Payload:**
```typescript
{
  entityId: string;    // org UUID
  entityType: 'organization';
  stripeCustomerId: string;
}
```

---

### `billing.subscription.changed`

**Schema:** `billingSubscriptionChangedSchemaV1`  
**Trigger:** Subscription created, upgraded, downgraded, trial started,
or status changed (active → past_due → canceled, etc.).  
**Payload:**
```typescript
{
  entityId: string;           // org or user UUID
  entityType: 'user' | 'organization';
  planTier: string;           // e.g. 'professional'
  status: string;             // mirrors Stripe status values
  seatQuantity?: number;
  stripeSubscriptionId: string;
}
```

Consumed by `backend/src/services/billingProjection.ts` to project the
`plan_tier` / `subscription_status` columns into `public.organizations`.

---

### `billing.trial.ending`

**Schema:** `billingTrialEndingSchemaV1`  
**Trigger:** Stripe webhook `customer.subscription.trial_will_end` (typically
3 days before trial expires).  
**Payload:**
```typescript
{
  entityId: string;         // org or user UUID
  entityType: 'user' | 'organization';
  trialEnd: string;         // ISO-8601 datetime
  planTier: string;
}
```

Consumers: notification-service (sends "trial ending soon" email/push).

---

### `billing.payment.failed`

**Schema:** `billingPaymentFailedSchemaV1`  
**Trigger:** Stripe webhook `invoice.payment_failed`.  
**Payload:**
```typescript
{
  entityId: string;         // org or user UUID
  entityType: 'user' | 'organization';
  invoiceId: string;        // Stripe invoice ID (e.g. 'in_...')
  amountDue: number;        // cents (integer)
  currency: string;         // ISO-4217 lowercase (e.g. 'usd')
}
```

Consumers: notification-service (sends "payment failed" email/push).

---

### `billing.payment.completed`

**Schema:** `billingPaymentCompletedSchemaV1`  
**Trigger:** Stripe Checkout Session completed (one-time payment path).  
**Payload:**
```typescript
{
  productKey: string;
  externalOrderId: string;
  entityType: 'user' | 'organization';
  entityId: string;
  stripeSessionId: string;
  stripePaymentIntentId: string | null;
  amountTotalCents: number;
  currency: string;
  status: 'paid' | 'failed' | 'expired';
  occurredAt: string;
}
```

---

### `billing.payment_method.updated`

**Schema:** `billingPaymentMethodUpdatedSchemaV1`  
**Trigger:** Stripe webhook `customer.updated` or
`payment_method.attached`/`detached` when the default payment method changes.  
**Payload:**
```typescript
{
  entityId: string;
  entityType: 'user' | 'organization';
  stripeCustomerId: string;
  paymentMethodId: string;
  brand?: string;       // e.g. 'visa'
  last4?: string;       // e.g. '4242'
}
```

---

## Consumer group summary

| Group | Topics subscribed | Purpose |
|---|---|---|
| `billing-service-group` | `billing.usage.recorded` | Forward usage to Stripe |
| `billing-service-group-ref-index` | `identity.{user,org}.{created,updated,deleted}`, `identity.membership.*`, `portal.created` | Maintain `billing.ref_index` projection |
| `billing-service-group-org-deleted` | `identity.org.deleted` | Cancel org subscription |
| `billing-service-group-user-deleted` | `identity.user.deleted` | Cancel user-scoped subscription |

---

## Portal UI troubleshooting

**Plans not showing:** The billing service serves static default plans (Starter
$29 / Professional $99 / Scale $299 / Enterprise) even before the Stripe
catalogue is synced. If `GET /api/v1/billing/plans` returns empty or 500:
1. Check that `billing-secrets` is sealed and applied in the `fuzefront` namespace.
2. Check that `BILLING_INTERNAL_TOKEN` is set on the backend pod — without it,
   the proxy returns 500 for all billing calls.
3. Run the billing-db-bootstrap Job to ensure the `billing` schema is created.

**No current subscription:** Normal for a new org that has not gone through
checkout yet. Subscribe via the Plans tab; Stripe fires `checkout.session.completed`
which creates the subscription and emits `billing.subscription.changed`.

**No invoices:** Normal before a subscription exists. Invoices appear after the
first billing period or if Stripe is in test mode with explicit invoice creation.
Force a sync: `POST /api/v1/billing/invoices/sync` (internal token required).
