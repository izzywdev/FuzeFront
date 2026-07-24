---
key: FF-EPIC-11
title: Tenant-Scoped Identity — portal-private accounts, invitations, and login
label: [fuzefront, identity, security, permit-gated, feature-flag, needs-jira-upload]
github: TBD
status: ready
priority: Critical
domain: Identity / Security
---

## 🎯 Epic: Tenant-Scoped Identity

| Field | Value |
|-------|-------|
| **Epic ID** | FF-EPIC-11 |
| **Domain** | Identity / Security |
| **Priority** | Critical |
| **Owner** | Orchestrator (delegated to `backend-engineer` + `devops-engineer` + `test-engineer`) |
| **Target Release** | Next deploy window (post EPIC-09/EPIC-10) |
| **Effort Estimate** | XL |

---

### 📌 Problem Statement
> Users are a single global pool keyed by email: `users` carries no tenant FK, there is one shared
> Authentik pool, and OIDC upserts accounts by email alone. Any account created in one portal is
> structurally visible to every other surface on the platform — listing, search, profile, invitations,
> and login all operate globally. This means a tenant like mendysrobotics cannot have accounts that are
> private to its portal, which is the core isolation requirement multi-tenant portals depend on. Without
> this, EPIC-09's portal object and EPIC-10's context resolution give each portal a shell, but every
> portal still shares one identity pool underneath it.

### 🎯 Goal
> Every account has a home portal; all user-facing identity surfaces (listing, search, profile,
> invitations, membership, and login) are scoped to that portal so a portal's accounts are invisible to
> every other portal, enforced fail-closed at the query layer — and logging into a portal with an
> account that does not belong there is rejected by default.

### 👥 Target Personas
- **Master Admin** — root FuzeFront staff who administers all portals and needs a controlled bypass to support any tenant.
- **Portal Admin** — a tenant owner/admin who manages their own portal's users and invites without ever seeing another tenant's accounts.
- **Portal End-User** — a tenant's customer whose account and profile must stay private to that tenant.
- **Tenant Reseller** — bills their own customers and needs those customer accounts fully isolated from other resellers' portals.

### ✅ Features In Scope
- [ ] Feature 1: `users.home_portal_id` scoping model — every account has a home portal (null = root user), with a central `scopeToPortal` query helper used everywhere accounts are read.
- [ ] Feature 2: Portal-scoped user listing/search/profile — no surface returns another portal's accounts, with a platform-admin bypass for support.
- [ ] Feature 3: Portal-scoped invitations + membership surface — invite-by-email creates or attaches an account only within the inviting portal.
- [ ] Feature 4: Authentik per-portal brands + per-domain OIDC redirect URIs, registered automatically at portal provisioning.
- [ ] Feature 5: Cross-portal login rejection by default, with an `identity_policy` allow-flag for controlled master-admin support access.
- [ ] Feature 6: Feature flag `fuzefront.identity.portal-scoped-users`, default OFF, gating all new scoping so existing global behavior is unaffected until rollout.

### 🚫 Out of Scope
- Hard per-tenant email namespacing — email stays globally unique in one Authentik pool; the same email cannot register as two distinct portal accounts in this epic.
- Portal object/provisioning itself — delivered by FF-EPIC-09.
- Host/path/custom-domain context resolution — delivered by FF-EPIC-10 (this epic consumes `req.portal`/`req.user.portalId` from it).
- Admin console UI for managing users/invitations — delivered by FF-EPIC-14.

### 🏗️ High-Level Architecture Notes
> Add a nullable `users.home_portal_id` FK (`null` = root/platform user, preserving today's behavior for
> existing accounts). Introduce a central `scopeToPortal` query helper so every listing/search/profile
> read path filters through one place rather than ad hoc `WHERE` clauses — this mirrors the existing SQL
> BOLA-filter pattern in `backend/applications/src/app-registry/service.ts`. Permit's tenant concept is
> already the organization (ReBAC parent→child org-admin derivation lives in
> `backend/src/permit/schema.ts`); platform-admin authority reuses that same derivation as the scoping
> bypass rather than inventing a second authority model. The invitation/membership API is not native to
> the monolith today — `backend/security/` already has invitation/membership routes, so this epic either
> deploys that service or ports its routes into the monolith (decided in S3). OIDC identity sync
> (`backend/src/services/oidc.ts`, `syncUserToDatabase`) is extended to carry portal context so an OIDC
> upsert lands the account in the correct home portal rather than the single global pool. Per-portal
> Authentik brand blueprints follow the existing precedent at
> `deploy/helm/fuzefront/authentik/blueprints/brand-fuseseam.yaml`, and per-domain OIDC redirect URIs are
> registered as part of the provisioning backbone (`backend/src/services/organizationProvisioning.ts`).
> All new scoping ships behind `fuzefront.identity.portal-scoped-users`, default OFF; real authorization
> stays in Permit — the flag is rollout convenience only, never the authz decision itself.

