---
key: FF-EPIC-12
title: Per-Portal App Catalog — curated, non-leaking app visibility per tenant
label: [fuzefront, platform, permit-gated, feature-flag, paginated, needs-jira-upload]
github: TBD
status: ready
priority: High
domain: Platform
---

## 🎯 Epic: Per-Portal App Catalog

| Field | Value |
|-------|-------|
| **Epic ID** | FF-EPIC-12 |
| **Domain** | Platform |
| **Priority** | High |
| **Owner** | Orchestrator (delegated to `backend-engineer` + `frontend-engineer` + `test-engineer`) |
| **Target Release** | Next deploy window (post EPIC-09/EPIC-10) |
| **Effort Estimate** | M |

---

### 📌 Problem Statement
> App visibility today is org+visibility based, and the app-registry's `canRead` check
> (`backend/applications/src/app-registry/service.ts`) returns `true` for any app with a null
> organization — i.e. every "public" org-less app is visible to everyone, everywhere. Inside a tenant
> portal that behavior leaks the entire root catalog into every tenant, so no portal can present a
> private, curated set of apps. This directly undermines the white-label promise of multi-tenant
> portals: a tenant portal is supposed to look and behave like its own product, not root FuzeFront's
> full app menu with the tenant's branding painted over it.

### 🎯 Goal
> Each portal shows only the apps explicitly in its own catalog; org-less/public apps no longer appear
> automatically inside a tenant portal unless a portal or master admin has explicitly added them, and
> both the shell menu and the federated app loader resolve apps through that per-portal catalog.

### 👥 Target Personas
- **Master Admin** — curates the root portal's catalog and can inspect/administer any portal's catalog.
- **Portal Admin** — enables, disables, reorders, and configures which apps appear in their own portal.
- **Portal End-User** — sees only their portal's curated app menu, never another tenant's or the uncurated global catalog.
- **Tenant Reseller** — needs their portal's app catalog isolated from other resellers' portals they don't manage.

### ✅ Features In Scope
- [ ] Feature 1: `portal_apps` entitlement table (portal_id, app_id, enabled, pinned_order, config) + catalog service (enable/disable/order/config).
- [ ] Feature 2: `app-registry` `list()` extended with a portal filter joined to the existing BOLA filter, so org-less/public apps no longer leak globally inside a tenant portal.
- [ ] Feature 3: Catalog admin API (add/remove/reorder portal apps), Permit-gated and paginated per the `gate-pagination` standard.
- [ ] Feature 4: Frontend portal-scoped menu + `FederatedAppLoader` wired to the resolved portal/org instead of a hardcoded tenant ID.
- [ ] Feature 5: Feature flag `fuzefront.apps.portal-catalog`, default OFF.

### 🚫 Out of Scope
- A marketplace/approval workflow for apps requesting to join catalogs — future epic.
- App-level billing/metering — separate from catalog curation.
- The admin console UI for catalog curation — delivered by FF-EPIC-14 (this epic ships the API + the minimal menu wiring, not the curation UI).

### 🏗️ High-Level Architecture Notes
> New `portal_apps` table: `portal_id`, `app_id`, `enabled`, `pinned_order`, `config`, with a unique
> constraint on `(portal_id, app_id)`. The existing SQL BOLA filter in
> `backend/applications/src/app-registry/service.ts` `list()` gets a portal join added alongside it —
> the org-less/public branch that currently returns `true` unconditionally is gated by portal context
> instead, so an org-less app is only visible inside a portal if that portal's catalog explicitly
> includes it. The root portal's catalog is seeded to preserve today's behavior exactly (every
> currently-visible app stays visible in the root portal), so this is additive isolation for *new*
> tenant portals, not a regression for the existing single-portal deployment. The frontend menu
> (`frontend/src/platform/appRegistry.tsx`) and `FederatedAppLoader.tsx` (which currently hardcodes a
> `tenantId`) both resolve against the portal/org supplied by FF-EPIC-10's context resolution instead.
> Catalog admin API follows contract-first conventions (OpenAPI-defined, paginated per `gate-pagination`,
> Permit-gated for portal-admin/master-admin authority). All new behavior ships behind
> `fuzefront.apps.portal-catalog`, default OFF; Permit remains the real authorization boundary — the flag
> is rollout convenience only.

