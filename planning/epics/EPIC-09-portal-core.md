---
key: FF-EPIC-09
title: Portal Core: provisioning & master-admin management
label: [fuzefront, platform, contract-first, permit-gated, needs-jira-upload]
github: TBD
status: ready
priority: Critical
domain: Platform
---

## 🎯 Epic: Portal Core: provisioning & master-admin management

| Field | Value |
|-------|-------|
| **Epic ID** | FF-EPIC-09 |
| **Domain** | Platform |
| **Priority** | Critical |
| **Owner** | Orchestrator (delegated to `backend-engineer`, contract via `contract-designer`) |
| **Target Release** | Next deploy window |
| **Effort Estimate** | L |
| **GitHub** | TBD (no issue yet) |

---

### 📌 Problem Statement
> FuzeFront is a single global portal — there is no first-class "portal" object, so a tenant like
> mendysrobotics or a reseller cannot run an isolated white-label portal with its own org, apps, and
> users on top of root FuzeFront. Master admins have no way to provision or manage such portals, which
> blocks the entire multi-tenant-portal product line (EPIC-10 through EPIC-16) at the root.

### 🎯 Goal
> A master admin can create, list, suspend, and resume tenant portals; each portal is backed by a
> tenant organization and a `portals` row, and root FuzeFront is itself the seeded root portal.

### 👥 Target Personas
- **Master Admin** — root FuzeFront staff who provisions and manages all tenant portals.
- **Portal Admin** — tenant owner/admin who is the target/owner of a provisioned portal (does not
  self-provision in this epic; see EPIC-16 for self-service).

### ✅ Features In Scope
- [ ] Feature 1: `portals` + `portal_domains` schema, with a seeded root portal (slug `fuzefront`).
- [ ] Feature 2: Resumable portal provisioning pipeline (org → Permit tenant → portal row → default
      subdomain → owner invite), advisory-locked and self-healing.
- [ ] Feature 3: Master-admin portal CRUD API (contract-first, Permit platform-admin gated), including
      suspend/resume.
- [ ] Feature 4: Master feature flag `fuzefront.platform.multi-tenant-portals`, default OFF.

### 🚫 Out of Scope
- Domain self-service (subdomain/path/custom-domain UI + verification) — FF-EPIC-16.
- Branding UI / white-label rendering — FF-EPIC-13.
- Tenant-scoped identity (portal-private user pools) — FF-EPIC-11.

### 🏗️ High-Level Architecture Notes
> Reuse the org hierarchy: a portal org is a normal org, and master-admin authority is derived from the
> existing Permit ReBAC parent→child org-admin derivation (`backend/src/permit/schema.ts`). Reuse the
> resumable provisioning backbone pattern already proven for org provisioning
> (`backend/src/services/organizationProvisioning.ts`). New tables: `portals` (`organization_id` unique
> FK, `slug` unique, `status`, `branding` jsonb, `identity_policy` jsonb, `billing_mode`) and
> `portal_domains` (`portal_id`, `domain` unique, `kind` subdomain|path|custom,
> verification/tls status). Seed a root portal row with slug `fuzefront` mapped to the existing root
> organization. All new capability wrapped in `fuzefront.platform.multi-tenant-portals`, default OFF;
> authz stays in Permit — the flag is rollout convenience only.

### 📊 Success Metrics
| Metric | Current Baseline | Target |
|--------|-----------------|--------|
| Portals object exists / requests resolvable to a portal | No (single global portal) | Yes — root portal seeded, N tenant portals provisionable |
| Portal CRUD contract test coverage (happy + authz + error) | 0% (no endpoints exist) | 100% |
| Provisioning resume success rate on mid-step failure | N/A | 100% (idempotent, advisory-locked resume) |

### 📋 Child Stories
| Story ID | Summary | Status |
|----------|---------|--------|
| FF-EPIC-09-S1 | Portal & portal_domains schema + root-portal seed | Open |
| FF-EPIC-09-S2 | Portal provisioning pipeline (resumable) | Open |
| FF-EPIC-09-S3 | Master-admin portal CRUD API (contract-first) | Open |
| FF-EPIC-09-S4 | Master feature flag fuzefront.platform.multi-tenant-portals | Open |