### 📊 Success Metrics
| Metric | Current Baseline | Target |
|--------|-----------------|--------|
| Cross-tenant account visibility (portal A can enumerate/search portal B's users) | Possible today (no scoping) | 0 — verified by automated no-leak test suite |
| Cross-portal login success rate for non-home-portal accounts | 100% (unrestricted) | 0% by default, opt-in only via `identity_policy` support-access flag |
| Portals with per-domain OIDC redirect + branded login | 0 | 100% of provisioned portals |
| `fuzefront.identity.portal-scoped-users` flag OFF-state regression | N/A | 0 — legacy global behavior unchanged with flag OFF |

### 📋 Child Stories
| Story ID | Summary | Status |
|----------|---------|--------|
| FF-EPIC-11-S1 | `users.home_portal_id` + scoping model | Open |
| FF-EPIC-11-S2 | Portal-scoped user listing/search/profile | Open |
| FF-EPIC-11-S3 | Portal-scoped invitations + membership surface | Open |
| FF-EPIC-11-S4 | Authentik per-portal brands + per-domain OIDC redirect URIs | Open |
| FF-EPIC-11-S5 | Cross-portal login rejection + `identity_policy` | Open |
| FF-EPIC-11-S6 | Feature flag `fuzefront.identity.portal-scoped-users` | Open |

### 🔗 Dependencies
- **Blocked By:** FF-EPIC-09 (portal object + provisioning backbone must exist before accounts can be homed to a portal); FF-EPIC-10 (`req.portal` / `req.user.portalId` context resolution this epic scopes against).
- **Blocks:** FF-EPIC-14 (admin-console UI for user/invitation management needs this API); FF-EPIC-12 does not depend on this epic but ships the same feature-flag master-switch pattern.
- **Related:** FF-EPIC-13 (per-portal login theming consumes the Authentik brand blueprints added in S4).

### 📎 References
- Permit ReBAC schema: `backend/src/permit/schema.ts`
- App-registry BOLA filter precedent: `backend/applications/src/app-registry/service.ts`
- Org model + settings: `backend/src/migrations/004_create_organizations_table.ts`
- Provisioning backbone: `backend/src/services/organizationProvisioning.ts`
- OIDC identity sync: `backend/src/services/oidc.ts` (`syncUserToDatabase`)
- Candidate invitation/membership routes: `backend/security/`
- Authentik brand blueprint precedent: `deploy/helm/fuzefront/authentik/blueprints/brand-fuseseam.yaml`
- White-label precedent doc: `docs/planning/locked-app-mode.md`

---

## Stories

### 📖 Story: Every account has a home portal

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-11-S1 |
| **Parent Epic** | FF-EPIC-11 — Tenant-Scoped Identity |
| **Priority** | Critical |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 12 (8 BE + 4 QA) |
| **Tech Layers** | Backend |

#### 🧑‍💼 User Story
> As a **Portal Admin**, I want **every user account to belong to a specific home portal** so that **my
> tenant's accounts are structurally distinguishable from every other portal's accounts before any
> scoping logic is even applied**.

#### 📌 Background & Context
`users` has no tenant FK today — accounts are one undifferentiated pool. This story adds the foundational
`home_portal_id` column and backfills existing accounts to the root portal (seeded in FF-EPIC-09), and
extends the request-scoped portal/AppCaller context so downstream code can read "whose portal is this
account homed to" without re-deriving it per call site.

#### ✅ Acceptance Criteria
1. **Given** the migration runs on a fresh database **When** it completes **Then** `users.home_portal_id` exists as a nullable FK to `portals.id` and all seed/test accounts are correctly homed (root accounts get the root portal, or `null` per the null=root convention).
2. **Given** the migration runs on an existing production-shaped database with pre-existing users **When** it completes **Then** every existing account backfills to the root portal (or `null`) with zero accounts left in an ambiguous/unset state, and no existing login breaks.
3. **Edge case:** **Given** a user record whose organization cannot be resolved to any portal at backfill time **When** the backfill runs **Then** that account defaults to `null` (root) rather than failing the migration or silently dropping the row.
4. **Error case:** **Given** the migration is run twice (idempotency check) **When** it runs the second time **Then** it is a no-op — no duplicate columns, no constraint errors, no data corruption.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] Unit tests written and passing (coverage ≥ 80%)
- [ ] Functional tests passing on staging
- [ ] Migration is idempotent and documented
- [ ] AppCaller/portal-context type surfaces `home_portal_id` for downstream stories
- [ ] PM verified all Acceptance Criteria on staging
- [ ] Deployed to staging and smoke-tested