### 📊 Success Metrics
| Metric | Current Baseline | Target |
|--------|-----------------|--------|
| Org-less/public apps visible in an uncurated tenant portal | 100% (all leak in) | 0% unless explicitly added to that portal's catalog |
| Root portal catalog parity with pre-epic app visibility | N/A | 100% — no apps disappear from root FuzeFront on rollout |
| `gate-pagination` + BOLA no-leak test on catalog admin API | Failing/new | Green |
| `fuzefront.apps.portal-catalog` flag OFF-state regression | N/A | 0 — legacy global visibility unchanged with flag OFF |

### 📋 Child Stories
| Story ID | Summary | Status |
|----------|---------|--------|
| FF-EPIC-12-S1 | `portal_apps` table + catalog service | Open |
| FF-EPIC-12-S2 | Registry `list()` portal filter | Open |
| FF-EPIC-12-S3 | Catalog admin API | Open |
| FF-EPIC-12-S4 | Frontend portal-scoped menu + loader wiring | Open |
| FF-EPIC-12-S5 | Feature flag `fuzefront.apps.portal-catalog` | Open |

### 🔗 Dependencies
- **Blocked By:** FF-EPIC-09 (portal object must exist for `portal_apps.portal_id` to FK against); FF-EPIC-10 (portal/org context resolution this epic filters against).
- **Blocks:** FF-EPIC-14-S3 (portal-admin catalog curation console needs this admin API).
- **Related:** FF-EPIC-11 (shares the same "no cross-portal leak" enforcement pattern and feature-flag master-switch approach, applied to apps instead of identity).

### 📎 References
- App-registry service (leak source + filter target): `backend/applications/src/app-registry/service.ts`
- Frontend registry fetch: `frontend/src/platform/appRegistry.tsx`
- Federated loader (hardcoded tenantId): `frontend/src/components/FederatedAppLoader.tsx`
- Shell branding (adjacent consumer of portal context): `frontend/src/components/TopBar.tsx`

---

## Stories

### 📖 Story: A portal's app catalog is stored and manageable

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-12-S1 |
| **Parent Epic** | FF-EPIC-12 — Per-Portal App Catalog |
| **Priority** | High |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 12 (8 BE + 4 QA) |
| **Tech Layers** | Backend |

#### 🧑‍💼 User Story
> As a **Portal Admin**, I want **a persistent, per-portal record of which apps are enabled, in what
> order, and with what configuration** so that **my portal's app catalog is a real, manageable entity
> rather than an implicit side effect of org/visibility rules**.

#### 📌 Background & Context
No entitlement table exists today — visibility is computed implicitly from org + visibility flags. This
story adds the `portal_apps` table and a catalog service providing enable/disable/order/config
operations, which S2's registry filter and S3's admin API both build on.

#### ✅ Acceptance Criteria
1. **Given** the migration runs **When** it completes **Then** `portal_apps` exists with `portal_id`, `app_id`, `enabled`, `pinned_order`, `config`, a unique constraint on `(portal_id, app_id)`, and FKs to `portals` and the apps table.
2. **Given** the catalog service **When** an app is enabled for a portal **Then** a `portal_apps` row is created/updated with `enabled = true` and the given `pinned_order`/`config`, idempotently (re-enabling an already-enabled app does not create a duplicate row).
3. **Edge case:** **Given** an app is disabled for a portal that currently has it enabled **When** disable is called **Then** the row's `enabled` flips to `false` (soft-disable, row retained) rather than being deleted — preserving prior config/order for re-enable.
4. **Error case:** **Given** a request to enable an `app_id` that does not exist (or a `portal_id` that does not exist) **When** the catalog service is called **Then** it returns a clear FK-violation-mapped error, not a silent no-op or an unhandled DB exception.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] Unit tests written and passing (coverage ≥ 80%)
- [ ] Functional tests passing on staging
- [ ] Migration is idempotent and documented
- [ ] PM verified all Acceptance Criteria on staging
- [ ] Deployed to staging and smoke-tested

#### 📋 Sub-Tasks
| Type | Summary | Assignee | Points | Status |
|------|---------|----------|--------|--------|
| Backend | Migration `portal_apps` + catalog service (enable/disable/order/config) | — | 8 | Open |
| QA | Catalog service unit test + migration test (constraints, idempotency, FK errors) | — | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-09-S1 (`portals` table).
- **Blocks:** FF-EPIC-12-S2, S3.

