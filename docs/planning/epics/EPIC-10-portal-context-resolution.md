---
key: FF-EPIC-10
title: Portal Context Resolution & Boot
label: [fuzefront, platform, contract-first, needs-jira-upload]
github: TBD
status: ready
priority: Critical
domain: Platform
---

## 🎯 Epic: Portal Context Resolution & Boot

| Field | Value |
|-------|-------|
| **Epic ID** | FF-EPIC-10 |
| **Domain** | Platform |
| **Priority** | Critical |
| **Owner** | Orchestrator (delegated to `backend-engineer` + `frontend-engineer`, contract via `contract-designer`) |
| **Target Release** | Next deploy window |
| **Effort Estimate** | M |
| **GitHub** | TBD (no issue yet) |

---

### 📌 Problem Statement
> The shell hardcodes branding and a `default-tenant`; the backend derives tenant only from URL params.
> Nothing maps an incoming Host/path to a portal, so one shared deployment cannot serve many portals —
> every portal provisioned by FF-EPIC-09 has nowhere for a request to actually land.

### 🎯 Goal
> Every request and the shell boot resolve the active portal from the Host header, `/p/<slug>` path, or
> custom domain (fail-closed to root/404/suspended), and the frontend boots its identity + branding
> from a single portal-context endpoint.

### 👥 Target Personas
- **Portal End-User** — visits a tenant host/subdomain/path and expects that portal's identity, not
  root FuzeFront's or another tenant's.
- **Portal Admin** — reaches their portal via a subdomain, path, or (later) custom domain and needs
  authorization scoped to that portal, not derived from a spoofable URL param.
- **Master Admin** — needs root FuzeFront to keep working as "just another portal" (the seeded root
  portal from FF-EPIC-09) and needs suspended portals to fail closed.

### ✅ Features In Scope
- [ ] Feature 1: `resolvePortalContext` middleware — Host / `/p/<slug>` path / custom domain →
      `req.portal`, fail-closed (unknown → root/404, suspended → 403).
- [ ] Feature 2: `GET /api/v1/portal/context` boot endpoint (portal id, slug, branding, identity
      policy, auth entry).
- [ ] Feature 3: Frontend shell boots from the context endpoint instead of hardcoded values.
- [ ] Feature 4: JWT + session portal binding (`req.user.portalId`, `portal_id` JWT claim,
      `sessions.active_organization_id`).

### 🚫 Out of Scope
- Custom-domain verification/TLS issuance — FF-EPIC-16 (this epic only resolves against
  already-verified `portal_domains` rows).
- Rendering the branding itself (logo/colors/theme tokens) — FF-EPIC-13 consumes this epic's boot data.

### 🏗️ High-Level Architecture Notes
> Extends the existing locked-app-mode Host→app resolution design (`docs/planning/locked-app-mode.md`)
> to Host→portal, backed by the `portals`/`portal_domains` schema seeded and provisioned in FF-EPIC-09.
> Resolution is cached in-memory with a TTL (invalidated on suspend/resume). `authenticateToken` is
> extended to populate `req.user.portalId`; sessions bind `active_organization_id` and a `portal_id`
> claim is added to the platform JWT so scoping is derived from the signed token, never a
> client-supplied URL/query parameter. Ingress terminates TLS and forwards the Host header unmodified
> (`deploy/helm/fuzefront/templates/ingress.yaml`); the shell's current hardcoded values live in
> `frontend/src/components/TopBar.tsx`, `frontend/src/platform/appRegistry.tsx`, and
> `frontend/src/components/FederatedAppLoader.tsx` (hardcoded `tenantId`), all of which this epic
> replaces with data sourced from `GET /api/v1/portal/context`.

### 📊 Success Metrics
| Metric | Current Baseline | Target |
|--------|-----------------|--------|
| Requests resolved to the correct portal (subdomain/path/custom/root) | 0% (no resolver exists) | 100% across the resolution matrix test |
| Shell hardcoded `default-tenant` / tenantId occurrences | N (current hardcoded values) | 0 |
| Scoping decisions derived from token vs. URL param | URL param (spoofable) | Token-derived (`portal_id` JWT claim) |

### 📋 Child Stories
| Story ID | Summary | Status |
|----------|---------|--------|
| FF-EPIC-10-S1 | resolvePortalContext middleware (Host/path/custom → req.portal, fail-closed) | Open |
| FF-EPIC-10-S2 | GET /api/v1/portal/context boot endpoint + shell boot | Open |
| FF-EPIC-10-S3 | JWT/session portal binding | Open |

### 🔗 Dependencies
- **Blocked By:** FF-EPIC-09 (needs the `portals`/`portal_domains` schema and at least the seeded root
  portal — plus suspend/resume from FF-EPIC-09-S3 to exercise the 403 path).