#### 📋 Sub-Tasks
| Type | Summary | Assignee | Points | Status |
|------|---------|----------|--------|--------|
| Backend | Migration: `users.home_portal_id` FK + backfill existing rows to root portal | — | 8 | Open |
| QA | Scoping-model unit test + migration idempotency test (fresh DB + legacy-shaped DB) | — | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-09-S1 (`portals` table must exist before `home_portal_id` can FK to it).
- **Blocks:** FF-EPIC-11-S2, S3, S5 (all read `home_portal_id`).

#### ⚠️ Risks & Assumptions
- **Assumption:** FF-EPIC-09's root-portal seed (slug `fuzefront`) is present before this migration runs.
- **Risk:** A large existing `users` table backfill could lock the table under load — mitigate with a batched/backgroundable backfill rather than a single UPDATE.

#### 📎 References
- Org model: `backend/src/migrations/004_create_organizations_table.ts`
- Portal schema (dependency): FF-EPIC-09-S1

---

### 📖 Story: Portal accounts are invisible to other portals

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-11-S2 |
| **Parent Epic** | FF-EPIC-11 — Tenant-Scoped Identity |
| **Priority** | Critical |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 12 (8 BE + 4 QA) |
| **Tech Layers** | Backend |

#### 🧑‍💼 User Story
> As a **Portal End-User**, I want **my account to be invisible to user listing, search, and profile
> lookups from other portals** so that **my tenant's data stays private the way a white-label portal is
> supposed to behave**.

#### 📌 Background & Context
This is the core isolation enforcement story. It applies the `scopeToPortal` query helper (built on
`home_portal_id` from S1) to every existing user listing/search/profile read path, with an explicit
platform-admin bypass for master-admin support tooling — mirroring the BOLA-filter pattern already used
in `backend/applications/src/app-registry/service.ts`.

#### ✅ Acceptance Criteria
1. **Given** an authenticated Portal Admin in Portal A **When** they list or search users **Then** only Portal A's accounts are returned — Portal B's accounts never appear, at any page of results.
2. **Given** a Master Admin (platform-admin authority) **When** they list users across portals **Then** the platform-admin bypass returns the full cross-portal view, distinct from the tenant-scoped path.
3. **Edge case:** **Given** a Portal A user requests the profile of a known Portal B user ID directly by ID **When** the request is made **Then** the response is 404 or an empty result — never Portal B's actual profile data, and never a distinguishable "exists but forbidden" signal that would leak existence.
4. **Error case:** **Given** the portal-scoping context is missing or malformed on a request (e.g., no resolved `req.user.portalId`) **When** any scoped listing/search/profile endpoint is called **Then** the request fails closed (403/empty), never falling back to an unscoped global query.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] Unit tests written and passing (coverage ≥ 80%)
- [ ] Functional tests passing on staging
- [ ] API documented if a new or changed endpoint exists
- [ ] Cross-tenant no-leak test suite green (appsec-reviewer pass)
- [ ] PM verified all Acceptance Criteria on staging
- [ ] Deployed to staging and smoke-tested

#### 📋 Sub-Tasks
| Type | Summary | Assignee | Points | Status |
|------|---------|----------|--------|--------|
| Backend | Apply `scopeToPortal` to user list/search/profile endpoints; add platform-admin bypass | — | 8 | Open |
| QA | Cross-tenant invisibility test — portal A cannot see portal B users; direct-ID lookup returns 404/empty, never another portal's rows | — | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-11-S1 (`home_portal_id` scoping model).
- **Related:** FF-EPIC-12-S2 (same no-leak pattern applied to the app catalog).

