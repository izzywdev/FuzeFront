---
key: FF-EPIC-14
title: Admin Consoles UI (master-admin + portal-admin)
label: [fuzefront, design-system-first, platform, permit-gated, needs-jira-upload]
github: TBD
status: ready
priority: High
domain: Frontend / Platform
---

## 🎯 Epic: Admin Consoles UI (master-admin + portal-admin)

| Field | Value |
|-------|-------|
| **Epic ID** | FF-EPIC-14 |
| **Domain** | Frontend / Platform |
| **Priority** | High |
| **Owner** | Orchestrator (delegated to `product-designer` + `frontend-engineer`) |
| **Target Release** | Next deploy window |
| **Effort Estimate** | L |
| **GitHub** | TBD |

---

### 📌 Problem Statement
> There is no UI to create or manage portals, curate a portal's app catalog, or manage a portal's
> users or billing — the master-admin and portal-admin capabilities delivered by FF-EPIC-09
> (provisioning), FF-EPIC-11 (scoped identity), FF-EPIC-12 (app catalog), and FF-EPIC-15 (reseller
> billing) have no front door. Every one of those capabilities is currently only reachable via a raw
> API call or a DB script — exactly the "backend with no UI" gap the design-first pipeline exists to
> catch.

### 🎯 Goal
> A Master Admin manages portals (create/suspend/domains) from a console; a Portal Admin manages
> their portal's users, app catalog, and billing from a portal-scoped console — all design-system-
> first and Permit-gated by role.

**DESIGN-FIRST:** per the FuzeFront design-first gate, `product-designer` authors the frames (S1) as
a frames-ONLY PR before any implementation story starts.

### 👥 Target Personas
- **Master Admin** — root FuzeFront staff; manages the fleet of portals.
- **Portal Admin** — tenant owner/admin; manages their own portal's users, catalog, and billing.
- **Tenant Reseller** — a Portal Admin billing their own customers; consumes the billing console (S4).

### ✅ Features In Scope
- [ ] Feature 1: Designer frames for the master-admin and portal-admin consoles, covering all states
      (`design/frames/portal-admin-consoles/**`).
- [ ] Feature 2: Master-admin portal-management console — list/create/suspend/resume portals + domain
      status view.
- [ ] Feature 3: Portal-admin users + app-catalog console — portal-scoped user management and
      app-catalog curation.
- [ ] Feature 4: Portal-admin billing console — Connect onboarding entry, price-book link, portal
      subscription view.

### 🚫 Out of Scope
- The underlying APIs themselves (FF-EPIC-09 portal CRUD, FF-EPIC-11 scoped identity, FF-EPIC-12
  catalog admin, FF-EPIC-15 reseller billing) — this epic is UI-only, consuming frozen contracts.
- Custom-domain add/verify UI (self-service domain management) — FF-EPIC-16; this epic's domain
  status view (S2) is read-only.
- A console to edit portal **branding** (name/logo/accent) — anticipated as a future addition to this
  console family but not decomposed into a story here; FF-EPIC-13 only renders branding today.

### 🏗️ High-Level Architecture Notes
> Consumes the master-admin portal CRUD API (FF-EPIC-09-S3), the portal-scoped invitations +
> membership surface (FF-EPIC-11-S3), the catalog admin API (FF-EPIC-12-S3), and the Connect
> onboarding / price-book / platform-charges-tenant surfaces (FF-EPIC-15-S2/S3/S5). All routes are
> Permit-gated — platform-admin authority is the existing Permit ReBAC parent→child org-admin
> derivation (`backend/src/permit/schema.ts`); a Portal Admin's console is scoped to their own portal
> only. All UI extends `@fuzefront/design-system` ("fuse seam") — no raw hex/spacing/type — and is
> gated by the `ui-runtime-validation` skill (console-clean) before being reported done.

### 📊 Success Metrics
| Metric | Current Baseline | Target |
|--------|-----------------|--------|
| Master-admin actions requiring a DB script or support ticket | High/unknown (no UI exists) | 0 |
| `gate-ds-conformance` on the admin console UI | Failing/new | Green |
| Non-admin users able to reach admin console routes (authz leakage) | Unknown | 0 (verified by RTL authz-hidden tests) |

