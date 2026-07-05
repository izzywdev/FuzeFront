# Billing & Payments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a fully-featured billing and payments system to FuzeFront. A new `billing-service` microservice handles all Stripe interaction, webhook processing, subscription state, and metered usage reporting. A typed `@fuzefront/billing-client` package exposes its REST API to other services. A `@fuzefront/billing-ui` React package provides the embedded Payment Element UI (design-system-aligned). Entitlements are synced back to Permit.io so the existing permission middleware can gate features by plan.

**Architecture Overview:**
```
[Kafka: billing.usage.recorded] ──► billing-service ──► Stripe Billing Meters
         ▲                                │
  (all services emit)                     │── Stripe webhooks (inbound)
                                          │── Permit.io (plan sync)
                                          │── email-service Kafka topic (trial reminders)
                                          │── Postgres (local mirror)
                                          └── REST API (consumed by backend + billing-ui)
                                                    ▲
                                          @fuzefront/billing-client
                                                    ▲
                                          @fuzefront/billing-ui (React)
                                                    ▲
                                          frontend (host shell checkout flow)
```

**Locked decisions (do not re-open):**
- Stripe **embedded Payment Element** (on-domain), Stripe Link supported, merchant-of-record = us, **Stripe Tax** enabled
- **Dual billing entity**: personal account (`organization.type = 'platform'`) → Stripe Customer keyed on `user.id`; org account (`organization.type = 'organization'`) → Customer keyed on `organization.id`
- **Pricing**: flat tiers + per-seat quantity + usage/metered + one-time/credits
- **Trial**: free tier (permanent) + no-card paid trial (card collected at conversion); trial-end reminders via `email-service` Kafka topic
- **Entitlements via Permit.io**: plan drives permission attributes; `billing-service` updates org/user plan attribute on every subscription state change
- **Metering**: Kafka `billing.usage.recorded` events → `billing-service` aggregation → Stripe Billing Meters
- **PCI scope minimisation**: card data never touches FuzeFront servers; only Stripe `PaymentMethod` IDs and `SetupIntent`/`PaymentIntent` client secrets leave Stripe; all Stripe calls are server-side in `billing-service`

---

## 1. Library & Architecture Review

### 1.1 Capability + Hard Requirements

| Dimension | Requirement |
|-----------|-------------|
| Payment capture | On-domain embedded UI (not redirect); Stripe Link; 3DS/SCA compliant |
| Billing models | Flat tiers, per-seat quantity, metered usage, one-time credits |
| Tax | Automated Stripe Tax (no manual rate maintenance) |
| Trial | No-card free trial for paid tiers; free tier permanent |
| Webhooks | Idempotent processing; signature verification; replay-safe |
| Entitlements | Realtime sync to Permit.io on subscription change |
| Metering | High-throughput usage events → Stripe Billing Meters |
| Compliance | PCI SAQ-A (card data only touches Stripe JS in browser) |
| Multi-tenancy | Per-user (personal) and per-org Customer IDs |
| Scale | Async Kafka pipeline; billing-service horizontally scalable |

### 1.2 Library Tradeoff Table

#### Server-side Stripe client

| Option | Fit | Maturity | License | Footprint | DX/Types | Lock-in | Security |
|--------|-----|----------|---------|-----------|----------|---------|----------|
| **`stripe` (stripe-node) v17** | 100% — official SDK, covers all products | Stripe-maintained, major release every ~12 mo, actively maintained | MIT | ~2 MB server-side (irrelevant) | Excellent — full TS types generated from OpenAPI spec | High (Stripe-specific) but inevitable given vendor lock-in | Webhook sig verify built-in, idempotency key support, retry logic |
| `axios` + raw Stripe REST | ~70% — must hand-roll types, idempotency, retries | DIY | MIT | Smaller | Poor — no codegen types | Lower abstraction lock-in but more bespoke code | Webhook sig verify must be hand-rolled |
| `stripe-node` v14 (older) | ~90% — missing Billing Meters GA support | Unmaintained for new features | MIT | Same | Partial types | Same | Same |
| Build own HTTP client | 10% fit — months of work, zero leverage | N/A | N/A | Custom | Terrible | Bespoke | High risk |

**Recommendation:** `stripe@^17` (stripe-node). It is the only option with Billing Meters, Stripe Tax, and Payment Element server-side helpers (PaymentIntent/SetupIntent creation) as first-class APIs with full TypeScript types. Exit cost is high but unavoidable — we are paying for Stripe's entire infrastructure.

#### Client-side Payment Element

| Option | Fit | Maturity | License | Bundle | DX/Types | Lock-in |
|--------|-----|----------|---------|--------|----------|---------|
| **`@stripe/react-stripe-js` v3 + `@stripe/stripe-js` v5** | 100% — official embedded Payment Element, Stripe Link, 3DS | Stripe-maintained, stable | MIT | ~80 KB (loaded async via `loadStripe`) | Good TS types | High but only viable option for embedded PCI-A |
| Build own form + Stripe.js direct | ~50% — possible but no Payment Element UX | Low | N/A | Custom | Poor | Less abstraction lock-in; much more code |
| Third-party React wrappers (`react-stripe-elements` etc.) | 30% — deprecated by Stripe | Abandoned | MIT | — | Poor | Dead-end |

**Recommendation:** `@stripe/react-stripe-js@^3` + `@stripe/stripe-js@^5`. There is no credible alternative for embedded on-domain card collection that achieves PCI SAQ-A.