- **Blocks:** FF-EPIC-11 (tenant-scoped identity depends on `req.user.portalId` as the scoping source);
  FF-EPIC-13 (branding rendering consumes `GET /portal/context`); FF-EPIC-12 (per-portal app catalog
  filter needs a resolved portal).
- **Related:** FF-EPIC-16 (self-service custom domains extends the `portal_domains` rows this epic
  resolves against, once verification/TLS exist).

### 📎 References
- `docs/planning/locked-app-mode.md`
- `deploy/helm/fuzefront/templates/ingress.yaml`
- `frontend/src/components/TopBar.tsx`; `frontend/src/platform/appRegistry.tsx`;
  `frontend/src/components/FederatedAppLoader.tsx`
- `backend/src/services/oidc.ts`; `backend/src/permit/schema.ts`

---

## Stories

### 📖 Story: Every request resolves to the correct portal from Host, path, or custom domain

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-10-S1 |
| **Parent Epic** | FF-EPIC-10 — Portal Context Resolution & Boot |
| **Priority** | Critical |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 12 (8 BE + 4 QA) |
| **Tech Layers** | Backend |

#### 🧑‍💼 User Story
> As a **Portal End-User** (or any requester), I want every request to resolve to the correct portal
> from its Host header, `/p/<slug>` path, or custom domain, so that the platform can serve many
> isolated tenant portals from one shared deployment instead of assuming a single global FuzeFront.

#### 📌 Background & Context
Extends the existing locked-app-mode Host→app resolution design to Host→portal, backed by the
`portals`/`portal_domains` schema introduced in FF-EPIC-09-S1. This middleware is the single point every
later story (S2, S3, and all of FF-EPIC-11/12/13) reads `req.portal` from.

#### ✅ Acceptance Criteria
1. **Given** a request arrives at a Host matching a `portal_domains` row of kind `subdomain` or
   `custom` **When** `resolvePortalContext` runs **Then** `req.portal` is set to that portal and
   downstream handlers see it.
2. **Given** a request arrives at the root host with path `/p/<slug>` **When** no host-based match
   exists **Then** the middleware resolves the portal by slug from the path.
3. **Edge case:** **Given** a request whose Host and path match no known portal **When** resolution
   runs **Then** it falls back to the root portal for shell/UI routes (or returns 404 for API routes
   that require an explicit portal) — never silently leaking another tenant's context; behavior is
   fail-closed, not fail-open.
4. **Error case:** **Given** the resolved portal's status is `suspended` **When** any request targets
   it **Then** the middleware short-circuits with 403 before the request reaches business logic.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] Resolution-matrix unit + integration tests passing (coverage ≥ 80%)
- [ ] In-memory cache + TTL verified, including invalidation on suspend/resume
- [ ] Fail-closed behavior verified for unknown host and suspended portal
- [ ] PM verified all Acceptance Criteria on staging

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| Backend | middleware: match portal_domains by host, else /p/<slug>, else root; suspended→403; cache+TTL | 8 | Open |
| QA | resolution matrix test: subdomain/path/custom/unknown/suspended | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-09-S1 (schema); FF-EPIC-09-S3 (suspend/resume API, needed to exercise the
  403 path in QA).
- **Blocks:** FF-EPIC-10-S2, FF-EPIC-10-S3.

#### ⚠️ Risks & Assumptions
- **Assumption:** The Host header is trustworthy behind the ingress — TLS terminates and the Host is
  forwarded unmodified (`deploy/helm/fuzefront/templates/ingress.yaml`).
- **Risk:** In-memory cache staleness after a portal is suspended — mitigate with a short TTL plus
  explicit cache-bust triggered by the FF-EPIC-09-S3 suspend/resume endpoint.

#### 📎 References
- `docs/planning/locked-app-mode.md`; `deploy/helm/fuzefront/templates/ingress.yaml`.

---

### 📖 Story: The shell boots its identity and branding from a single portal-context endpoint

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-10-S2 |
| **Parent Epic** | FF-EPIC-10 — Portal Context Resolution & Boot |
| **Priority** | Critical |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 16 (4 BE + 8 FE + 4 QA) |
| **Tech Layers** | Full-Stack |

#### 🧑‍💼 User Story
> As a **Portal End-User**, I want the shell to boot its branding and identity entry point from a
> single portal-context endpoint (not hardcoded values), so that visiting any tenant portal shows that
> portal's correct identity from first paint.

#### 📌 Background & Context
Today `TopBar.tsx`, `appRegistry.tsx`, and `FederatedAppLoader.tsx` hardcode branding and a
`default-tenant`. This story adds the public `GET /api/v1/portal/context` boot endpoint (reading
`req.portal` set by S1) and rewires the shell to consume it.

#### ✅ Acceptance Criteria
1. **Given** the resolved portal from S1 **When** the frontend calls `GET /api/v1/portal/context` on
   boot **Then** it receives portal id, slug, branding, identity policy, and auth entry point, matching
   the published OpenAPI schema.