### 📋 Child Stories
| Story ID | Summary | Status |
|----------|---------|--------|
| FF-EPIC-14-S1 | Designer frames: master-admin + portal-admin consoles (all states) | Open |
| FF-EPIC-14-S2 | Master-admin portal console | Open |
| FF-EPIC-14-S3 | Portal-admin users + app-catalog console | Open |
| FF-EPIC-14-S4 | Portal-admin billing console | Open |

### 🔗 Dependencies
- **Blocked By:** FF-EPIC-09-S3 (master-admin portal CRUD API, for S2); FF-EPIC-11-S3 (portal-scoped
  invitations + membership API, for S3); FF-EPIC-12-S3 (catalog admin API, for S3); FF-EPIC-15-S2/S3/S5
  (Connect onboarding, price book, platform-charges-tenant, for S4).
- **Related:** FF-EPIC-13 (this epic is the eventual "edit" counterpart to FF-EPIC-13's "render" of
  portal branding, though branding editing is not yet a decomposed story here); FF-EPIC-16
  (self-service domain add/verify — this epic only shows domain status read-only).

### 📎 References
- Portal CRUD API: FF-EPIC-09-S3. Scoped identity: FF-EPIC-11-S3. Catalog admin: FF-EPIC-12-S3.
  Reseller billing: FF-EPIC-15-S2/S3/S5.
- Permit ReBAC parent→child authority: `backend/src/permit/schema.ts`
- Design-first gate + `ui-runtime-validation` skill: `CLAUDE.md`, `.claude/skills/ui-runtime-validation/`

---

## Stories

### 📖 Story: Designer frames — master-admin + portal-admin consoles (all states)

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-14-S1 |
| **Parent Epic** | FF-EPIC-14 — Admin Consoles UI |
| **Priority** | Critical |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 8 (8 UX) |
| **Tech Layers** | Design / UX |

#### 🧑‍💼 User Story
> As a **Master Admin**, I want **every admin console screen — portal list/create/suspend, domain
> status, portal-scoped users, catalog, and billing — fully designed across all states before any
> code is written** so that **engineers build the right console once and no admin capability ships
> without a reviewable UI plan**.

#### 📌 Background & Context
Per FuzeFront's design-first gate, `product-designer` is the **sole** author of `design/frames/**`
and this is a **frames-ONLY PR** — no `frontend/src/**` changes. This story gates FF-EPIC-14-S2, S3,
and S4. It directly closes the gap that let six Security backends ship with no UI at all: every admin
capability from FF-EPIC-09/11/12/15 gets a reviewable frame here before implementation begins.

#### ✅ Acceptance Criteria
1. **Given** the master-admin and portal-admin capabilities from FF-EPIC-09/11/12/15 **When**
   `product-designer` authors the frames **Then** `design/frames/portal-admin-consoles/` contains
   ordered screens for portal list/create/suspend, domain status, portal-scoped users, catalog
   curation, and billing, plus `tokens.css` and `manifest.json` declaring the build inventory
   (flows/components/packages).
2. **Given** the frames are complete **When** `gate-frames-schema`, `gate-ds-conformance`, and
   `gate-frames-stamped` run in CI **Then** all three pass.
3. **Edge case:** **Given** a portal admin has zero apps in their catalog or zero users invited yet
   **When** the frames render those screens **Then** explicit empty states are included — not just
   populated-table happy paths.
4. **Error case:** **Given** a Permit authorization check would fail (e.g., a Portal Admin attempting
   a master-admin-only action) **When** the frames are authored **Then** an access-denied/hidden state
   is included per surface, matching the fail-closed authz model this console will enforce.

#### 🔲 Definition of Done
- [ ] PR is frames-only — no `frontend/src/**` or `packages/*-ui/**` changes
- [ ] `gate-ds-conformance` green
- [ ] `gate-frames-schema` green
- [ ] `gate-frames-stamped` green
- [ ] Build inventory (flows / React components / npm packages) declared in `manifest.json` and
      rendered in `index.html`
- [ ] Owner approved per flow (master-admin console can be approved independently of portal-admin
      consoles)
- [ ] PM verified all Acceptance Criteria against the published frames

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| UX Task | Frames `design/frames/portal-admin-consoles/**` — portal list/create/suspend, domain status, users, catalog, billing; loading/empty/error states + build inventory | 8 | Open |

#### 🔗 Dependencies
- **Blocked By:** — (frames are authored against the frozen FF-EPIC-09/11/12/15 API contracts and do
  not require those implementations to be merged first).