#### ⚠️ Risks & Assumptions
- **Assumption:** The apps table referenced by `app_id` already exists in the app-registry schema.
- **Risk:** `pinned_order` collisions across concurrent admin edits — mitigate with a stable tiebreaker (e.g., `app_id` secondary sort) rather than allowing nondeterministic ordering.

#### 📎 References
- App-registry service: `backend/applications/src/app-registry/service.ts`

---

### 📖 Story: A portal only shows its own curated apps, never the global catalog

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-12-S2 |
| **Parent Epic** | FF-EPIC-12 — Per-Portal App Catalog |
| **Priority** | High |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 12 (8 BE + 4 QA) |
| **Tech Layers** | Backend |

#### 🧑‍💼 User Story
> As a **Portal End-User**, I want **the app list I can see to be limited to my portal's curated
> catalog** so that **I never see another tenant's private apps or the uncurated root/public catalog
> leaking into my portal**.

#### 📌 Background & Context
This is the core leak-fix story. `list()` in `backend/applications/src/app-registry/service.ts` currently
returns `true` for any org-less app unconditionally. This story adds a portal join to that query so the
org-less/public branch is gated by whether the requesting portal's catalog explicitly includes the app,
while seeding the root portal's catalog to preserve today's exact visible set (no regression for the
existing deployment).

#### ✅ Acceptance Criteria
1. **Given** a Portal End-User in Portal A with a curated catalog **When** they request the app list **Then** only apps present and enabled in Portal A's `portal_apps` are returned.
2. **Given** an org-less/public app that is NOT in Portal A's catalog **When** Portal A's user requests the app list **Then** that app does not appear — the previous "org-less = visible to everyone" behavior no longer applies inside a tenant portal.
3. **Edge case:** **Given** the root portal (seeded catalog matching pre-epic behavior) **When** any root-portal user requests the app list **Then** the result set is identical to what they saw before this epic shipped — zero regression for the existing single-portal deployment.
4. **Error case:** **Given** a user's portal context cannot be resolved (missing/invalid `req.portal`) **When** the app list is requested **Then** the request fails closed (empty list or 403), never falling back to the unscoped global catalog.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] Unit tests written and passing (coverage ≥ 80%)
- [ ] Functional tests passing on staging
- [ ] API documented if a new or changed endpoint exists
- [ ] Cross-portal no-leak test suite green (appsec-reviewer pass)
- [ ] PM verified all Acceptance Criteria on staging
- [ ] Deployed to staging and smoke-tested

#### 📋 Sub-Tasks
| Type | Summary | Assignee | Points | Status |
|------|---------|----------|--------|--------|
| Backend | Add portal filter to `list()` SQL joined with the existing BOLA filter; gate org-less/public branch by portal context; seed root portal catalog to match current behavior | — | 8 | Open |
| QA | No-leak test: portal B does not see portal A's apps or uncurated public apps; root-portal regression test | — | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-12-S1 (`portal_apps` table), FF-EPIC-10-S1 (`req.portal` resolution).
- **Related:** FF-EPIC-11-S2 (same no-leak enforcement pattern applied to identity).

#### ⚠️ Risks & Assumptions
- **Assumption:** The root-portal catalog seed can be derived mechanically from today's `list()` output (every currently org-less/public/visible app gets an enabled `portal_apps` row for the root portal).
- **Risk:** An incomplete root-portal seed silently hides an app that used to be visible — mitigate with the explicit root-portal regression AC (AC3) as a release gate, not just a nice-to-have test.

#### 📎 References
- App-registry service: `backend/applications/src/app-registry/service.ts`

---

### 📖 Story: Portal and master admins curate the catalog via an API

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-12-S3 |
| **Parent Epic** | FF-EPIC-12 — Per-Portal App Catalog |
| **Priority** | High |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 12 (8 BE + 4 QA) |
| **Tech Layers** | Backend |

#### 🧑‍💼 User Story
> As a **Portal Admin**, I want **an API to add, remove, and reorder the apps in my portal's catalog**
> so that **I can curate what my portal's end-users see without needing platform engineering to do it
> for me**.

#### 📌 Background & Context
S1 built the storage/service layer; this story exposes it as a contract-first, Permit-gated, paginated
HTTP API so both the (future, FF-EPIC-14) admin console and direct API consumers can manage a portal's
catalog.