#### Webhook verification

Built into `stripe` SDK: `stripe.webhooks.constructEvent(rawBody, sig, secret)`. No separate library needed. **Requirement**: Express route must receive raw `Buffer` body (not parsed JSON) for this endpoint — use `express.raw({ type: 'application/json' })` on the webhook route only.

#### Stripe Tax

No separate library. Enabled at the Stripe product/price level (`automatic_tax: { enabled: true }`) and at PaymentIntent creation. Requires registering tax nexuses in the Stripe dashboard. **No code dependency beyond `stripe` SDK.**

#### Idempotency / state machine

No external library. Implement with Postgres (`billing_events` table, unique `stripe_event_id` column) + advisory locks or `ON CONFLICT DO NOTHING` for webhook deduplication. For metering aggregation consider `billing.usage.recorded` idempotency via `correlationId` from `shared/kafka`.

#### Metering aggregation

No external library needed for MVP. `billing-service` consumes `billing.usage.recorded` Kafka events (using `shared/kafka TypedConsumer`), buffers in Postgres, and reports to `stripe.billing.meterEvents.create()` on a flush interval (configurable, default 60 s). Future: LiteLLM usage events can be adapted to emit `billing.usage.recorded` with `meter_event_name: 'llm_tokens'`.

### 1.3 Final Library Recommendations

| Package | Chosen version | Role |
|---------|---------------|------|
| `stripe` | `^17.x` | Server-side Stripe client in `billing-service` |
| `@stripe/stripe-js` | `^5.x` | Async Stripe.js loader in browser |
| `@stripe/react-stripe-js` | `^3.x` | `<Elements>` provider + `<PaymentElement>` in `@fuzefront/billing-ui` |
| `zod` | `^3.22` (already in `shared/`) | Kafka event schemas for `billing.usage.recorded` |
| `kafkajs` | `^2.2.4` (already in `shared/`) | Metering event consumption |

Runner-up: if we ever move away from Stripe, the server-side logic in `billing-service` is the only tight coupling surface; the Permit.io entitlement sync and Kafka metering pipeline are vendor-agnostic.

---

## 2. Package / Service Boundaries

### 2.1 `services/billing-service`

**npm name:** `@fuzefront/billing-service` (internal, not published)
**Image:** `ghcr.io/izzywdev/fuzefront-billing-service`
**Language:** TypeScript, Node 18, Express
**Sole owner of PCI surface** — all Stripe API calls, all card-adjacent data.