2. **Given** the shell receives a successful context response **When** it renders **Then** it uses that
   data instead of the previously hardcoded `default-tenant`/branding values in `TopBar.tsx` and
   `appRegistry.tsx`.
3. **Edge case:** **Given** the context request is slow **When** the shell boots **Then** a loading
   state is shown (no flash of hardcoded/default branding).
4. **Error case:** **Given** the context request fails (network error, or the resolved portal is
   403/404) **When** the shell boots **Then** an explicit error/suspended state is rendered — never a
   silent fallback to another portal's branding.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] Backend unit + RTL UI tests passing (coverage ≥ 80%)
- [ ] Endpoint documented in the platform OpenAPI spec
- [ ] No sensitive data beyond branding/identity-policy/auth-entry exposed on this public endpoint
      (appsec-reviewer pass)
- [ ] Loading/error/suspended states verified — console-clean per `ui-runtime-validation`
- [ ] PM verified all Acceptance Criteria on staging

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| Backend | public context endpoint (portal id, slug, branding, identity policy, auth entry) + OpenAPI | 4 | Open |
| Frontend | shell boots from context instead of hardcoded values; provider + loading/error states | 8 | Open |
| QA | endpoint contract + shell boot states | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-10-S1.
- **Blocks:** FF-EPIC-13-S2 (branding boot in shell builds directly on this provider).

#### ⚠️ Risks & Assumptions
- **Assumption:** This endpoint is intentionally public/unauthenticated — it must render before login
  (e.g., a branded login screen) but must not leak sensitive data beyond branding/identity-policy/auth
  entry.
- **Risk:** Over-exposing internal `portals` row fields in the public payload — mitigate with an
  explicit response DTO, never a raw row dump.

#### 📎 References
- `frontend/src/components/TopBar.tsx`; `frontend/src/platform/appRegistry.tsx`.

---

### 📖 Story: Authorization is scoped by a signed portal-bound token, not a client-supplied URL param

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-10-S3 |
| **Parent Epic** | FF-EPIC-10 — Portal Context Resolution & Boot |
| **Priority** | Critical |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 12 (8 BE + 4 QA) |
| **Tech Layers** | Backend |

#### 🧑‍💼 User Story
> As a **Portal Admin** (or any authenticated user), I want my session and JWT to carry my portal
> binding, so that authorization and scoping are derived from a signed token rather than a
> client-supplied URL parameter that could be spoofed.

#### 📌 Background & Context
Today the backend derives tenant only from URL params, which is spoofable. This story extends
`authenticateToken` (and the OIDC sync path in `backend/src/services/oidc.ts`) to bind the resolved
portal (from S1) into the session and the platform JWT, closing that gap before FF-EPIC-11 builds
portal-private identity on top of it.

#### ✅ Acceptance Criteria
1. **Given** a user authenticates against a resolved portal **When** `authenticateToken` issues a token
   **Then** it sets `req.user.portalId` and embeds a `portal_id` claim on the platform JWT.
2. **Given** a valid session **When** the user's org context is established **Then**
   `sessions.active_organization_id` is populated consistent with the bound portal's organization.
3. **Edge case:** **Given** a user's JWT `portal_id` claim differs from the currently-resolved-Host
   portal (e.g., a token issued on portal A is presented on portal B's host) **When** the request is
   authorized **Then** it is rejected (re-authentication required) rather than silently scoping to
   whichever portal wins.
4. **Error case:** **Given** a request carries a URL/query param claiming a different portal/org than
   the token's bound portal **When** authorization runs **Then** the token-derived `portalId` wins and
   the mismatched param is ignored or rejected — scoping is never by client-supplied param.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] Unit + integration tests passing, incl. cross-portal token-mismatch case (coverage ≥ 80%)
- [ ] BOLA/authorization verified (appsec-reviewer pass) — scoping-by-token confirmed, not by URL param
- [ ] `sessions.active_organization_id` binding verified against existing session model
- [ ] PM verified all Acceptance Criteria on staging

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| Backend | authenticateToken sets req.user.portalId/org; add portal_id JWT claim; populate sessions.active_organization_id | 8 | Open |
| QA | token/session binding + scoping-by-token (not URL param) test | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-10-S1.
- **Blocks:** FF-EPIC-11 (tenant-scoped identity relies on `req.user.portalId` as the scoping source).

#### ⚠️ Risks & Assumptions
- **Assumption:** Auth already funnels through a single `authenticateToken` middleware that can be
  extended, not multiple divergent auth paths.
- **Risk:** Tokens issued before this epic ships lack the `portal_id` claim — mitigate by treating a
  missing claim as the root portal during rollout, gated behind `fuzefront.platform.multi-tenant-portals`
  (FF-EPIC-09-S4).

#### 📎 References
- `backend/src/services/oidc.ts`; `backend/src/permit/schema.ts`.