#### ⚠️ Risks & Assumptions
- **Assumption:** The Permit ReBAC parent→child derivation (`backend/src/permit/schema.ts`) is sufficient to distinguish platform-admin authority from portal-admin authority.
- **Risk:** A missed call site that reads `users` directly without the `scopeToPortal` helper reintroduces a leak — mitigate by centralizing all reads through the helper and adding a lint/grep-based check for raw `users` queries outside it.

#### 📎 References
- BOLA-filter precedent: `backend/applications/src/app-registry/service.ts`
- Permit schema: `backend/src/permit/schema.ts`

---

### 📖 Story: Invitations and membership stay within the inviting portal

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-11-S3 |
| **Parent Epic** | FF-EPIC-11 — Tenant-Scoped Identity |
| **Priority** | Critical |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 20 (8 BE + 8 BE + 4 QA) |
| **Tech Layers** | Backend |

#### 🧑‍💼 User Story
> As a **Portal Admin**, I want **inviting a user by email to create or attach an account only within
> my portal** so that **I can grow my portal's user base without accidentally granting or exposing
> access to a different tenant's account**.

#### 📌 Background & Context
No native invitation/membership API exists in the monolith today. `backend/security/` already has these
routes; this story either deploys that service as-is or ports the routes into the monolith (decision
made during implementation based on deployment footprint), then makes invite-by-email portal-aware so it
never attaches an existing cross-portal account to a portal it doesn't belong to.

#### ✅ Acceptance Criteria
1. **Given** a Portal Admin invites a brand-new email address **When** the invite is sent and accepted **Then** a new account is created homed to the inviting portal (`home_portal_id` = that portal).
2. **Given** a Portal Admin invites an email address that already has an account homed to a *different* portal **When** the invite is processed **Then** the invite does not attach that existing cross-portal account — it either creates a new portal-local account or is rejected with a clear error, but never silently grants membership on the existing foreign account.
3. **Edge case:** **Given** a Portal Admin invites an email address that already has an account homed to the *same* portal **When** the invite is processed **Then** the existing account is attached/re-invited (membership updated) without duplicate account creation.
4. **Error case:** **Given** an invitation token is used from a different portal context than it was issued for (e.g., accepted while resolved against the wrong portal domain) **When** the accept flow runs **Then** the request is rejected fail-closed and no membership is granted.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] Unit tests written and passing (coverage ≥ 80%)
- [ ] Functional tests passing on staging
- [ ] API documented (OpenAPI) for invitation/membership endpoints
- [ ] BOLA/authorization verified (appsec-reviewer pass)
- [ ] PM verified all Acceptance Criteria on staging
- [ ] Deployed to staging and smoke-tested

#### 📋 Sub-Tasks
| Type | Summary | Assignee | Points | Status |
|------|---------|----------|--------|--------|
| Backend | Deploy or port `backend/security/` membership + invitation routes into the active surface | — | 8 | Open |
| Backend | Invite-by-email attaches/creates an account only within the inviting portal (no cross-portal attach) | — | 8 | Open |
| QA | Invitation-scope + accept-flow test, incl. cross-portal-email and wrong-portal-token cases | — | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-11-S1 (`home_portal_id`), FF-EPIC-11-S2 (scoping helper reused for membership reads).
- **Blocks:** FF-EPIC-14-S3 (portal-admin users console consumes this API).