**Public REST API** (versioned `/api/v1/billing/`):

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/setup-intent` | JWT | Create SetupIntent for adding a payment method without charge |
| `POST` | `/subscriptions` | JWT | Create/upgrade subscription; returns client_secret if SCA needed |
| `GET` | `/subscriptions/:entityId` | JWT | Fetch current subscription + plan |
| `PATCH` | `/subscriptions/:entityId` | JWT | Upgrade/downgrade plan, change quantity (seats) |
| `DELETE` | `/subscriptions/:entityId` | JWT | Cancel at period end |
| `GET` | `/invoices/:entityId` | JWT | List invoices |
| `GET` | `/plans` | public | List active plans/prices (cached, 5 min TTL) |
| `POST` | `/credits` | admin JWT | Add one-time credits |
| `POST` | `/webhooks/stripe` | Stripe sig | Stripe webhook receiver (raw body) |

**Internal responsibilities:**
- Stripe Customer creation/lookup (dual-entity logic)
- Subscription CRUD with proration
- Stripe Tax passthrough (no code required beyond flag)
- Webhook idempotency (Postgres `billing_stripe_events` dedup table)
- Permit.io plan attribute sync on subscription change
- Kafka consumer: `billing.usage.recorded` → buffer → Stripe Meter Events flush
- Kafka producer: `billing.trial.ending` → `email-service` picks it up
- Dunning: consume Stripe `invoice.payment_failed` webhook → emit `billing.payment_failed` Kafka event

**Does NOT own:**
- Frontend rendering (owned by `@fuzefront/billing-ui`)
- Feature gating reads (owned by `middleware/permissions.ts` via Permit.io)
- Email rendering/sending (owned by `email-service`)

### 2.2 `packages/billing-client` → `@fuzefront/billing-client`

**Role:** Thin typed HTTP client wrapping `billing-service` REST API. Used by `backend` (to check entitlements inline) and potentially other services.

**Public interface:**
```typescript
class BillingClient {
  constructor(config: { baseUrl: string; internalToken: string })
  getSubscription(entityId: string): Promise<BillingSubscription>
  getPlans(): Promise<Plan[]>
  createSubscription(req: CreateSubscriptionRequest): Promise<CreateSubscriptionResponse>
  updateSubscription(entityId: string, req: UpdateSubscriptionRequest): Promise<BillingSubscription>
  cancelSubscription(entityId: string): Promise<void>
  addCredits(entityId: string, amount: number, note: string): Promise<void>
  createSetupIntent(entityId: string): Promise<{ clientSecret: string }>
}
// All types exported from @fuzefront/billing-client
export type { BillingSubscription, Plan, PlanTier, CreateSubscriptionRequest, ... }
```

### 2.3 `packages/billing-ui` → `@fuzefront/billing-ui`

**Role:** React component library. All Stripe Payment Element integration lives here; nothing billing-UI-specific leaks into `frontend/`.

**Public components (design-system-first specs below):**

| Component | Description |
|-----------|-------------|
| `<CheckoutModal>` | Full modal: plan picker → Payment Element → confirmation |
| `<PlanCard>` | Displays a single plan tier with CTA; variant: `current`, `upgrade`, `downgrade` |
| `<PlanPickerGrid>` | Responsive grid of `<PlanCard>` items |
| `<PaymentElementWrapper>` | Wraps `<Elements>` + `<PaymentElement>`; emits `onSuccess(paymentMethodId)` |
| `<SubscriptionStatus>` | Badge showing trial / active / past_due / canceled state |
| `<UsageMeter>` | Progress bar showing consumed vs. included units |
| `<InvoiceTable>` | Paginated invoice list |
| `<BillingPortalButton>` | Opens Stripe Customer Portal (new tab) |
| `<SeatCountInput>` | Numeric input for seat quantity with price preview |

**Design-system tokens used** (no bespoke styling):
- Surfaces: `--bg-tertiary` (card), `--bg-quaternary` (raised/hover)
- Accent: `--accent-color` (indigo-500 dark / indigo-600 light), `--seam` gradient for plan highlight
- Status: `--success-color` (active), `--warning-color` (trial), `--error-color` (past_due)
- Typography: existing type scale from `design-system/tokens/typography.css`
- Borders: `--border-color`, `--border-strong`

**Component specs (states / variants / a11y):**

`<PlanCard>`:
- Variants: `default`, `current` (accent border + "Current plan" badge), `highlighted` (seam gradient top border — used for recommended tier), `disabled` (grayed, `aria-disabled="true"`)
- States: idle, hovered (`--bg-quaternary` lift), loading (spinner CTA)
- a11y: `role="article"`, CTA is `<button>` not `<div>`, `aria-label="Upgrade to {planName}"`, keyboard-focusable

`<PaymentElementWrapper>`:
- Stripe Elements `appearance` object uses `--bg-tertiary`, `--text-primary`, `--accent-color`, `--border-color` mapped to Stripe's theme vars
- Stripe logo and badge are kept (required by Stripe ToS)
- Shows `<SubscriptionStatus variant="loading">` while `clientSecret` is fetching

`<SubscriptionStatus>`:
- Renders as a pill badge, variants match Stripe status strings: `trialing` (warning amber), `active` (success mint), `past_due` (error coral), `canceled` (muted), `unpaid` (error)

---

## 3. Data Model

### 3.1 New Migrations (billing-service owns its own Postgres schema)

`billing-service` connects to the **same Postgres instance** (separate schema `billing`) for MVP; promote to own instance when load demands it.

#### `billing.customers`
```sql
id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
entity_type     TEXT NOT NULL CHECK (entity_type IN ('user', 'organization'))
entity_id       UUID NOT NULL           -- references users.id or organizations.id
stripe_customer_id TEXT NOT NULL UNIQUE
created_at      TIMESTAMPTZ DEFAULT now()
updated_at      TIMESTAMPTZ DEFAULT now()
UNIQUE(entity_type, entity_id)
```

#### `billing.subscriptions` (local mirror of Stripe Subscription)
```sql
id                  UUID PRIMARY KEY DEFAULT gen_random_uuid()
customer_id         UUID NOT NULL REFERENCES billing.customers(id)
stripe_subscription_id TEXT NOT NULL UNIQUE
stripe_price_id     TEXT NOT NULL
plan_tier           TEXT NOT NULL         -- 'free'|'starter'|'pro'|'enterprise'
status              TEXT NOT NULL         -- mirrors Stripe status enum
seat_quantity       INTEGER NOT NULL DEFAULT 1
trial_start         TIMESTAMPTZ
trial_end           TIMESTAMPTZ
current_period_start TIMESTAMPTZ
current_period_end   TIMESTAMPTZ
cancel_at_period_end BOOLEAN DEFAULT FALSE
canceled_at         TIMESTAMPTZ
metadata            JSONB DEFAULT '{}'
created_at          TIMESTAMPTZ DEFAULT now()
updated_at          TIMESTAMPTZ DEFAULT now()
```

#### `billing.stripe_events` (idempotency table)
```sql
id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
stripe_event_id TEXT NOT NULL UNIQUE    -- Stripe evt_xxx
event_type      TEXT NOT NULL
processed_at    TIMESTAMPTZ DEFAULT now()
payload         JSONB NOT NULL
```
Webhook handler does `INSERT ... ON CONFLICT (stripe_event_id) DO NOTHING` before processing. If 0 rows inserted, return 200 immediately (already processed).

#### `billing.usage_events` (metering buffer)
```sql
id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
entity_id       UUID NOT NULL
meter_event_name TEXT NOT NULL          -- e.g. 'api_calls', 'llm_tokens'
quantity        BIGINT NOT NULL
occurred_at     TIMESTAMPTZ NOT NULL
correlation_id  TEXT NOT NULL UNIQUE    -- from shared/kafka FuzeEvent.correlationId
reported_at     TIMESTAMPTZ            -- NULL = not yet reported to Stripe
stripe_meter_event_id TEXT             -- Stripe's idempotency key echo
```

#### `billing.plans` (config cache — source of truth is Stripe; this is a read cache)
```sql
id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
stripe_price_id TEXT NOT NULL UNIQUE
stripe_product_id TEXT NOT NULL
tier_name       TEXT NOT NULL
display_name    TEXT NOT NULL
billing_interval TEXT NOT NULL         -- 'month'|'year'
unit_amount     INTEGER NOT NULL       -- cents
currency        TEXT NOT NULL DEFAULT 'usd'
seat_based      BOOLEAN DEFAULT FALSE
metered_meter_name TEXT               -- if has metered component
features        JSONB DEFAULT '[]'    -- display features list
is_active       BOOLEAN DEFAULT TRUE
sort_order      INTEGER DEFAULT 0
synced_at       TIMESTAMPTZ DEFAULT now()
```

### 3.2 Schema additions to `public` (owned by `backend` migrations)

Migration `009_add_billing_to_entities.ts`:
```sql
-- Users: Stripe customer reference + plan cache (avoid join on hot path)
ALTER TABLE users
  ADD COLUMN stripe_customer_id TEXT,         -- nullable until first subscription
  ADD COLUMN billing_plan_tier   TEXT NOT NULL DEFAULT 'free',
  ADD COLUMN billing_plan_status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN trial_ends_at       TIMESTAMPTZ;

