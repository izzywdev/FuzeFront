---
key: FF-EPIC-01
title: Billing / Payments UX overhaul (industry plan cards + invoices + payments/Stripe-portal)
label: [fuzefront, billing, design-system-first, paginated]
github: https://github.com/izzywdev/FuzeFront/issues/119
status: ready
priority: High
domain: Billing
---

## 🎯 Epic: Billing / Payments UX overhaul

| Field | Value |
|-------|-------|
| **Epic ID** | FF-EPIC-01 |
| **Domain** | Billing |
| **Priority** | High |
| **Owner** | Orchestrator (delegated to `billing-payments-engineer` + `frontend-engineer`) |
| **Target Release** | Next deploy window |
| **Effort Estimate** | L |
| **GitHub** | [#119](https://github.com/izzywdev/FuzeFront/issues/119) |

---

### 📌 Problem Statement
> The `$9` subscribe + checkout flow works end-to-end, but the billing UX is sub-par: plan boxes are
> rendered as bare boxes rather than industry-standard pricing cards, and the everyday billing views
> (invoices, payment methods, payment history) are missing entirely. Customers cannot self-serve
> invoice retrieval or payment-method management, which drives avoidable support load and erodes trust
> in a money-handling surface.

### 🎯 Goal
> A customer can browse industry-standard plan cards, view their invoices, and manage payment methods
> via the Stripe Customer Portal — all from a `Plans / Invoices / Payments` Billing area in the shell.

### 👥 Target Personas
- **Org Admin** — manages their organization's subscription, invoices, and payment method.
- **Finance/Billing contact** — needs to download invoices and verify payment history.

### ✅ Features In Scope
- [ ] Feature 1: Industry-standard pricing-card grid on `/billing` (tier, price+interval, feature bullets, recommended tier, current-plan state, CTA, loading/empty/error states, responsive).
- [ ] Feature 2: Invoices view + org-scoped `GET /api/v1/billing/invoices` (Stripe `invoices.list`, paginated, BOLA-authorized).
- [ ] Feature 3: Payments view (card on file brand/last4/exp + history) + `POST /api/v1/billing/portal` returning a Stripe Customer Portal session URL.
- [ ] Feature 4: Billing nav tabs (Plans / Invoices / Payments) wired into the shell.

### 🚫 Out of Scope
- Storing or handling raw PCI card data — delegated entirely to the Stripe Customer Portal.
- New pricing/plan definitions or price changes — this is a UX overhaul of the existing plan set.
- Tax/VAT handling and dunning emails — separate epic if needed.

### 🏗️ High-Level Architecture Notes
> Reuse the existing billing proxy pattern (`backend/src/routes/billing.ts`) → billing-service → Stripe.
> Same-origin API base (no absolute host). New endpoints `GET /billing/invoices` (paginated per
> `gate-pagination`) and `POST /billing/portal` (`billingPortal.sessions.create`). All routes
> org-scoped + BOLA-authorized like the existing billing routes. UI extends `@fuzefront/design-system`
> ("fuse seam") — no raw hex/spacing/type; add a `PricingCard` primitive to the DS if missing.

### 📊 Success Metrics
| Metric | Current Baseline | Target |
|--------|-----------------|--------|
| Billing-related support tickets / week | [Establish baseline in Sprint 1] | −50% |
| Self-serve invoice retrieval available | No | Yes (100% of paid orgs) |
| `gate-pagination` + `gate-ds-conformance` on billing UI | Failing/new | Green |

### 📋 Child Stories
| Story ID | Summary | Status |
|----------|---------|--------|
| FF-EPIC-01-S1 | Industry-standard plan cards on /billing | Open |
| FF-EPIC-01-S2 | Invoices view + GET /billing/invoices endpoint | Open |
| FF-EPIC-01-S3 | Payments view + Stripe Customer Portal session endpoint | Open |
| FF-EPIC-01-S4 | Billing nav tabs (Plans / Invoices / Payments) | Open |

### 🔗 Dependencies
- **Blocked By:** FF-EPIC-08 (`gate-pagination` must be defined so the list endpoint conforms).
- **Related:** Existing billing-service + `services/billing-service/openapi.yaml` (the `GET /subscriptions` pagination gap flagged in #108).

### 📎 References
- GitHub issue: https://github.com/izzywdev/FuzeFront/issues/119
- Existing billing proxy: `backend/src/routes/billing.ts`; billing page `frontend/src/pages/BillingPage.tsx`

---

## Stories

### 📖 Story: Customer can compare plans on industry-standard pricing cards

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-01-S1 |
| **Parent Epic** | FF-EPIC-01 — Billing / Payments UX overhaul |
| **Priority** | High |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 16 (8 FE + 4 UX + 4 QA) |
| **Tech Layers** | Frontend + Design System |

#### 🧑‍💼 User Story
> As an **Org Admin**, I want to **compare available plans on clear, industry-standard pricing cards**
> so that **I can confidently choose or change my organization's plan without contacting support**.

#### 📌 Background & Context
The current `/billing` page renders bare plan boxes. This story replaces them with a proper pricing-card
grid sourced from the existing plan data, design-system-first (extend `@fuzefront/design-system`).

#### ✅ Acceptance Criteria
1. **Given** an authenticated Org Admin on `/billing` **When** the plans load **Then** each plan renders as a card with tier name, price + interval, feature bullets, and a clear CTA.
2. **Given** the org is on a plan **When** the cards render **Then** that plan shows a "Current plan" state and the recommended tier is visually highlighted.
3. **Edge case:** **Given** plans are still loading **When** the page renders **Then** loading skeletons are shown (no layout shift); on a narrow viewport the grid reflows responsively to a single column.
4. **Error case:** **Given** the plans request fails **When** the page renders **Then** an inline error state with a retry action is shown — never a blank page.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] RTL unit tests (a11y + states) passing, coverage ≥ 80%
- [ ] `gate-ds-conformance` green — no raw hex/spacing/type; `PricingCard` primitive lives in the DS
- [ ] Responsive verified at mobile/tablet/desktop breakpoints
- [ ] Matches approved UI frame / DS spec — designer sign-off
- [ ] PM verified all AC on staging

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| UX Task | Design `PricingCard` primitive + grid layout against fuse-seam tokens | 4 | Open |
| Frontend | Build pricing-card grid in `BillingPage.tsx` with all states | 8 | Open |
| QA | RTL a11y + loading/empty/error/current-plan state tests | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-08 (DS-conformance gate).

#### ⚠️ Risks & Assumptions
- **Assumption:** Plan data (tiers, prices, features) is already available from the billing-service.
- **Risk:** Missing DS primitive → mitigate by adding `PricingCard` to the base DS, not one-off styling.

#### 📎 References
- API: existing plan listing via billing proxy. UI: `frontend/src/pages/BillingPage.tsx`.

---

### 📖 Story: Customer can view and download their invoices

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-01-S2 |
| **Parent Epic** | FF-EPIC-01 — Billing / Payments UX overhaul |
| **Priority** | High |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 20 (8 BE + 8 FE + 4 QA) |
| **Tech Layers** | Full-Stack |

#### 🧑‍💼 User Story
> As an **Org Admin**, I want to **see a list of my organization's invoices with date, amount, status,
> and a download link** so that **I can retrieve billing records myself for accounting and reconciliation**.

#### 📌 Background & Context
No invoices view exists today. This adds an org-scoped, paginated, BOLA-authorized `GET /billing/invoices`
that proxies to the billing-service → Stripe `invoices.list`, plus the UI to render it.

#### ✅ Acceptance Criteria
1. **Given** an authenticated Org Admin **When** they open the Invoices tab **Then** their org's invoices list with date, amount, status (paid/open/void), and a hosted-invoice/download link.
2. **Given** more invoices than one page **When** they request the next page **Then** results paginate per the `gate-pagination` standard (cursor-based), without duplicate rows.
3. **Edge case:** **Given** an org with no invoices **When** they open the tab **Then** an empty state explaining "no invoices yet" is shown.
4. **Error case:** **Given** a user requests invoices for an org they do not belong to **When** the request is made **Then** the endpoint returns 403 (BOLA-authorized) and the UI shows access-denied — never another org's data.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] Backend unit + RTL UI tests passing, coverage ≥ 80%
- [ ] `gate-pagination` green on `GET /billing/invoices`
- [ ] Endpoint documented in the billing OpenAPI spec
- [ ] BOLA/authorization verified (appsec-reviewer pass)
- [ ] PM verified all AC on staging

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| Backend | Add org-scoped paginated `GET /api/v1/billing/invoices` proxy → Stripe `invoices.list` | 8 | Open |
| Frontend | Invoices table UI with status badges + download links + pagination + empty/error states | 8 | Open |
| QA | API contract test (pagination + BOLA 403) + RTL UI states | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-08 (pagination standard).

#### ⚠️ Risks & Assumptions
- **Assumption:** The entity↔Stripe customer mapping already exists (used by the subscribe flow).
- **Risk:** Stripe rate limits on `invoices.list` → mitigate with sane page sizes + caching if needed.

#### 📎 References
- Proxy pattern: `backend/src/routes/billing.ts`. Spec: `services/billing-service/openapi.yaml`.

---

### 📖 Story: Customer can manage payment methods via the Stripe Customer Portal

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-01-S3 |
| **Parent Epic** | FF-EPIC-01 — Billing / Payments UX overhaul |
| **Priority** | High |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 16 (8 BE + 4 FE + 4 QA) |
| **Tech Layers** | Full-Stack |

#### 🧑‍💼 User Story
> As an **Org Admin**, I want to **see my card on file and payment history and click "Manage billing"
> to open the Stripe Customer Portal** so that **I can update my payment method without the platform
> ever handling raw card data**.

#### 📌 Background & Context
Industry standard for payment-method management without PCI scope is the Stripe Billing Customer Portal.
This adds `POST /api/v1/billing/portal` (`billingPortal.sessions.create`) returning the portal URL plus
a Payments view summarizing the card on file and history.

#### ✅ Acceptance Criteria
1. **Given** an authenticated Org Admin on the Payments tab **When** the view loads **Then** the card on file (brand/last4/exp) and payment history are shown.
2. **Given** the Org Admin clicks "Manage billing" **When** the request succeeds **Then** they are redirected to a freshly created Stripe Customer Portal session URL scoped to their org's customer.
3. **Edge case:** **Given** an org with no payment method yet **When** the view loads **Then** a "no card on file" state with an add-payment-method CTA (portal) is shown.
4. **Error case:** **Given** a portal-session request for another org's customer **When** the request is made **Then** the endpoint returns 403 (BOLA-authorized) and no portal URL is issued.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] Backend unit + RTL UI tests passing, coverage ≥ 80%
- [ ] Portal endpoint documented in the billing OpenAPI spec
- [ ] No raw card data touches FuzeFront (verified) — portal-only
- [ ] BOLA/authorization verified (appsec-reviewer pass)
- [ ] PM verified all AC on staging

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| Backend | Add org-scoped `POST /api/v1/billing/portal` → `billingPortal.sessions.create` | 8 | Open |
| Frontend | Payments view (card on file + history) + "Manage billing" button + states | 4 | Open |
| QA | API contract test (BOLA 403, valid session URL) + RTL UI states | 4 | Open |

#### 🔗 Dependencies
- **Related:** FF-EPIC-01-S2 (shares the billing proxy + customer mapping).

#### ⚠️ Risks & Assumptions
- **Assumption:** A Stripe Billing Portal configuration exists (or can be created) for the account.
- **Risk:** Return-URL mismatch under TLS/ingress → use same-origin return URL, never a hard-coded host.

#### 📎 References
- Stripe Billing Customer Portal. Proxy: `backend/src/routes/billing.ts`.

---

### 📖 Story: Customer can navigate Billing via Plans / Invoices / Payments tabs

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-01-S4 |
| **Parent Epic** | FF-EPIC-01 — Billing / Payments UX overhaul |
| **Priority** | Medium |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 8 (4 FE + 4 QA) |
| **Tech Layers** | Frontend |

#### 🧑‍💼 User Story
> As an **Org Admin**, I want to **switch between Plans, Invoices, and Payments using clear tabs in the
> Billing area** so that **I can find the billing function I need quickly**.

#### 📌 Background & Context
Ties the three views together into a coherent Billing area in the shell nav, design-system-first.

#### ✅ Acceptance Criteria
1. **Given** an authenticated Org Admin **When** they open the Billing area **Then** Plans / Invoices / Payments tabs are visible and the active tab is indicated.
2. **Given** the user selects a tab **When** the route changes **Then** the corresponding view renders and the URL reflects the active tab (deep-linkable).
3. **Edge case:** **Given** a direct deep link to `/billing/invoices` **When** loaded **Then** the Invoices tab is pre-selected.
4. **Error case:** **Given** an unknown billing sub-route **When** loaded **Then** the user is redirected to the default Plans tab (no 404 dead-end).

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] RTL tests for tab switching + deep-link + keyboard a11y passing
- [ ] `gate-ds-conformance` green (tabs use DS `Tabs` primitive)
- [ ] PM verified all AC on staging

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| Frontend | Billing tab nav + routing (deep-linkable, DS Tabs primitive) | 4 | Open |
| QA | RTL tab-switch + deep-link + a11y tests | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** S1, S2, S3 (the three views the tabs host).

#### ⚠️ Risks & Assumptions
- **Assumption:** A DS `Tabs` primitive exists or will be added to `@fuzefront/design-system`.
- **Risk:** Routing collision with existing `/billing` route → reserve `/billing/:tab` namespace.

#### 📎 References
- Shell nav + `frontend/src/pages/BillingPage.tsx`.