### 🔗 Dependencies
- **Blocked By:** — (foundational epic for the multi-tenant-portal initiative).
- **Blocks:** FF-EPIC-10 (context resolution needs `portals`/`portal_domains` schema and a provisioned
  portal to resolve against); FF-EPIC-11/12/13/14/15/16 all build on the `portals` object introduced here.
- **Related:** FF-EPIC-01 (billing UX) shares the same billing-service proxy patterns referenced for
  future `billing_mode` wiring.

### 📎 References
- Architecture anchors: `backend/src/permit/schema.ts`; `backend/src/services/organizationProvisioning.ts`;
  `backend/src/migrations/009_provisioning_backbone.ts`; `backend/src/migrations/004_create_organizations_table.ts`.
- White-label precedent: `docs/planning/locked-app-mode.md`.

---

## Stories

### 📖 Story: Platform has a first-class portals object with a seeded root portal

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-09-S1 |
| **Parent Epic** | FF-EPIC-09 — Portal Core: provisioning & master-admin management |
| **Priority** | Critical |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 16 (8 BE + 4 BE + 4 QA) |
| **Tech Layers** | Backend |

#### 🧑‍💼 User Story
> As a **Master Admin**, I want the platform to have a dedicated `portals` + `portal_domains` data
> model with root FuzeFront pre-seeded as a portal, so that every future portal (including root) is
> represented uniformly and portal-scoped features have a single source of truth to build on.

#### 📌 Background & Context
Today FuzeFront has no `portals` table — tenancy is expressed only through `organizations`. This story
introduces the `portals`/`portal_domains` schema that every subsequent story in EPIC-09/10 depends on,
and seeds a root portal row so root FuzeFront is not a special case but the first portal.

#### ✅ Acceptance Criteria
1. **Given** a fresh database with no `portals` table **When** the migration runs **Then** `portals` and
   `portal_domains` tables are created with the specified columns, FKs (`portals.organization_id` →
   `organizations.id`, unique; `portal_domains.portal_id` → `portals.id`), and unique indexes
   (`portals.slug`; `portal_domains.domain`).
2. **Given** the migration completes **When** the root-portal seed step runs **Then** exactly one
   `portals` row exists with `slug = 'fuzefront'`, `status = 'active'`, and `organization_id` pointing
   at the existing root organization.
3. **Edge case:** **Given** the migration is run twice **When** it re-runs against an already-migrated
   database **Then** no duplicate root-portal row is created and the migration exits cleanly (idempotent,
   no error).
4. **Error case:** **Given** a legacy database where the root organization row is missing or renamed
   **When** the seed step runs **Then** it fails loudly with a descriptive error rather than silently
   creating an orphaned or duplicate portal.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] Migration unit tests + repository tests passing (coverage ≥ 80%)
- [ ] Migration verified idempotent against both a fresh DB and a snapshot of the legacy schema
- [ ] Root-portal seed documented in the migration changelog
- [ ] No raw SQL outside the repository layer (matches existing migration conventions)
- [ ] PM verified all Acceptance Criteria on staging

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| Backend | migration: portals + portal_domains tables, FKs, indexes (idempotent) | 8 | Open |
| Backend | portal repository + seed root portal row | 4 | Open |
| QA | migration idempotency + schema contract test (fresh + legacy DB) | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** —
- **Blocks:** FF-EPIC-09-S2 (provisioning pipeline writes to this schema); FF-EPIC-10-S1 (resolver
  reads `portal_domains`).

#### ⚠️ Risks & Assumptions
- **Assumption:** The existing root organization row is uniquely identifiable and can be mapped 1:1 to
  the seeded root portal.
- **Risk:** A unique FK on `organization_id` assumes one portal per organization — if a future
  requirement needs many portals per org, this constraint must be revisited; documented here as an
  intentional scope decision for this epic.

#### 📎 References
- `backend/src/migrations/004_create_organizations_table.ts`; `backend/src/services/organizationProvisioning.ts`.

---

### 📖 Story: Master Admin can provision a new tenant portal via a resumable pipeline

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-09-S2 |
| **Parent Epic** | FF-EPIC-09 — Portal Core: provisioning & master-admin management |
| **Priority** | Critical |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 16 (8 BE + 4 BE + 4 QA) |
| **Tech Layers** | Backend |