-- Organizations: same
ALTER TABLE organizations
  ADD COLUMN stripe_customer_id  TEXT,
  ADD COLUMN billing_plan_tier   TEXT NOT NULL DEFAULT 'free',
  ADD COLUMN billing_plan_status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN trial_ends_at       TIMESTAMPTZ;
```
These columns are **write-only from `billing-service`** (via internal API or direct DB connection with least-privilege role); `backend` reads them for plan-gated UI hints only. Permit.io is the authoritative entitlement store.

---

## 4. Metering Pipeline

```
Service emits          shared/kafka             billing-service             Stripe
billing.usage.recorded ──────────────► TypedConsumer ──► usage_events ──► stripe.billing.meterEvents.create()
                                                                ▲
                                              flush every 60 s (configurable BILLING_METER_FLUSH_INTERVAL_SEC)
                                              batch up to 1000 events per call
                                              mark reported_at on success
                                              retry on transient failure (exponential backoff, max 5 attempts)
                                              dead-letter to billing.usage.recorded.dlq on permanent failure
```

**Kafka schema for `billing.usage.recorded`** (new, added to `shared/src/kafka/schemas/`):
```typescript
// shared/src/kafka/schemas/billing.usage.recorded.ts
export const BillingUsageRecordedV1Schema = z.object({
  entityId:        z.string().uuid(),
  entityType:      z.enum(['user', 'organization']),
  meterEventName:  z.string(),         // matches Stripe Billing Meter name
  quantity:        z.number().int().positive(),
  occurredAt:      z.string().datetime(),
  // correlationId comes from FuzeEvent envelope — used as Stripe idempotency key
})
```

**Idempotency contract:** `FuzeEvent.correlationId` is used as `stripe.billing.meterEvents.create({ identifier: correlationId, ... })` so Stripe deduplicates at their end even if we flush the same event twice.

**LiteLLM hook (future, called out):** LiteLLM's callback system can emit a `billing.usage.recorded` event with `meterEventName: 'llm_tokens'` via a custom `TypedProducer`. No billing-service code changes required.

---

## 5. Entitlement Sync: Billing → Permit.io

When `billing-service` processes a Stripe subscription webhook (`customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_succeeded`):

1. Map `stripe_price_id` → `plan_tier` (via `billing.plans` cache)
2. Look up `entity_type`/`entity_id` from `billing.customers`
3. Call Permit.io API to update the user/tenant plan attribute:
   ```typescript
   // For user billing entity:
   await permit.api.users.update(userId, {
     attributes: { plan_tier: planTier, plan_status: newStatus }
   })
   // For org billing entity — update tenant attributes:
   await permit.api.tenants.update(orgId, {
     attributes: { plan_tier: planTier, plan_status: newStatus, seat_limit: quantity }
   })
   ```
4. Also write `billing_plan_tier` / `billing_plan_status` to `users` / `organizations` table (hot-path cache)
5. Emit `billing.subscription.changed` Kafka event (for downstream observers)

**How gating reads it:** The existing `permissions.ts` middleware calls `permit.check(userId, action, resource, context)`. Add `plan_tier` to the `context` parameter so ABAC rules in Permit can condition on it. No middleware code change needed — only Permit policy definition changes.

**New Permit resource/actions to define** (in Permit IaC / schema job):
- Resource: `BillingPlan`, actions: `view_billing`, `manage_billing`
- Role conditions: `admin` or `owner` can manage_billing; all roles can view_billing
- ABAC conditions: `resource.feature_gate` ⊆ `user.attributes.plan_tier` (example; exact ABAC definition is a Permit policy concern)

---

## 6. Trial & Free-Tier Lifecycle

### Free tier
- Created automatically on first user/org registration via `billing-service` internal event (`identity.user.created` Kafka topic already exists)
- Stripe Customer created lazily (on first paid action), not at free-tier signup
- `billing_plan_tier = 'free'` written to DB and Permit

### No-card paid trial
- `POST /api/v1/billing/subscriptions` with `{ planTier: 'starter', trial: true }` starts a Stripe trial subscription (`trial_period_days: 14`, no payment method required)
- `trial_end` stored in local subscription mirror
- `billing-service` runs a daily cron (or consumes `customer.subscription.trial_will_end` webhook — Stripe fires 3 days before) → emits `notify.email.requested` Kafka event with template `billing-trial-ending`
- On trial end: if no payment method → subscription moves to `past_due` → emit `billing.trial.expired` → Permit downgrades to `free`

### Dunning
- Stripe handles automatic retries (Smart Retries enabled in dashboard)
- `invoice.payment_failed` webhook → `billing-service` emits `notify.email.requested` (template: `billing-payment-failed`) + writes `billing_plan_status = 'past_due'` to DB + updates Permit
- After Stripe's final retry fails → `customer.subscription.deleted` webhook → downgrade to `free`

### Annual/monthly proration
- Defaults: monthly billing interval; annual available at discounted price (separate Stripe Price per tier)
- Upgrade mid-cycle: `proration_behavior: 'create_prorations'` (Stripe default — creates credit/debit line items on next invoice)
- Downgrade mid-cycle: `proration_behavior: 'none'` with `billing_cycle_anchor: 'unchanged'` — effective at period end. Call out to the human: **this is a policy decision** (immediate vs. period-end downgrade); plan defaults to period-end.

---

## 7. Security

### PCI Scope
- `billing-service` never receives raw card numbers. Payment Element sends card data directly to Stripe's servers (iframe hosted on `js.stripe.com`). Our servers only ever see `PaymentMethod` IDs.
- PCI SAQ-A self-assessment is sufficient if we maintain this isolation.
- **No client secrets or secret keys in frontend code.** `STRIPE_SECRET_KEY` lives only in `billing-service` env, sourced from SealedSecret.
- Publishable key (`STRIPE_PUBLISHABLE_KEY`) is safe to ship to the browser (only creates PaymentIntents client-side, never makes server-side API calls).

### Webhook Signature Verification
```typescript
// billing-service/src/routes/webhooks.ts
router.post(
  '/webhooks/stripe',
  express.raw({ type: 'application/json' }),   // MUST be raw body
  (req, res) => {
    const sig = req.headers['stripe-signature'] as string;
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
    } catch (err) {
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
    // dedup via billing.stripe_events INSERT ON CONFLICT ...
  }
)
```

### Idempotency Keys
All mutating Stripe API calls include an idempotency key:
```typescript
stripe.subscriptions.create({ ... }, { idempotencyKey: `sub-create-${entityId}-${priceId}` })
stripe.billing.meterEvents.create({ ... }, { idempotencyKey: correlationId })
```

### Secrets in Helm
```yaml
# deploy/helm/fuzefront/templates/secret.yaml additions
{{- if .Values.secret.stripeSecretKey }}
STRIPE_SECRET_KEY: {{ .Values.secret.stripeSecretKey | quote }}
{{- end }}
{{- if .Values.secret.stripeWebhookSecret }}
STRIPE_WEBHOOK_SECRET: {{ .Values.secret.stripeWebhookSecret | quote }}
{{- end }}
{{- if .Values.secret.stripePublishableKey }}
STRIPE_PUBLISHABLE_KEY: {{ .Values.secret.stripePublishableKey | quote }}
{{- end }}
```
In production, promote to `SealedSecret` (already the pattern for `PERMIT_API_KEY`). The `values-prod.yaml` `secret.*` fields reference external secret manager values, not plaintext. **Never commit real Stripe keys to git.**

### Internal Service Auth
`billing-service` REST API is not publicly exposed. It is called by:
- `backend` via `@fuzefront/billing-client` using a shared `BILLING_INTERNAL_TOKEN` (Bearer, validated by billing-service middleware)
- Stripe webhooks (external, signature-verified)
- `billing-ui` never calls `billing-service` directly — it calls `backend` which proxies or the client is initialized server-side

---

## 8. File Map

### New service — `services/billing-service/`

| File | Responsibility |
|------|---------------|
| `package.json` | `@fuzefront/billing-service`; deps: `stripe@^17`, `kafkajs@^2.2.4`, `zod@^3.22`, `express@^4.19`, `pg@^8` |
| `tsconfig.json` | Matches `backend` conventions (`"strict": false, "noImplicitAny": false`) |
| `jest.config.js` | ts-jest config mirroring `backend` |
| `Dockerfile` | Multi-stage, `node:18-alpine`, mirrors `backend/Dockerfile` |
| `src/config.ts` | `Config` interface + `loadConfig()` from env |
| `src/stripe-client.ts` | Singleton `Stripe` instance with `apiVersion: '2024-06-20'` |
| `src/db.ts` | `pg.Pool` factory; runs `billing` schema migrations on startup |
| `src/migrations/001_billing_schema.sql` | All `billing.*` tables defined above |
| `src/services/customer.service.ts` | `ensureCustomer(entityType, entityId)` — create or fetch Stripe Customer |
| `src/services/subscription.service.ts` | Create/update/cancel subscription; proration logic |
| `src/services/plan.service.ts` | Sync Stripe Products/Prices → `billing.plans` cache; `getActivePlans()` |
| `src/services/metering.service.ts` | Buffer usage events; flush to Stripe Meter Events |
| `src/services/permit.service.ts` | `syncPlanToPermit(entityType, entityId, planTier, status)` |
| `src/routes/setup-intent.ts` | `POST /api/v1/billing/setup-intent` |
| `src/routes/subscriptions.ts` | Subscription CRUD routes |
| `src/routes/plans.ts` | `GET /api/v1/billing/plans` (cached) |
| `src/routes/credits.ts` | `POST /api/v1/billing/credits` |
| `src/routes/webhooks.ts` | `POST /api/v1/billing/webhooks/stripe` (raw body, sig verify) |
| `src/handlers/webhook-router.ts` | Routes Stripe event types to handler functions |
| `src/handlers/subscription-updated.ts` | Handles `customer.subscription.updated/deleted` |
| `src/handlers/invoice-paid.ts` | Handles `invoice.payment_succeeded` |
| `src/handlers/invoice-failed.ts` | Handles `invoice.payment_failed` → dunning |
| `src/handlers/trial-ending.ts` | Handles `customer.subscription.trial_will_end` → email event |
| `src/kafka/consumer.ts` | Subscribes to `billing.usage.recorded`; calls metering.service |
| `src/kafka/producer.ts` | Emits `billing.trial.ending`, `billing.payment.failed`, `billing.subscription.changed` |
| `src/middleware/auth.ts` | Verify `BILLING_INTERNAL_TOKEN` Bearer on non-webhook routes |
| `src/app.ts` | Express app assembly |
| `src/index.ts` | Entry: DB migrate → Kafka connect → Express listen |
| `tests/services/subscription.service.test.ts` | Unit tests (mocked Stripe + DB) |
| `tests/handlers/subscription-updated.test.ts` | Unit tests (mocked Permit + DB) |
| `tests/routes/webhooks.test.ts` | Webhook sig verify + dedup tests |

### New package — `packages/billing-client/`

| File | Responsibility |
|------|---------------|
| `package.json` | `@fuzefront/billing-client`; deps: `axios@^1.7`, `zod@^3.22` |
| `tsconfig.json` | `"strict": true`, targets `ES2020`, `declarationDir: dist/types` |
| `src/client.ts` | `BillingClient` class (see § 2.2) |
| `src/types.ts` | All shared billing types exported |
| `src/index.ts` | Barrel re-export |
| `tests/client.test.ts` | Unit tests with mocked HTTP |

### New package — `packages/billing-ui/`

| File | Responsibility |
|------|---------------|
| `package.json` | `@fuzefront/billing-ui`; deps: `@stripe/react-stripe-js@^3`, `@stripe/stripe-js@^5`, `react@^18` (peer) |
| `tsconfig.json` | Strict, JSX react-jsx |
| `src/index.ts` | Barrel export all components |
| `src/components/CheckoutModal.tsx` | Full checkout flow modal |
| `src/components/PlanCard.tsx` | Single plan display card (design-system tokens) |
| `src/components/PlanPickerGrid.tsx` | Responsive grid wrapper |
| `src/components/PaymentElementWrapper.tsx` | `<Elements>` + `<PaymentElement>` + theme mapping |
| `src/components/SubscriptionStatus.tsx` | Status pill badge |
| `src/components/UsageMeter.tsx` | Usage progress bar |
| `src/components/InvoiceTable.tsx` | Paginated invoice list |
| `src/components/BillingPortalButton.tsx` | Opens Stripe Customer Portal |
| `src/components/SeatCountInput.tsx` | Seat quantity input + price preview |
| `src/hooks/useBillingClient.ts` | React context + hook for `BillingClient` |
| `src/hooks/useSubscription.ts` | Fetches + caches subscription state |
| `src/hooks/usePlans.ts` | Fetches plan list |
| `src/theme/stripe-appearance.ts` | Stripe `Appearance` object built from CSS vars |
| `tests/components/PlanCard.test.tsx` | RTL unit tests |
| `tests/components/CheckoutModal.test.tsx` | RTL unit tests (mocked Stripe Elements) |

### Modified files — existing repo

| File | Change |
|------|--------|
| `shared/src/kafka/types.ts` | Add new topics: `BILLING_USAGE_RECORDED`, `BILLING_SUBSCRIPTION_CHANGED`, `BILLING_TRIAL_ENDING`, `BILLING_PAYMENT_FAILED` |
| `shared/src/kafka/schemas/billing.usage.recorded.ts` | New Zod schema |
| `shared/src/kafka/schemas/billing.subscription.changed.ts` | New Zod schema |
| `shared/src/kafka/schemas/index.ts` | Re-export new schemas |
| `backend/src/migrations/009_add_billing_to_entities.ts` | ALTER TABLE users/organizations to add billing columns (§ 3.2) |
| `deploy/helm/fuzefront/templates/secret.yaml` | Add `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PUBLISHABLE_KEY`, `BILLING_INTERNAL_TOKEN` |
| `deploy/helm/fuzefront/templates/billing-service.yaml` | New — Deployment + Service for `billing-service` |
| `deploy/helm/fuzefront/values.yaml` | Add `billing-service` image, replicas, env; `secret.stripe*` fields |
| `deploy/helm/fuzefront/values-local.yaml` | Local overrides (no real Stripe keys; use Stripe test mode keys) |
| `skaffold.yaml` | Add `billing-service` artifact + deploy |
| `package.json` | Add `packages/billing-client` and `packages/billing-ui` to `lerna.json` packages |
| `services/email-service/src/templates/` | Add `billing-trial-ending.ts` and `billing-payment-failed.ts` templates |

---

## 9. Helm / Deploy

`deploy/helm/fuzefront/templates/billing-service.yaml`:
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "fuzefront.fullname" . }}-billing-service
spec:
  replicas: {{ .Values.billingService.replicas | default 1 }}
  # ... standard labels/selectors ...
  template:
    spec:
      containers:
        - name: billing-service
          image: "{{ .Values.billingService.image.repository }}:{{ .Values.billingService.image.tag }}"
          env:
            - name: STRIPE_SECRET_KEY
              valueFrom: { secretKeyRef: { name: {{ include "fuzefront.secretName" . }}, key: STRIPE_SECRET_KEY } }
            - name: STRIPE_WEBHOOK_SECRET
              valueFrom: { secretKeyRef: { name: ..., key: STRIPE_WEBHOOK_SECRET } }
            - name: BILLING_INTERNAL_TOKEN
              valueFrom: { secretKeyRef: { name: ..., key: BILLING_INTERNAL_TOKEN } }
            - name: DATABASE_URL
              value: "postgresql://billing_svc:$(DB_PASSWORD)@postgres:5432/fuzefront"
            - name: KAFKA_BROKERS
              value: {{ .Values.kafka.brokers | quote }}
            - name: PERMIT_API_KEY
              valueFrom: { secretKeyRef: { ... } }
          ports: [{ containerPort: 3002 }]
          livenessProbe: { httpGet: { path: /health, port: 3002 } }
```