#### ✅ Acceptance Criteria
1. **Given** a Portal Admin authenticated for their portal **When** they call the add/remove/reorder catalog endpoints **Then** the operations succeed and are reflected immediately in subsequent `list()` calls (S2).
2. **Given** the catalog has more entries than one page **When** the admin lists the portal's catalog for management **Then** results paginate per the `gate-pagination` standard (cursor-based), without duplicate or skipped rows.
3. **Edge case:** **Given** a Master Admin managing a specific tenant portal's catalog **When** they call the same endpoints scoped to that portal **Then** the platform-admin authority is honored distinctly from the portal-admin's own-portal-only authority.
4. **Error case:** **Given** a Portal Admin of Portal A attempts to modify Portal B's catalog **When** the request is made **Then** the endpoint returns 403 (BOLA-authorized) and no change is made to Portal B's catalog.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] Unit tests written and passing (coverage ≥ 80%)
- [ ] Functional tests passing on staging
- [ ] Endpoints documented in OpenAPI
- [ ] `gate-pagination` green on the catalog listing endpoint
- [ ] BOLA/authorization verified (appsec-reviewer pass)
- [ ] PM verified all Acceptance Criteria on staging
- [ ] Deployed to staging and smoke-tested

#### 📋 Sub-Tasks
| Type | Summary | Assignee | Points | Status |
|------|---------|----------|--------|--------|
| Backend | OpenAPI + routes: add/remove/reorder portal apps (Permit-gated portal-admin/master-admin, paginated listing) | — | 8 | Open |
| QA | Catalog admin contract test (pagination) + authz test (cross-portal 403, platform-admin bypass) | — | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-12-S1 (catalog service).
- **Blocks:** FF-EPIC-14-S3 (portal-admin catalog curation console).

#### ⚠️ Risks & Assumptions
- **Assumption:** Permit's existing org-scoped authority model distinguishes portal-admin-for-own-portal from platform-admin, reusing the same derivation as FF-EPIC-11.
- **Risk:** Reorder operations racing across concurrent admin sessions — mitigate with a last-write-wins documented behavior or optimistic-concurrency check, decided at implementation.

#### 📎 References
- Permit schema: `backend/src/permit/schema.ts`
- Catalog service (dependency): FF-EPIC-12-S1

---

### 📖 Story: The shell menu and app loader reflect the portal's own catalog

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-12-S4 |
| **Parent Epic** | FF-EPIC-12 — Per-Portal App Catalog |
| **Priority** | High |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 8 (4 FE + 4 QA) |
| **Tech Layers** | Frontend |

#### 🧑‍💼 User Story
> As a **Portal End-User**, I want **the app menu I see in the shell to reflect only my portal's
> catalog, and any app I launch to load correctly scoped to my portal** so that **the product feels like
> my tenant's own app suite, not a shared global menu with a hardcoded tenant baked in**.

#### 📌 Background & Context
`FederatedAppLoader.tsx` currently hardcodes a `tenantId`, and the shell menu
(`frontend/src/platform/appRegistry.tsx`) fetches the registry without portal awareness. This story wires
both to the resolved portal/org from FF-EPIC-10's context, consuming the S2/S3 backend changes.

#### ✅ Acceptance Criteria
1. **Given** an authenticated Portal End-User **When** the shell menu loads **Then** it shows exactly the apps in their portal's catalog (per S2), matching what the backend returns — no client-side over-fetch of a broader list.
2. **Given** a user launches an app from the menu **When** `FederatedAppLoader` mounts it **Then** it loads using the resolved portal/org context instead of the previously hardcoded `tenantId`.
3. **Edge case:** **Given** a portal with an empty catalog (no apps enabled yet) **When** the menu loads **Then** an empty state is shown — not a broken/blank menu and not a silent fallback to the global catalog.
4. **Error case:** **Given** the portal-scoped registry fetch fails (network/API error) **When** the menu attempts to load **Then** an inline error state with retry is shown, and the loader does not fall back to loading apps unscoped.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] RTL unit tests (states + a11y) passing, coverage ≥ 80%
- [ ] `gate-ds-conformance` green — no raw hex/spacing/type
- [ ] Console-clean runtime validation (Chrome DevTools MCP) — 0 errors on menu load and app launch
- [ ] PM verified all Acceptance Criteria on staging
- [ ] Deployed to staging and smoke-tested

