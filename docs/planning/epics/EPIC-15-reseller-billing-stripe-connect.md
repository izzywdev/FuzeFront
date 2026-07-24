---
key: FF-EPIC-15
title: Reseller Billing (Stripe Connect) — tenants bill their own customers on our rails
label: [fuzefront, billing, contract-first, permit-gated, feature-flag, deploy-window, needs-jira-upload]
github: TBD
status: ready
priority: High
domain: Billing
---

## 🎯 Epic: Reseller Billing (Stripe Connect)

| Field | Value |
|-------|-------|
| **Epic ID** | FF-EPIC-15 |
| **Domain** | Billing |
| **Priority** | High |
| **Owner** | Orchestrator (delegated to `billing-payments-engineer` + `backend-engineer` + `frontend-engineer`) |
| **Target Release** | Next deploy window |
| **Effort Estimate** | XL |
| **GitHub** | TBD |

---

### 📌 Problem Statement
> Billing today runs on a single platform Stripe account — there is no Connect integration anywhere in
> the codebase. A tenant portal (e.g. a reseller running mendysrobotics-style white-label) cannot bill
> THEIR customers on our infrastructure with their own prices while we execute payment on their behalf
> and take a cut. This is a hard product requirement for the reseller/partner model and is entirely
> unbuilt today — tenants have no path to monetize their own portal.

### 🎯 Goal
> A tenant onboards a Stripe connected account, defines their own price book, and charges their
> customers via on-behalf checkout (destination charges + application fee = our cut), while we
> separately charge the tenant our own platform price and Stripe handles the tenant's payouts and
> compliance.

### 👥 Target Personas
- **Tenant Reseller** — a portal admin who bills their own customers and needs their own Stripe presence, price book, and payout rail.
- **Portal End-User** — the reseller's customer, checking out against the reseller's price book, never seeing platform internals.
- **Master Admin** — needs the platform-charges-tenant relationship (our own subscription revenue from the portal) to keep working unchanged.