Stripe webhook endpoint registration: register `https://your-domain.com/api/v1/billing/webhooks/stripe` in Stripe dashboard (or via Stripe CLI in local dev with `stripe listen --forward-to localhost:3002/api/v1/billing/webhooks/stripe`).

Least-privilege DB role `billing_svc` (add to `db-bootstrap-job`):
```sql
CREATE ROLE billing_svc LOGIN PASSWORD '...';
GRANT USAGE ON SCHEMA billing TO billing_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA billing TO billing_svc;
-- Read-only on public schema for entity lookups:
GRANT USAGE ON SCHEMA public TO billing_svc;
GRANT SELECT ON public.users, public.organizations TO billing_svc;
-- Write billing columns back to public (plan tier cache):
GRANT UPDATE (stripe_customer_id, billing_plan_tier, billing_plan_status, trial_ends_at)
  ON public.users, public.organizations TO billing_svc;
```

---

## 10. TDD Task Breakdown

> Implement in order. Each task is independently committable. Use `superpowers:test-driven-development` per task.

### Phase 1 — Foundation

- [ ] **T1: Shared Kafka billing topics + schemas**
  Files: `shared/src/kafka/types.ts`, `shared/src/kafka/schemas/billing.*.ts`, `shared/src/kafka/schemas/index.ts`
  Test: schema Zod parse passes for valid payloads; rejects invalid
  Verify: `npm run build` in `shared/` passes; no existing tests break