#### 🧑‍💼 User Story
> As a **Master Admin**, I want to provision a new tenant portal via a resumable pipeline
> (org → Permit tenant → portal row → default subdomain → owner invite) so that portal creation is
> reliable even if a step fails partway, and never leaves partial or orphaned state behind.

#### 📌 Background & Context
This story reuses the resumable provisioning backbone pattern already proven for org provisioning
(`organizationProvisioning.ts`), extending it with portal-specific steps that land in the `portals`/
`portal_domains` tables introduced in S1.

#### ✅ Acceptance Criteria
1. **Given** a Master Admin submits a new portal request (slug, owner email) **When** provisioning runs
   **Then** it sequentially creates the org, registers the Permit tenant, inserts the `portals` row,
   allocates a default subdomain, and sends an owner invite — with each step recorded in an
   advisory-locked resumable step log.
2. **Given** provisioning fails after the org and Permit-tenant steps succeed but before the portal row
   is inserted **When** the operator re-triggers provisioning for the same request **Then** it resumes
   from the failed step without re-creating the org or Permit tenant (idempotent by request key).
3. **Edge case:** **Given** two concurrent provisioning requests for the same slug **When** both run
   **Then** the advisory lock serializes them and the second request fails with a clear
   "slug already provisioning/taken" error rather than racing to a corrupt state.
4. **Error case:** **Given** the owner-invite email step fails (e.g., mail service down) after all prior
   steps succeeded **When** provisioning completes **Then** the portal is left in a
   `provisioned-pending-invite` status (never silently `active`) and a `portal.created` event is
   emitted to the event outbox so the failure is observable and retryable.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] Integration tests passing incl. mid-step resume (coverage ≥ 80%)
- [ ] Advisory-lock behavior verified under concurrent requests
- [ ] `portal.created` event documented in the event schema
- [ ] Reconcile/self-heal path verified against a deliberately stuck pipeline run
- [ ] PM verified all Acceptance Criteria on staging

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| Backend | provisioning service: org→Permit tenant→portal row→default subdomain→owner invite, advisory-locked resumable steps | 8 | Open |
| Backend | reconcile/self-heal + event_outbox portal.created event | 4 | Open |
| QA | provisioning integration test incl. mid-step resume | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-09-S1 (schema must exist first).
- **Blocks:** FF-EPIC-09-S3 (CRUD API surfaces this pipeline); FF-EPIC-10 (context resolution needs a
  provisioned portal to resolve against).

#### ⚠️ Risks & Assumptions
- **Assumption:** The Permit tenant-registration API already used by org provisioning can be reused
  unchanged for portal-owning orgs.
- **Risk:** Partial failure between the `event_outbox` emit and consumer processing could double-provision
  downstream resources — mitigate with idempotency keys on `portal.created` consumers.

#### 📎 References
- `backend/src/services/organizationProvisioning.ts`; `backend/src/permit/schema.ts`.

---

### 📖 Story: Master Admin can manage the full portal lifecycle via a contract-first CRUD API

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-09-S3 |
| **Parent Epic** | FF-EPIC-09 — Portal Core: provisioning & master-admin management |
| **Priority** | Critical |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 16 (4 BE + 8 BE + 4 QA) |
| **Tech Layers** | Backend |

#### 🧑‍💼 User Story
> As a **Master Admin**, I want a contract-first CRUD API (create/list/get/update/suspend/resume) for
> portals, gated to platform admins in Permit, so that I can manage the full portal lifecycle without
> direct DB access, and other teams can build against a stable generated client.

#### 📌 Background & Context
Surfaces the S2 provisioning pipeline and S1 schema behind a versioned, OpenAPI-first HTTP API, matching
the contract-first pattern used elsewhere in the platform (e.g., `services/billing-service/openapi.yaml`).

#### ✅ Acceptance Criteria
1. **Given** a platform admin calls `POST /portals` with a valid payload **When** the request is
   processed **Then** a portal is created via the S2 pipeline and the response matches the published
   OpenAPI schema; `GET /portals` lists portals and `GET /portals/:id` returns one.
2. **Given** a platform admin calls `PATCH /portals/:id` suspend **When** the request succeeds **Then**
   the portal's status flips to `suspended` and is reflected on subsequent GET calls; a resume call
   flips it back to `active`.