### ✅ Features In Scope
- [ ] Feature 1: `connected_accounts` + `tenant_plans` schema and account model (portal ↔ Stripe connected account).
- [ ] Feature 2: Connect onboarding (Express, Account Links) + `account.updated` status webhooks (charges/payouts enabled).
- [ ] Feature 3: Tenant price book — products/prices created on the connected account, cached to `tenant_plans`.
- [ ] Feature 4: On-behalf checkout (`on_behalf_of` + `transfer_data.destination` + `application_fee_amount`) and connected-account (Stripe-Account aware) webhook routing through the existing idempotent webhook router.
- [ ] Feature 5: Platform-charges-tenant — the portal org subscribes to FuzeFront's own plans, independent of the tenant's own customer billing.
- [ ] Feature 6: Portal-admin billing pages (their customers' subscriptions/invoices) via a portal-context-aware billing proxy.
- [ ] Feature 7: `fuzefront.billing.reseller-connect` feature flag, default OFF, gating all of the above.

### 🚫 Out of Scope
- Migrating the vendor-neutral payment-service port — future initiative, not required for this epic.
- Tax/VAT handling beyond Stripe's own defaults — no custom tax engine.
- The portal-admin billing CONSOLE UI shell itself (FF-EPIC-14 owns the console; this epic ships the pages/API it embeds).
- Marketplace-style multi-processor support (PayPal, etc.) — Stripe Connect only.

### 🏗️ High-Level Architecture Notes
> `billing-service` (`services/billing-service/`) keeps owning all Stripe calls — no new service is
> introduced. New tables in the billing schema: `billing.connected_accounts` (`portal_id` FK →
> `portals.id` from FF-EPIC-09, `stripe_account_id`, `type`, `charges_enabled`/`payouts_enabled`/
> `onboarding_status`) and `billing.tenant_plans` (tenant price-book cache: `portal_id`,
> `stripe_product_id`, `stripe_price_id`, amount, currency). Checkout uses Stripe Checkout Sessions with
> `on_behalf_of` + `transfer_data.destination` + `application_fee_amount` (our cut). The same-origin
> billing proxy (`backend/src/routes/billing.ts`) gains portal context (resolved per FF-EPIC-10) and
> keeps stripping client entity ids before they reach the frontend, unchanged from today's pattern.
> Connected-account webhooks arrive with a `Stripe-Account` header and must route through the existing
> idempotent webhook router in `services/billing-service/` — event ids are already deduplicated there;
> this epic extends that router to be connected-account aware rather than replacing it. Platform-admin
> authority for connected-account management reuses the Permit ReBAC parent→child derivation
> (`backend/src/permit/schema.ts`); a portal's own reseller-admin authority is the existing portal-admin
> Permit role, never a flag. **`deploy-window`**: every story in this epic touches a money path
> (checkout, connected-account webhooks, fee calculation) and must land inside a deploy window per the
> repo hardening convention — no exceptions.

### 📊 Success Metrics
| Metric | Current Baseline | Target |
|--------|-----------------|--------|
| Tenants with an active connected account (`charges_enabled=true`) | 0 | ≥ 1 pilot tenant live |
| Connected-account webhook duplicate-processing rate | N/A (no connected accounts today) | 0% (idempotency verified) |
| Cross-portal billing data leaks (BOLA) found in QA/appsec review | N/A | 0 |
| `fuzefront.billing.reseller-connect` flag OFF regression rate | N/A | 0% (no behavior change with flag OFF) |

### 📋 Child Stories
| Story ID | Summary | Status |
|----------|---------|--------|
| FF-EPIC-15-S1 | connected_accounts + tenant_plans schema + account model | Open |
| FF-EPIC-15-S2 | Connect onboarding (Express Account Links) + status webhooks | Open |
| FF-EPIC-15-S3 | Tenant price book | Open |
| FF-EPIC-15-S4 | On-behalf checkout + connected-account webhooks | Open |
| FF-EPIC-15-S5 | Platform-charges-tenant | Open |
| FF-EPIC-15-S6 | Portal billing pages + proxy portal context | Open |
| FF-EPIC-15-S7 | Feature flag fuzefront.billing.reseller-connect | Open |

### 🔗 Dependencies
- **Blocked By:** FF-EPIC-09 (`portals` table must exist — `connected_accounts.portal_id` is a hard FK to it) and FF-EPIC-10 (portal-context resolution — the billing proxy needs `req.portal` to scope requests).
- **Related:** FF-EPIC-14 (portal-admin billing console embeds the pages/API this epic ships — Connect onboarding entry, price-book link, portal subscription view).
- **Blocks:** none downstream known at authoring time.

### 📎 References
- billing-service: `services/billing-service/`
- Billing proxy: `backend/src/routes/billing.ts`
- Permit ReBAC parent→child derivation: `backend/src/permit/schema.ts`
- Portal schema precedent (`portal_id` FK target): FF-EPIC-09 — `docs/planning/epics/EPIC-09-portal-core.md`

---

## Stories

### 📖 Story: Platform can model a tenant's connected Stripe account and price book

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-15-S1 |
| **Parent Epic** | FF-EPIC-15 — Reseller Billing (Stripe Connect) |
| **Priority** | High |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 12 (8 BE + 4 QA) |
| **Tech Layers** | Backend |

#### 🧑‍💼 User Story
> As the **platform**, I want to **persist each tenant's Stripe connected account and their cached price
> book** so that **every later checkout, onboarding, and billing view has a single source of truth to
> read from**.

#### 📌 Background & Context
No Connect data model exists today — billing tables assume a single platform Stripe account. This story
lays the schema foundation every other story in this epic builds on: `billing.connected_accounts` (one
row per portal) and `billing.tenant_plans` (the tenant's own price book, cached from Stripe).

#### ✅ Acceptance Criteria
1. **Given** a portal has no connected account yet **When** the repository is queried for that portal **Then** it returns "no account" rather than throwing, and no row exists in `connected_accounts`.
2. **Given** a connected-account row is inserted for a portal **When** a second insert is attempted for the same `portal_id` **Then** the unique constraint on `portal_id` rejects it (one connected account per portal).
3. **Edge case:** **Given** the migration runs against a database that already has legacy billing tables **When** it executes **Then** it is idempotent — re-running it is a no-op and does not error or duplicate columns.
4. **Error case:** **Given** an attempt to insert a `tenant_plans` row for a `portal_id` that has no `connected_accounts` row **When** the insert runs **Then** the FK constraint rejects it (a price book cannot exist without a connected account).

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] Unit tests written and passing (coverage ≥ 80%)
- [ ] Migration verified idempotent on fresh + legacy DB
- [ ] Repository methods documented (JSDoc/README) for the next stories to consume
- [ ] PM verified all Acceptance Criteria on staging
- [ ] Deployed to staging and smoke-tested inside a deploy window

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| Backend | Billing migrations: `connected_accounts` (portal_id unique FK, stripe_account_id, type, onboarding/charges/payouts status) + `tenant_plans` (portal_id FK, stripe_product_id, stripe_price_id, amount, currency); repositories | 8 | Open |
| QA | Schema + repository unit test (constraints, idempotent migration, FK rejection) | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-09 (`portals` table must exist for the `portal_id` FK target).

#### ⚠️ Risks & Assumptions
- **Assumption:** `portals.id` is a stable, already-migrated primary key by the time this runs (FF-EPIC-09 merged first).
- **Risk:** Schema drift between `billing-service`'s own DB and the monolith's — mitigate by keeping the migration inside `billing-service`'s existing migration path, not a new one.

#### 📎 References
- billing-service migrations: `services/billing-service/`
- Portal schema: FF-EPIC-09 — `docs/planning/epics/EPIC-09-portal-core.md`

---

### 📖 Story: Tenant reseller can onboard a Stripe connected account

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-15-S2 |
| **Parent Epic** | FF-EPIC-15 — Reseller Billing (Stripe Connect) |
| **Priority** | High |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 16 (8 BE + 4 FE + 4 QA) |
| **Tech Layers** | Full-Stack |

#### 🧑‍💼 User Story
> As a **Tenant Reseller**, I want to **onboard my own Stripe connected account through a hosted
> onboarding flow** so that **I can start collecting payouts from my customers without FuzeFront ever
> holding my banking details**.

#### 📌 Background & Context
Stripe Express accounts are the correct Connect type for a reseller who wants hosted onboarding and
Stripe-managed compliance/payouts. This story creates the connected account and an Account Link, and
listens for `account.updated` to flip `charges_enabled`/`payouts_enabled` once Stripe finishes
verification.

#### ✅ Acceptance Criteria
1. **Given** a Tenant Reseller with no connected account **When** they start onboarding **Then** a Stripe Express connected account is created, a `connected_accounts` row is inserted with `onboarding_status=pending`, and they are redirected to a fresh Account Link.
2. **Given** Stripe finishes verifying the account **When** the `account.updated` webhook fires **Then** `charges_enabled`/`payouts_enabled` are updated on the `connected_accounts` row to match Stripe's values.
3. **Edge case:** **Given** the Account Link expires before the reseller completes onboarding **When** they return to the onboarding entry **Then** a fresh Account Link is generated automatically (no dead-end, no manual support ticket).
4. **Error case:** **Given** a reseller's Account Link return lands with Stripe reporting outstanding requirements **When** the return page renders **Then** the UI shows exactly which requirements are outstanding and offers a "continue onboarding" action rather than a generic error.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] Unit tests written and passing (coverage ≥ 80%)
- [ ] Functional tests passing on staging (real Stripe test-mode Express account)
- [ ] Onboarding + status endpoints documented in the billing OpenAPI spec
- [ ] Deployed inside a deploy window and smoke-tested
- [ ] PM verified all Acceptance Criteria on staging

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| Backend | Create connected account (Express) + Account Link; `account.updated` webhook updates `charges_enabled`/`payouts_enabled`/`onboarding_status` | 8 | Open |
| Frontend | Onboarding entry button + return/refresh handling (outstanding-requirements state) | 4 | Open |
| QA | Onboarding flow test (create → redirect → return) + webhook state-transition test | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-15-S1 (connected_accounts schema).

#### ⚠️ Risks & Assumptions
- **Assumption:** The platform's Stripe account has Connect enabled in test and live mode.
- **Risk:** Account Link URLs are single-use and short-lived — mitigate with the auto-refresh path covered by AC3.

#### 📎 References
- Stripe Connect Express onboarding + Account Links. billing-service: `services/billing-service/`.

---

### 📖 Story: Tenant reseller can define their own price book

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-15-S3 |
| **Parent Epic** | FF-EPIC-15 — Reseller Billing (Stripe Connect) |
| **Priority** | High |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 16 (8 BE + 4 FE + 4 QA) |
| **Tech Layers** | Full-Stack |

#### 🧑‍💼 User Story
> As a **Tenant Reseller**, I want to **create and edit my own products and prices** so that **I can
> charge my customers whatever I decide, independent of FuzeFront's own plan pricing**.

#### 📌 Background & Context
Prices must be created directly on the tenant's connected account (not the platform account) so that
Stripe correctly attributes revenue and payouts. This story creates products/prices on the connected
account via the Stripe `Stripe-Account` header and caches the resulting ids into `tenant_plans` so
checkout (S4) doesn't need a live Stripe round-trip per request.

#### ✅ Acceptance Criteria
1. **Given** an onboarded Tenant Reseller (`charges_enabled=true`) **When** they create a new price **Then** a product+price is created on their connected account and a corresponding `tenant_plans` row is cached with the returned Stripe ids.
2. **Given** a reseller edits an existing price's amount **When** they save **Then** a new Stripe price is created (Stripe prices are immutable) and `tenant_plans` is updated to point at the new price id, leaving the old price inactive rather than deleted.
3. **Edge case:** **Given** a reseller has not completed onboarding (`charges_enabled=false`) **When** they attempt to create a price **Then** the UI blocks the action with a clear "finish onboarding first" message and no Stripe call is made.
4. **Error case:** **Given** a request to create a price under a `portal_id` that does not belong to the requesting reseller's own portal **When** the request is made **Then** the endpoint returns 403 (BOLA-authorized) and no product/price is created on any Stripe account.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] Unit tests written and passing (coverage ≥ 80%)
- [ ] Functional tests passing on staging
- [ ] Price-book endpoints documented in the billing OpenAPI spec
- [ ] BOLA/authorization verified (appsec-reviewer pass)
- [ ] PM verified all Acceptance Criteria on staging

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| Backend | Create products/prices on the connected account (`Stripe-Account` header); tenant sets price; cache ids to `tenant_plans` | 8 | Open |
| Frontend | Price-book management UI (create/edit price, onboarding-gate state) | 4 | Open |
| QA | Price-book CRUD test + cross-portal isolation (BOLA) test | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-15-S2 (a connected account with `charges_enabled=true` must exist first).

#### ⚠️ Risks & Assumptions
- **Assumption:** Stripe prices are immutable — confirmed Stripe API behavior, drives AC2's create-new-price-on-edit design.
- **Risk:** Divergence between the live Stripe price and the `tenant_plans` cache if a webhook is missed — mitigate with a periodic reconcile job (tracked as a follow-up, not blocking this story).

#### 📎 References
- Stripe Products/Prices API (connected account). billing-service: `services/billing-service/`.

---

### 📖 Story: Customer checks out against the reseller's price with our cut applied automatically

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-15-S4 |
| **Parent Epic** | FF-EPIC-15 — Reseller Billing (Stripe Connect) |
| **Priority** | High |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 12 (8 BE + 4 QA) |
| **Tech Layers** | Backend |

#### 🧑‍💼 User Story
> As a **Portal End-User**, I want to **check out against my reseller's price** so that **I pay the
> reseller directly while the platform automatically takes its agreed cut, with no manual reconciliation
> for anyone**.

#### 📌 Background & Context
This is the money-critical core of the epic: a Stripe Checkout Session with `on_behalf_of` +
`transfer_data.destination` (the reseller's connected account) + `application_fee_amount` (our cut).
Connected-account webhooks arrive `Stripe-Account`-scoped and must be routed through the existing
idempotent webhook router without double-processing — a duplicate delivery here means a duplicate
charge or a duplicate application-fee credit, both of which are real-money bugs.

#### ✅ Acceptance Criteria
1. **Given** a Portal End-User checking out against a `tenant_plans` price **When** the Checkout Session is created **Then** it is created with `on_behalf_of` and `transfer_data.destination` set to the reseller's connected account, and `application_fee_amount` computed from the configured platform fee percentage/flat amount.
2. **Given** a successful checkout **When** the connected-account `checkout.session.completed` webhook arrives **Then** it is routed correctly by `Stripe-Account` header through the idempotent webhook router and the order is fulfilled exactly once.
3. **Edge case (fee math):** **Given** a price of an odd amount (e.g. $9.99) and a percentage-based fee **When** the application fee is computed **Then** rounding is deterministic and documented (round-half-up to the cent) so the reseller's payout + our fee always sum exactly to the charged amount — no missing or extra cents.
4. **Error case (webhook idempotency + BOLA):** **Given** Stripe redelivers the same connected-account webhook event id **When** it is processed a second time **Then** it is a no-op (deduplicated by event id, connected-account scoped); **and given** a checkout request references a `tenant_plans` price belonging to a different portal than the requester's resolved portal context, **when** the request is made, **then** it is rejected 403 (BOLA) before any Stripe call is made.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] Unit tests written and passing (coverage ≥ 80%), including fee-math edge cases
- [ ] Functional tests passing on staging with Stripe test-mode connected accounts
- [ ] Checkout + webhook endpoints documented in the billing OpenAPI spec
- [ ] BOLA/authorization verified (appsec-reviewer pass) — fail-closed confirmed
- [ ] Webhook idempotency verified under simulated redelivery
- [ ] Deployed inside a deploy window and smoke-tested
- [ ] PM verified all Acceptance Criteria on staging

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| Backend | Checkout Session `on_behalf_of` + `transfer_data.destination` + `application_fee_amount`; route `Stripe-Account` webhooks through the existing idempotent webhook router | 8 | Open |
| QA | Fee-math edge-case test + connected-account webhook idempotency (redelivery) test + BOLA 403 test | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-15-S3 (a cached `tenant_plans` price must exist to check out against).

#### ⚠️ Risks & Assumptions
- **Assumption:** The existing webhook router's event-id deduplication generalizes cleanly to connected-account events once it is made `Stripe-Account`-aware — verified as part of this story, not assumed post-hoc.
- **Risk:** Incorrect fee rounding is a real-money defect that would only surface at scale — mitigated by the explicit fee-math edge-case test in AC3/DoD, not left to manual QA.

#### 📎 References
- Stripe Connect destination charges + application fees. Webhook router + billing proxy: `services/billing-service/`, `backend/src/routes/billing.ts`.

---

### 📖 Story: Platform charges the tenant portal for FuzeFront's own plan

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-15-S5 |
| **Parent Epic** | FF-EPIC-15 — Reseller Billing (Stripe Connect) |
| **Priority** | High |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 8 (4 BE + 4 QA) |
| **Tech Layers** | Backend |

#### 🧑‍💼 User Story
> As the **platform**, I want to **charge the tenant portal for its own FuzeFront subscription tier,
> independent of what that tenant charges their own customers** so that **our platform revenue and the
> tenant's reseller revenue never get conflated in the same money path**.

#### 📌 Background & Context
This is the "us billing them" side, distinct from S4's "them billing their customers" side. The portal
org (already an org in the existing single-account billing model) subscribes to a FuzeFront plan tier
that gates platform limits (e.g. catalog size, seats), reusing the pre-existing single-account
subscription flow rather than Connect.

#### ✅ Acceptance Criteria
1. **Given** a newly provisioned portal org **When** it has no FuzeFront subscription yet **Then** it defaults to the platform's base/free tier with the corresponding limits enforced.
2. **Given** a portal admin upgrades their platform plan tier **When** the subscription is created on the platform's own Stripe account (not the tenant's connected account) **Then** the portal's `tenant_plans`-independent tier gates (e.g. catalog size limits) update accordingly.
3. **Edge case:** **Given** a portal is mid-downgrade and currently over the new tier's limits (e.g. too many catalog entries) **When** the downgrade is requested **Then** it is either blocked with a clear "reduce usage first" message or scheduled for the next billing period per the platform's existing downgrade policy — never silently applied while over-limit.
4. **Error case:** **Given** a platform-charge request for a portal the requester does not administer **When** the request is made **Then** it returns 403 (BOLA-authorized), consistent with the existing single-account billing proxy's authorization pattern.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] Unit tests written and passing (coverage ≥ 80%)
- [ ] Functional tests passing on staging
- [ ] Tier-gate enforcement documented (which limits each tier controls)
- [ ] BOLA/authorization verified (appsec-reviewer pass)
- [ ] Deployed inside a deploy window and smoke-tested
- [ ] PM verified all Acceptance Criteria on staging

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| Backend | Portal org subscribes to FuzeFront's own plans (platform Stripe account, not Connect); per-portal plan tier gates platform limits | 4 | Open |
| QA | Platform-charge flow test + tier-gate enforcement test (over-limit downgrade path) | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-15-S1 (schema); reuses the existing single-account billing proxy pattern (`backend/src/routes/billing.ts`), not Connect.
- **Related:** FF-EPIC-01 (Billing/Payments UX overhaul) established the existing plan-card + subscription UX this reuses.

#### ⚠️ Risks & Assumptions
- **Assumption:** The existing single-account subscribe flow (from FF-EPIC-01) is portal-context-aware enough to attach to a portal org rather than a generic org — verified, not assumed, as part of implementation.
- **Risk:** Confusing UX if platform-tier billing and tenant reseller billing are shown on the same screen without clear separation — mitigated in S6's portal billing pages, which must visually separate the two.

#### 📎 References
- Existing single-account billing proxy: `backend/src/routes/billing.ts`. Plan-card precedent: FF-EPIC-01 — `docs/planning/epics/EPIC-01-billing-payments-ux.md`.

---

### 📖 Story: Portal admin can view and manage their customers' billing

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-15-S6 |
| **Parent Epic** | FF-EPIC-15 — Reseller Billing (Stripe Connect) |
| **Priority** | High |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 12 (8 FE + 4 QA) |
| **Tech Layers** | Full-Stack |

#### 🧑‍💼 User Story
> As a **Tenant Reseller**, I want to **see my own customers' subscriptions and invoices from within my
> portal-admin console** so that **I can support my customers without contacting FuzeFront and without
> ever seeing another portal's billing data**.

#### 📌 Background & Context
This story extends the same-origin billing proxy (`backend/src/routes/billing.ts`) with portal context
(resolved per FF-EPIC-10) so that a portal admin's requests are automatically scoped to their own
connected account's customers, while the proxy keeps stripping client entity ids exactly as it does
today for single-account billing.

#### ✅ Acceptance Criteria
1. **Given** an authenticated portal admin (Tenant Reseller) **When** they open their portal's billing page **Then** they see only their own customers' subscriptions and invoices, sourced from their connected account.
2. **Given** the reseller has not finished Connect onboarding **When** they open the billing page **Then** a "finish onboarding" state is shown instead of an empty/broken table.
3. **Edge case:** **Given** a reseller with zero customer subscriptions yet **When** the page loads **Then** an explicit empty state is shown ("no customers yet"), not a blank page.
4. **Error case:** **Given** a request for another portal's customer billing data (portal A admin requesting portal B's data) **When** the request is made **Then** the proxy returns 403 (BOLA-authorized) and no cross-portal data is ever returned — verified explicitly, not assumed from existing single-account behavior.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] RTL unit tests (a11y + states) passing, coverage ≥ 80%
- [ ] `gate-ds-conformance` green — no raw hex/spacing/type
- [ ] BOLA/authorization verified (appsec-reviewer pass) — explicit cross-portal test, not inferred
- [ ] Deployed inside a deploy window and smoke-tested
- [ ] PM verified all Acceptance Criteria on staging

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| Frontend | Portal-admin billing pages (their customers' subscriptions/invoices), onboarding-gate + empty states | 8 | Open |
| QA | Portal-scoped billing RTL test + proxy portal-context strip/BOLA test | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-15-S2 (onboarded connected account), FF-EPIC-10 (portal context resolution the proxy relies on).
- **Related:** FF-EPIC-14 (this page is embedded in the portal-admin console shell).

#### ⚠️ Risks & Assumptions
- **Assumption:** The FF-EPIC-10 portal-context resolver is merged and available to the billing proxy by the time this story starts.
- **Risk:** Reusing the single-account billing proxy pattern without careful portal-context scoping could leak cross-portal data — mitigated by the explicit AC4 BOLA test, not left implicit.

#### 📎 References
- Billing proxy: `backend/src/routes/billing.ts`. Portal context: FF-EPIC-10 — `docs/planning/epics/EPIC-10-portal-context-resolution.md`.

---

### 📖 Story: Reseller Connect billing ships behind a default-OFF feature flag

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-15-S7 |
| **Parent Epic** | FF-EPIC-15 — Reseller Billing (Stripe Connect) |
| **Priority** | High |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 4 (2 BE + 2 QA) |
| **Tech Layers** | Backend |

#### 🧑‍💼 User Story
> As the **platform**, I want to **gate the entire reseller-billing capability behind
> `fuzefront.billing.reseller-connect`, default OFF** so that **it can be rolled out tenant-by-tenant
> without risking the existing single-account billing path**.

#### 📌 Background & Context
Per the repo's feature-flag standard, all new/risky work (and this touches money paths directly) must
ship wrapped in a flag, default OFF, gating both server logic and UI, tested in both states. This story
wires the flag; it does not add new business logic.

#### ✅ Acceptance Criteria
1. **Given** the flag is OFF **When** any reseller-billing endpoint (onboarding, price book, on-behalf checkout, portal billing pages) is reached **Then** it behaves exactly as it did before this epic — no Connect code path is exercised.
2. **Given** the flag is ON for a specific portal **When** that portal's admin accesses reseller-billing features **Then** the full Connect flow (S1–S6) is available to them.
3. **Edge case:** **Given** the flag is toggled ON mid-onboarding for a portal that already has a connected account from manual testing **When** the flag flips **Then** existing `connected_accounts`/`tenant_plans` rows are picked up correctly rather than re-provisioned.
4. **Error case:** **Given** the flag evaluation itself fails (Unleash unreachable) **When** any reseller-billing endpoint is reached **Then** it fails closed to OFF (existing single-account behavior), never fails open into an unreviewed money path.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] Unit tests written and passing for both flag states
- [ ] Flag registered in Unleash under the `fuzefront.billing.*` taxonomy with an owner + removal criterion
- [ ] Verified fail-closed behavior on flag-evaluation failure
- [ ] Deployed inside a deploy window and smoke-tested
- [ ] PM verified all Acceptance Criteria on staging

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| Backend | Flag wiring (server + client), default OFF, gates all reseller-billing endpoints | 2 | Open |
| QA | Both-states test (OFF = unchanged single-account behavior; ON = full Connect flow) + fail-closed-on-eval-failure test | 2 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-15-S1 through S6 (the flag gates the whole epic's surface area).

#### ⚠️ Risks & Assumptions
- **Assumption:** `@fuzefront/feature-flags` (OpenFeature + Unleash client) is already wired into `billing-service` / the monolith from prior flag work.
- **Risk:** A partially-flagged rollout (server gated, UI not) would show reseller UI with no working backend — mitigated by DoD requiring both server and UI gated together.

#### 📎 References
- Feature-flags skill: `.claude/skills/feature-flags/`. Unleash taxonomy: `fuzefront.billing.reseller-connect`.