- [ ] **T2: billing-service scaffold**
  Files: `services/billing-service/package.json`, `tsconfig.json`, `jest.config.js`, `Dockerfile`, `src/config.ts`, `src/app.ts`, `src/index.ts`
  Test: `GET /health` returns 200 with `{ status: 'ok' }`
  Verify: `docker build` succeeds; health endpoint test green

- [ ] **T3: DB migration for billing schema**
  Files: `services/billing-service/src/db.ts`, `src/migrations/001_billing_schema.sql`
  Test: migration is idempotent (`CREATE TABLE IF NOT EXISTS`); all FK constraints present
  Verify: migration runs against a test Postgres container

- [ ] **T4: DB migration 009 — billing columns on public schema**
  Files: `backend/src/migrations/009_add_billing_to_entities.ts`
  Test: migration up/down; columns present after up
  Verify: existing backend tests still pass

### Phase 2 — Core Billing Service Logic

- [ ] **T5: Stripe customer service**
  Files: `src/services/customer.service.ts`, `src/stripe-client.ts`
  Test: `ensureCustomer` creates Stripe Customer on first call; returns existing ID on second call (mock `stripe.customers.create` and `billing.customers` table)
  Verify: unit tests pass; no real Stripe calls

- [ ] **T6: Plan sync service**
  Files: `src/services/plan.service.ts`
  Test: `syncPlans()` upserts to `billing.plans` from mock Stripe response; `getActivePlans()` returns cached result
  Verify: unit tests; `GET /api/v1/billing/plans` returns 200 with plan list