#### ⚠️ Risks & Assumptions
- **Assumption:** `backend/security/` routes are close enough to the target contract that porting is cheaper than a rewrite; this is confirmed at implementation start, not assumed blind.
- **Risk:** Global email uniqueness (this epic's stated out-of-scope constraint) means an email can only ever have one home portal — the reject-vs-create decision in AC2 must be made explicit and consistent, not left ambiguous per call site.

#### 📎 References
- Candidate routes: `backend/security/`
- Scoping helper: FF-EPIC-11-S2

---

### 📖 Story: Each portal has its own branded, correctly-redirecting login

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-11-S4 |
| **Parent Epic** | FF-EPIC-11 — Tenant-Scoped Identity |
| **Priority** | High |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 16 (8 BE + 4 DevOps + 4 QA) |
| **Tech Layers** | Full-Stack |

#### 🧑‍💼 User Story
> As a **Portal Admin**, I want **my portal's login to be branded and to redirect back to my portal's
> own domain after authentication** so that **my tenant's login experience looks and behaves like our
> own product, not a shared generic FuzeFront login**.

#### 📌 Background & Context
Authentik is currently one shared identity provider brand. This story registers a per-domain OIDC
redirect URI at portal provisioning time and adds a per-portal Authentik brand blueprint for login
theming, following the existing precedent at
`deploy/helm/fuzefront/authentik/blueprints/brand-fuseseam.yaml`.

#### ✅ Acceptance Criteria
1. **Given** a portal is provisioned with a domain (subdomain/path/custom, per FF-EPIC-09/10) **When** provisioning completes **Then** a per-domain OIDC redirect URI is registered in Authentik for that portal automatically, with no manual step.
2. **Given** a user logs in through a specific portal's domain **When** the login page renders **Then** it shows that portal's Authentik brand (theming) rather than the shared default brand.
3. **Edge case:** **Given** a portal has multiple registered domains (e.g., a subdomain plus a later custom domain from FF-EPIC-16) **When** login is initiated from any of them **Then** the correct redirect URI for that specific domain is used — no cross-domain redirect mismatch/rejection.
4. **Error case:** **Given** the OIDC redirect URI registration step fails during provisioning **When** provisioning runs **Then** the provisioning pipeline surfaces the failure and the portal is not left in a state where login is silently broken (fail loud, not fail silent) — consistent with the resumable provisioning backbone's self-heal behavior.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] Unit tests written and passing (coverage ≥ 80%)
- [ ] Functional tests passing on staging
- [ ] Per-domain redirect URI + brand blueprint documented
- [ ] PM verified all Acceptance Criteria on staging
- [ ] Deployed to staging and smoke-tested

#### 📋 Sub-Tasks
| Type | Summary | Assignee | Points | Status |
|------|---------|----------|--------|--------|
| Backend | Register per-domain OIDC redirect URIs at portal provisioning time | — | 8 | Open |
| DevOps | Per-portal Authentik brand blueprint for login theming | — | 4 | Open |
| QA | Per-domain login theming + redirect-URI correctness test (incl. multi-domain portal) | — | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-09-S2 (provisioning pipeline this hooks into); FF-EPIC-10-S1 (domain resolution).
- **Related:** FF-EPIC-13 (shell branding consumes the same portal-branding concept for the app UI, not the IdP login page).

#### ⚠️ Risks & Assumptions
- **Assumption:** Authentik supports per-brand blueprints programmatically (already proven by the fuse-seam brand precedent).
- **Risk:** Redirect URI sprawl across many domains per portal could hit Authentik client-config limits — mitigate by scoping to actively-verified domains only.

#### 📎 References
- Brand blueprint precedent: `deploy/helm/fuzefront/authentik/blueprints/brand-fuseseam.yaml`
- Provisioning backbone: `backend/src/services/organizationProvisioning.ts`
- OIDC sync: `backend/src/services/oidc.ts`

---

### 📖 Story: Cross-portal login is rejected by default

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-11-S5 |
| **Parent Epic** | FF-EPIC-11 — Tenant-Scoped Identity |
| **Priority** | Critical |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 8 (4 BE + 4 QA) |
| **Tech Layers** | Backend |

#### 🧑‍💼 User Story
> As a **Portal End-User**, I want **an account that does not belong to a portal to be rejected when it
> tries to log into that portal** so that **another tenant's staff or a root account cannot casually
> access my portal**, while still allowing **Master Admin** support access when explicitly enabled.

#### 📌 Background & Context
S2 makes accounts invisible to *listing*; this story closes the equivalent gap at *login*. A root/other-
portal account authenticating against a tenant portal's domain must be rejected by default. An
`identity_policy` field (on the `portals` row from FF-EPIC-09) provides an explicit allow-flag so master
admins can support a tenant without disabling isolation platform-wide.

#### ✅ Acceptance Criteria
1. **Given** a user account homed to Portal B **When** they attempt to log in through Portal A's domain **Then** the login is denied by default, with a clear "account not valid for this portal" error — not a generic auth failure that hides the real reason from support/debugging.
2. **Given** a Master Admin account **When** `identity_policy` on the target portal has the support-access allow-flag enabled **Then** the Master Admin can log in to that portal for support purposes, and the access is distinguishable (audit-logged) from a normal tenant login.
3. **Edge case:** **Given** a root account (`home_portal_id = null`) attempts to log into a tenant portal **When** `identity_policy` does not explicitly allow it **Then** the login is denied the same as any other cross-portal account — root accounts get no implicit bypass.
4. **Error case:** **Given** the `identity_policy` field is missing/malformed on a portal row **When** any login is attempted against that portal **Then** the system fails closed (deny cross-portal login) rather than defaulting to permissive.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] Unit tests written and passing (coverage ≥ 80%)
- [ ] Functional tests passing on staging
- [ ] API documented if a new or changed endpoint exists
- [ ] Support-access path is audit-logged and verified (appsec-reviewer pass)
- [ ] PM verified all Acceptance Criteria on staging
- [ ] Deployed to staging and smoke-tested