- **Blocks:** FF-EPIC-14-S2, FF-EPIC-14-S3, FF-EPIC-14-S4.

#### ⚠️ Risks & Assumptions
- **Assumption:** FF-EPIC-09/11/12/15 API contracts (OpenAPI) are frozen enough to design against,
  even if not yet fully implemented.
- **Risk:** Four distinct admin surfaces in one frames PR risks reviewer overload — mitigate via the
  CLAUDE.md per-flow approval model (one ready flow never waits on an unready sibling).

#### 📎 References
- Frames: `design/frames/portal-admin-consoles/` (to be created)
- Contract-first API specs: FF-EPIC-09/11/12/15

---

### 📖 Story: Master-admin portal console

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-14-S2 |
| **Parent Epic** | FF-EPIC-14 — Admin Consoles UI |
| **Priority** | High |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 12 (8 FE + 4 QA) |
| **Tech Layers** | Frontend |

#### 🧑‍💼 User Story
> As a **Master Admin**, I want to **list, create, suspend, and resume tenant portals — and see each
> portal's domain status — from a console** so that **I no longer need a DB script or support ticket
> to run portal operations**.

#### 📌 Background & Context
Consumes the master-admin portal CRUD API from FF-EPIC-09-S3 (Permit platform-admin gated). Depends
on the approved and merged frames from FF-EPIC-14-S1.

#### ✅ Acceptance Criteria
1. **Given** an authenticated Master Admin **When** they open the portal console **Then** they see a
   paginated list of portals with status (active/suspended), and can create a new portal via a form
   matching the approved frame.
2. **Given** a portal in the list **When** the Master Admin suspends or resumes it **Then** the
   console calls the corresponding FF-EPIC-09 endpoint and reflects the new status without a full
   page reload.
3. **Edge case:** **Given** no portals exist yet beyond the seeded root portal **When** the console
   loads **Then** an empty state renders per the frame — never a blank table.
4. **Error case:** **Given** a non-platform-admin user reaches the console route **When** the page
   loads **Then** the console renders an access-denied state (Permit-gated, fail-closed) — the route
   is never silently reachable.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] RTL unit tests passing, coverage ≥ 80%
- [ ] `gate-ds-conformance` green
- [ ] Authz-hidden-for-non-admin verified
- [ ] Matches approved `design/frames/portal-admin-consoles` frame — designer sign-off
- [ ] PM verified all Acceptance Criteria on staging

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| Frontend | List/create/suspend/resume portals + domain status view (calls portal CRUD API) | 8 | Open |
| QA | Console RTL + authz-hidden-for-non-admin test | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-14-S1 (approved + merged frames); FF-EPIC-09-S3 (master-admin portal CRUD
  API).
- **Related:** FF-EPIC-16 (domain status shown here is read-only; self-service editing is FF-EPIC-16).

#### ⚠️ Risks & Assumptions
- **Assumption:** FF-EPIC-09-S3's CRUD API and its generated `@fuzefront/portal-client` are available
  before this story starts.
- **Risk:** Domain status display could imply edit capability it doesn't have — mitigate with a clear
  read-only affordance per the frame.

#### 📎 References
- FF-EPIC-09-S3 (portal CRUD API)
- `backend/src/permit/schema.ts`

---

### 📖 Story: Portal-admin users + app-catalog console

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-14-S3 |
| **Parent Epic** | FF-EPIC-14 — Admin Consoles UI |
| **Priority** | High |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 12 (8 FE + 4 QA) |
| **Tech Layers** | Frontend |

#### 🧑‍💼 User Story
> As a **Portal Admin**, I want to **manage my portal's users and curate which apps appear in my
> portal's catalog** so that **I can run my tenant's day-to-day operations without master-admin
> involvement**.

#### 📌 Background & Context
Consumes the portal-scoped user/membership surface (FF-EPIC-11-S3) and the catalog admin API
(FF-EPIC-12-S3). Depends on the approved and merged frames from FF-EPIC-14-S1.

#### ✅ Acceptance Criteria
1. **Given** an authenticated Portal Admin **When** they open the users tab **Then** they see only
   their portal's users/invitations (portal-scoped), matching the frame.
2. **Given** the app-catalog tab **When** the Portal Admin enables/disables or reorders an app
   **Then** the change calls the FF-EPIC-12 catalog admin API and updates the visible order without a
   full reload.