- [ ] **T7: Subscription service — create**
  Files: `src/services/subscription.service.ts`, `src/routes/subscriptions.ts`
  Test: creates Stripe subscription with correct params; writes to `billing.subscriptions`; handles `requires_action` (SCA) response
  Verify: unit tests with mocked Stripe + DB

- [ ] **T8: Subscription service — update and cancel**
  Files: `src/services/subscription.service.ts` (continued)
  Test: upgrade proration uses `create_prorations`; downgrade uses `none` at period end; cancel sets `cancel_at_period_end`
  Verify: unit tests; route integration test

- [ ] **T9: SetupIntent route**
  Files: `src/routes/setup-intent.ts`
  Test: returns `clientSecret` from mocked Stripe; requires auth
  Verify: unit tests

### Phase 3 — Webhooks

- [ ] **T10: Webhook signature verification + idempotency**
  Files: `src/routes/webhooks.ts`, `src/handlers/webhook-router.ts`
  Test: valid signature processes; invalid signature returns 400; duplicate `stripe_event_id` returns 200 without re-processing
  Verify: tests green; raw body middleware not interfering with other routes

- [ ] **T11: Subscription webhook handlers**
  Files: `src/handlers/subscription-updated.ts`, `src/handlers/invoice-paid.ts`, `src/handlers/invoice-failed.ts`, `src/handlers/trial-ending.ts`
  Test: each handler updates `billing.subscriptions`, calls `permit.service.syncPlanToPermit`, emits correct Kafka event
  Verify: unit tests; Permit sync called with correct args