#### 📋 Sub-Tasks
| Type | Summary | Assignee | Points | Status |
|------|---------|----------|--------|--------|
| Frontend | Menu uses portal-scoped registry; `FederatedAppLoader` `tenantId` replaced with resolved portal/org | — | 4 | Open |
| QA | Menu reflects portal catalog (empty/error/populated states) + console-clean validation on app launch | — | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-12-S2 (backend portal-filtered `list()`), FF-EPIC-10-S2 (shell boots from portal context).
- **Related:** FF-EPIC-13 (shell branding consumes the same portal-context provider).

#### ⚠️ Risks & Assumptions
- **Assumption:** FF-EPIC-10's shell boot provider already exposes the resolved portal/org to `appRegistry.tsx` and `FederatedAppLoader.tsx`.
- **Risk:** Removing the hardcoded `tenantId` could break local dev flows that relied on it implicitly — mitigate by ensuring the root/dev portal context resolves to an equivalent value.

#### 📎 References
- Frontend registry: `frontend/src/platform/appRegistry.tsx`
- Federated loader: `frontend/src/components/FederatedAppLoader.tsx`

---

### 📖 Story: Per-portal app catalog rolls out behind a feature flag

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-12-S5 |
| **Parent Epic** | FF-EPIC-12 — Per-Portal App Catalog |
| **Priority** | Medium |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 4 (2 BE + 2 QA) |
| **Tech Layers** | Backend |

#### 🧑‍💼 User Story
> As a **Master Admin**, I want **the per-portal catalog filtering gated behind a feature flag, default
> OFF** so that **rollout is controlled and the org-less/public-app filter can be reverted instantly
> without a deploy if it misbehaves**.

#### 📌 Background & Context
Per the family flag standard, `fuzefront.apps.portal-catalog` gates S2's filtering change so existing
deployments see zero behavior change until explicitly opted in.

#### ✅ Acceptance Criteria
1. **Given** `fuzefront.apps.portal-catalog` is OFF **When** `list()` is called from any portal **Then** behavior is identical to pre-epic behavior (org-less/public apps remain globally visible) — no regression.
2. **Given** the flag is ON **When** `list()` is called **Then** S2's portal-filtered catalog behavior is active.
3. **Edge case:** **Given** the flag is toggled ON for the first time on a deployment with existing portals but no `portal_apps` seed yet **When** `list()` runs **Then** the root-portal seed (S2 AC3) has already run so no portal is left with an unexpectedly empty catalog.
4. **Error case:** **Given** the Unleash flag service is unreachable at evaluation time **When** `list()` is called **Then** the client defaults to the OFF (pre-epic, global) behavior, per the standard "flags fail open to prior stable behavior" convention — distinct from FF-EPIC-11's identity flag, which fails closed because identity leakage is the higher-severity failure mode.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] Unit tests written and passing (coverage ≥ 80%)
- [ ] Functional tests passing on staging
- [ ] Flag registered in Unleash under the `<repo>.<domain>.<flag>` taxonomy
- [ ] Both flag states (ON/OFF) explicitly tested
- [ ] PM verified all Acceptance Criteria on staging
- [ ] Deployed to staging and smoke-tested

#### 📋 Sub-Tasks
| Type | Summary | Assignee | Points | Status |
|------|---------|----------|--------|--------|
| Backend | Flag wiring for `fuzefront.apps.portal-catalog`, default OFF, gating S2's filter | — | 2 | Open |
| QA | Both flag states tested (OFF = unchanged global visibility; ON = portal-filtered) + flag-service-down fallback test | — | 2 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-12-S2 (the logic this flag gates).
- **Related:** FF-EPIC-09-S4 (`fuzefront.platform.multi-tenant-portals` master switch).

#### ⚠️ Risks & Assumptions
- **Assumption:** `@fuzefront/feature-flags` client + Unleash instance is already available in this repo (same as FF-EPIC-11-S6).
- **Risk:** Divergent fail-open/fail-closed conventions between this flag (fail open) and FF-EPIC-11's identity flag (fail closed) could confuse operators — mitigate by documenting the rationale explicitly in the flag's Unleash description, not just in this ticket.

#### 📎 References
- Feature-flags skill: `.claude/skills/feature-flags/`
- Related master switch: FF-EPIC-09-S4