#### 📋 Sub-Tasks
| Type | Summary | Assignee | Points | Status |
|------|---------|----------|--------|--------|
| Backend | Reject root/other-portal account login into a tenant portal by default; `identity_policy` allow-flag for master-admin support access | — | 4 | Open |
| QA | Cross-portal login denied test + support-access allow-flag path test (incl. audit log assertion) | — | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-11-S1 (`home_portal_id`), FF-EPIC-09-S1 (`identity_policy` jsonb column on `portals`).
- **Related:** FF-EPIC-11-S4 (per-domain login is the surface this rejection applies to).

#### ⚠️ Risks & Assumptions
- **Assumption:** `identity_policy` jsonb schema (portal-level allow-flags) is finalized as part of FF-EPIC-09's `portals` table.
- **Risk:** An overly broad support-access flag could become a standing backdoor — mitigate with audit logging and a documented expectation that it's toggled per support incident, not left permanently on.

#### 📎 References
- Permit schema (authority derivation reused for master-admin check): `backend/src/permit/schema.ts`
- Portal schema (dependency): FF-EPIC-09-S1

---

### 📖 Story: Portal-scoped identity rolls out behind a feature flag

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-11-S6 |
| **Parent Epic** | FF-EPIC-11 — Tenant-Scoped Identity |
| **Priority** | High |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 4 (2 BE + 2 QA) |
| **Tech Layers** | Backend |

#### 🧑‍💼 User Story
> As a **Master Admin**, I want **all portal-scoped identity behavior gated behind a feature flag,
> default OFF** so that **rollout is controlled and can be reverted instantly without a deploy if
> scoping misbehaves**.

#### 📌 Background & Context
Per the family flag standard (Unleash + OpenFeature via `@fuzefront/feature-flags`), all new/risky server
logic ships wrapped in a flag. `fuzefront.identity.portal-scoped-users` gates S2/S3/S5's scoping logic;
with the flag OFF, behavior is identical to today's global pool (no regression for existing deployments
that haven't opted into multi-tenant portals yet).

#### ✅ Acceptance Criteria
1. **Given** `fuzefront.identity.portal-scoped-users` is OFF **When** any user listing/search/profile/invite/login flow runs **Then** behavior is identical to pre-epic global behavior — no scoping applied, no regression.
2. **Given** the flag is ON **When** the same flows run **Then** S2/S3/S5's portal-scoping and cross-portal-login-rejection logic is active.
3. **Edge case:** **Given** the flag is toggled ON while accounts already exist with `home_portal_id` populated **When** scoping activates **Then** no accounts are lost or hidden incorrectly — the flag only gates enforcement, not data integrity (the column and backfill from S1 are always present regardless of flag state).
4. **Error case:** **Given** the Unleash flag service is unreachable at evaluation time **When** a scoped endpoint is called **Then** the client defaults fail-closed to the safer state for identity (scoping enforced), not fail-open to global visibility — this is a documented exception to "flags are rollout convenience only" because the safe default for identity leakage is deny, not allow.

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
| Backend | Flag wiring server + client for `fuzefront.identity.portal-scoped-users`, default OFF, gating S2/S3/S5 | — | 2 | Open |
| QA | Both flag states tested (OFF = unchanged global behavior; ON = scoping enforced) + fail-closed-on-flag-service-down test | — | 2 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-11-S2, S3, S5 (the logic this flag gates).
- **Related:** FF-EPIC-09-S4 (`fuzefront.platform.multi-tenant-portals` master switch); this flag is a sub-flag of that rollout.

#### ⚠️ Risks & Assumptions
- **Assumption:** `@fuzefront/feature-flags` client + Unleash instance (hosted by FuzeFront per the family flag standard) is already available in this repo.
- **Risk:** Flag ownership handoff — `feature-flags-engineer` owns the taxonomy/administration; this sub-task only wires the check, it does not define flag governance.

#### 📎 References
- Feature-flags skill: `.claude/skills/feature-flags/`
- Related master switch: FF-EPIC-09-S4