- [ ] **T12: Permit.io plan sync service**
  Files: `src/services/permit.service.ts`
  Test: calls `permit.api.users.update` for user entity; `permit.api.tenants.update` for org entity; handles Permit API errors gracefully (retry + log, do not fail webhook)
  Verify: unit tests with mocked `permitio` client

### Phase 4 — Metering

- [ ] **T13: Metering service — buffer + flush**
  Files: `src/services/metering.service.ts`, `src/kafka/consumer.ts`
  Test: Kafka consumer writes to `billing.usage_events`; flush loop calls `stripe.billing.meterEvents.create` with correct idempotency key; marks `reported_at` on success; dead-letters on failure
  Verify: unit tests; flush idempotency tested (same correlationId sent twice → Stripe called once)

### Phase 5 — Client + UI packages

- [ ] **T14: `@fuzefront/billing-client` package**
  Files: all files in `packages/billing-client/`
  Test: all methods call correct HTTP endpoints; types exported correctly
  Verify: `tsc --noEmit` passes; unit tests green

- [ ] **T15: `@fuzefront/billing-ui` — design-system theme + base components**
  Files: `src/theme/stripe-appearance.ts`, `src/components/SubscriptionStatus.tsx`, `src/components/UsageMeter.tsx`, `src/components/PlanCard.tsx`, `src/components/PlanPickerGrid.tsx`
  Test: RTL renders with correct ARIA; design-system token CSS vars applied (snapshot or className checks)
  Verify: Storybook / visual spot-check; tokens from `design-system/tokens/colors.css` used; no bespoke hex values

- [ ] **T16: `@fuzefront/billing-ui` — Payment Element wrapper**
  Files: `src/components/PaymentElementWrapper.tsx`, `src/hooks/useBillingClient.ts`, `src/hooks/useSubscription.ts`
  Test: RTL renders with mocked `@stripe/react-stripe-js`; `onSuccess` callback fires with PaymentMethod ID
  Verify: mock Stripe Elements renders without error

- [ ] **T17: `@fuzefront/billing-ui` — CheckoutModal + InvoiceTable**
  Files: remaining component files
  Test: CheckoutModal step transitions (plan picker → payment → confirmation); InvoiceTable paginates
  Verify: RTL tests green

### Phase 6 — Infrastructure

- [ ] **T18: Helm chart additions**
  Files: `deploy/helm/fuzefront/templates/billing-service.yaml`, `secret.yaml` additions, `values.yaml`, `values-local.yaml`, `skaffold.yaml`
  Test: `helm template` renders without errors; secrets not in plaintext in `values-prod.yaml`
  Verify: `helm lint`; `skaffold build --dry-run` passes

- [ ] **T19: email-service billing templates**
  Files: `services/email-service/src/templates/billing-trial-ending.ts`, `billing-payment-failed.ts`
  Test: templates render with expected subject/body given test vars
  Verify: email-service existing tests still pass

- [ ] **T20: DB role + least-privilege bootstrap**
  Files: `deploy/helm/fuzefront/templates/db-bootstrap-job.yaml` (or init SQL)
  Test: `billing_svc` role created; correct grants; cannot write to unauthorized tables
  Verify: psql test against local cluster

---

## 11. Open Risks for the Human

1. **Stripe Tax nexus setup** — Stripe Tax requires manually registering tax jurisdictions in the Stripe Dashboard before it activates. This is a business/legal decision (which countries/states to collect tax in). The code enables the feature flag but nexus registration is out-of-scope for this implementation plan.

2. **Proration policy on downgrades** — the plan defaults to "no proration, effective at period end" for downgrades. If the business wants immediate credit for unused time, change `proration_behavior` to `'create_prorations'` on downgrades. Needs explicit product decision before T8 is implemented.

3. **Permit.io ABAC plan-gating schema** — the plan adds `plan_tier` as a user/tenant attribute, but the actual ABAC conditions (which features are gated at which tier) need to be defined in the Permit policy DSL before the Permit service can enforce them. This is a product decision (what does each tier unlock). The Permit schema IaC plan (`2026-06-18-permit-pdp-policy-iac.md`) should be updated to include billing resource conditions.

4. **Stripe webhook reliability in local dev** — Stripe webhooks cannot reach a `kind` cluster directly. Local dev requires running `stripe listen --forward-to ...` (Stripe CLI) or using Stripe's webhook test fixtures. The Skaffold/local setup does not currently include the Stripe CLI sidecar. Add a note to `values-local.yaml` or a `scripts/` helper.

5. **Seat counting at Stripe vs. local** — the plan stores `seat_quantity` locally and passes it to Stripe as `quantity` on the subscription item. However, actual membership count in `organization_memberships` is not validated against the subscribed seat quantity before adding members. An enforcement check (reject `addMember` if seats exhausted) needs to be added to `routes/organizations.ts` using `@fuzefront/billing-client`; this is a follow-on task not in the TDD breakdown above.

6. **`billing-service` Postgres schema isolation** — for MVP, `billing.*` tables live in the same Postgres instance as `public.*` (just a different schema). If billing traffic grows large (high metering event volume), the `billing.usage_events` table can become a hotspot. The design allows promoting to a separate Postgres instance by changing `DATABASE_URL` in the billing-service deployment only.

7. **Annual billing proration at annual renewal** — upgrading from monthly to annual mid-cycle creates a complex proration scenario (monthly amount credited, annual charged). Stripe handles the math but the UX messaging in `<CheckoutModal>` needs to show the prorated amount clearly. This is a UX implementation detail for T17 but needs product sign-off on the copy.