3. **Edge case:** **Given** a newly provisioned portal with no users invited and no apps curated yet
   **When** both tabs load **Then** their respective empty states render per the frame.
4. **Error case:** **Given** a Portal Admin from Portal A attempts to view Portal B's data (e.g., via
   a manipulated URL) **When** the request is made **Then** the console shows a 403/empty state —
   never another portal's users or catalog (no cross-tenant leak).

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] RTL unit tests passing, coverage ≥ 80%
- [ ] `gate-ds-conformance` green
- [ ] Portal-scope isolation verified (no cross-tenant leak)
- [ ] Matches approved frame — designer sign-off
- [ ] PM verified all Acceptance Criteria on staging

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| Frontend | Portal-scoped user management + app-catalog curation UI | 8 | Open |
| QA | RTL + portal-scope isolation test | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-14-S1 (frames); FF-EPIC-11-S3 (portal-scoped invitations + membership API);
  FF-EPIC-12-S3 (catalog admin API).

#### ⚠️ Risks & Assumptions
- **Assumption:** FF-EPIC-11-S3's membership routes are deployed (per its own note, the security-service
  routes may need to be ported into the monolith) before this story starts.
- **Risk:** Combining users + catalog in one console surface could grow past a sprint — split into two
  stories if the critical path exceeds 10 work days.

#### 📎 References
- FF-EPIC-11-S3; FF-EPIC-12-S3
- Frame: `design/frames/portal-admin-consoles/`

---

### 📖 Story: Portal-admin billing console

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-14-S4 |
| **Parent Epic** | FF-EPIC-14 — Admin Consoles UI |
| **Priority** | High |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 12 (8 FE + 4 QA) |
| **Tech Layers** | Frontend |

#### 🧑‍💼 User Story
> As a **Tenant Reseller**, I want to **onboard my Stripe Connect account, link my price book, and see
> my portal's subscription status** so that **I can start billing my own customers without engineering
> help**.

#### 📌 Background & Context
Consumes the Connect onboarding, price-book, and platform-charges-tenant surfaces from FF-EPIC-15
(S2/S3/S5). Depends on the approved and merged frames from FF-EPIC-14-S1. This is a money-adjacent UI
surface even though it does not itself touch Stripe secrets.

#### ✅ Acceptance Criteria
1. **Given** a Portal Admin who hasn't onboarded to Stripe Connect **When** they open the billing
   console **Then** a "start onboarding" CTA is shown that begins the FF-EPIC-15-S2 Connect Account
   Link flow.
2. **Given** a Portal Admin who has completed onboarding **When** they open the billing console
   **Then** their price book (FF-EPIC-15-S3) and their portal's own platform subscription status
   (FF-EPIC-15-S5) are both visible.
3. **Edge case:** **Given** onboarding is started but not yet complete (charges/payouts not yet
   enabled per the `account.updated` webhook) **When** the console loads **Then** an in-progress state
   is shown, not a false "active" state.
4. **Error case:** **Given** the Connect return/refresh redirect fails or the account is restricted by
   Stripe **When** the console loads **Then** an actionable error state with a re-onboard action is
   shown — never a blank billing page.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] RTL unit tests passing, coverage ≥ 80%
- [ ] `gate-ds-conformance` green
- [ ] Not-onboarded/in-progress/active/error states all verified on staging
- [ ] Matches approved frame — designer sign-off
- [ ] PM verified all Acceptance Criteria on staging

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| Frontend | Connect onboarding entry + price-book link + portal subscription view | 8 | Open |
| QA | RTL + states test (not-onboarded/in-progress/active/error) | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-14-S1 (frames); FF-EPIC-15-S2 (Connect onboarding); FF-EPIC-15-S3 (price
  book); FF-EPIC-15-S5 (platform-charges-tenant).

#### ⚠️ Risks & Assumptions
- **Assumption:** FF-EPIC-15's `connected_accounts`/`tenant_plans` schema and webhook state machine
  are stable before this UI is built.
- **Risk:** This is a money-facing surface — treat as deploy-window sensitive per FF-EPIC-15's own
  `deploy-window` label, even though this story itself is UI-only.

#### 📎 References
- FF-EPIC-15-S2 / S3 / S5
- `services/billing-service/`; `backend/src/routes/billing.ts`