3. **Edge case:** **Given** a suspended portal **When** any request other than resume/get targets it
   **Then** downstream access to that portal is blocked (paired with FF-EPIC-10's fail-closed
   resolution) — this API's `status` field is the single source of truth for that block.
4. **Error case:** **Given** a non-admin (Portal Admin or Portal End-User) calls any portal CRUD
   endpoint **When** the request is authorized **Then** Permit denies it fail-closed and the API
   returns 403 — never a fallback allow.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] Backend unit + contract tests passing (coverage ≥ 80%)
- [ ] OpenAPI spec published; `@fuzefront/portal-client` generated and consumable
- [ ] BOLA/authorization verified (appsec-reviewer pass) — non-admin 403 on every route
- [ ] Suspend/resume verified to invalidate any cached portal-resolution state
- [ ] PM verified all Acceptance Criteria on staging

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| Backend | OpenAPI: POST/GET/GET:id/PATCH /portals + suspend/resume; generate @fuzefront/portal-client | 4 | Open |
| Backend | routes + Permit platform-admin gate (fail-closed) | 8 | Open |
| QA | contract + authz tests (non-admin 403, suspend blocks access) | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-09-S1, FF-EPIC-09-S2.
- **Blocks:** FF-EPIC-14-S2 (master-admin portal console consumes this API).

#### ⚠️ Risks & Assumptions
- **Assumption:** Permit already has (or can be extended with) a platform-admin role independent of any
  single org's admin role.
- **Risk:** Contract drift between hand-written OpenAPI and routes — mitigate by generating the client
  from the spec and running contract tests in CI.

#### 📎 References
- `backend/src/permit/schema.ts`; proxy/route pattern precedent: `backend/src/routes/billing.ts`.

---

### 📖 Story: Portal capability is safely staged behind a master feature flag

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-09-S4 |
| **Parent Epic** | FF-EPIC-09 — Portal Core: provisioning & master-admin management |
| **Priority** | High |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 4 (2 BE + 2 QA) |
| **Tech Layers** | Backend |

#### 🧑‍💼 User Story
> As a **Master Admin**, I want all portal-provisioning and CRUD capability wrapped behind a single
> feature flag defaulted OFF, so that the multi-tenant-portal rollout can be staged safely without
> affecting today's single-portal FuzeFront behavior.

#### 📌 Background & Context
Per the baseline feature-flag standard (Unleash + OpenFeature + `@fuzefront/feature-flags`), all new
risky capability ships flagged OFF by default. This flag — `fuzefront.platform.multi-tenant-portals` —
becomes the master switch reused by later epics (EPIC-13 branding, EPIC-14 admin consoles).

#### ✅ Acceptance Criteria
1. **Given** the flag `fuzefront.platform.multi-tenant-portals` is OFF (default) **When** any portal
   CRUD/provisioning endpoint is called **Then** the server returns the pre-epic behavior/404 as
   appropriate, unchanged from today.
2. **Given** the flag is turned ON for a scoped context (e.g., master-admin only) **When** the same
   endpoints are called **Then** the S1–S3 functionality is active.
3. **Edge case:** **Given** the flag flips ON mid-session for an already-authenticated master admin
   **When** they refresh **Then** the behavior reflects the new state without requiring re-login.
4. **Error case:** **Given** the Unleash/flag service is unreachable **When** the client evaluates the
   flag **Then** it fails closed to OFF (safe default), never defaulting to ON.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] Both flag states tested and passing
- [ ] Flag registered in the taxonomy with owner + removal criterion (`feature-flags-engineer` sign-off)
- [ ] Fail-closed-on-unreachable behavior verified
- [ ] PM verified all Acceptance Criteria on staging

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| Backend | flag wiring server + client, default OFF | 2 | Open |
| QA | both flag states (OFF = unchanged behavior) | 2 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-09-S3.
- **Blocks:** — (downstream epics FF-EPIC-13/14 reuse this same flag as their master switch, but are
  not blocked from starting their own non-flag work).

#### ⚠️ Risks & Assumptions
- **Assumption:** Unleash and the `@fuzefront/feature-flags` client are already onboarded in this repo
  per baseline §10.
- **Risk:** Flag left ON accidentally pre-launch — mitigate via `feature-flags-engineer` review and a
  documented removal/graduation criterion.

#### 📎 References
- `.claude/skills/feature-flags/`.
