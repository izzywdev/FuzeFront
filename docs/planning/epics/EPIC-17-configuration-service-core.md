---
key: FF-EPIC-17
title: Configuration Service Core & Resolution — namespaced hierarchical config with typed key metadata
label: [fuzefront, platform, config-management, contract-first, permit-gated, feature-flag, paginated, needs-jira-upload]
github: TBD
jira: FFRNT-150
status: ready
priority: High
domain: Platform
---

## 🎯 Epic: Configuration Service Core & Resolution

| Field | Value |
|-------|-------|
| **Epic ID** | FF-EPIC-17 |
| **Domain** | Platform |
| **Priority** | High |
| **Owner** | Orchestrator (delegated to `contract-designer` → `backend-engineer` + `database-engineer` + `test-engineer` + `devops-engineer`) |
| **Target Release** | Next deploy window |
| **Effort Estimate** | L |

---

### 📌 Problem Statement
> FuzeFront has no generic place to store settings. Every feature that needs one invents its own
> table — `sessions.active_organization_id`, `portals.branding`, per-service env vars — so there is
> no shared notion of a typed key, a declared default, an org-level override, or a setting a tenant
> may see but not change. A super-tenant cannot set a value for its tenants; a tenant cannot layer
> its own default under a user's personal preference; nothing can be marked "system, do not touch".
> Every new feature that needs configuration therefore pays the same cost again, and each one
> invents slightly different semantics, so there is no consistent answer to "where did this value
> come from and who is allowed to change it".

### 🎯 Goal
> A standalone `config-service` stores namespaced, hierarchical key/value configuration with rich
> per-key metadata, and resolves a value for any scope down the chain
> `default → platform → portal → org → user`, returning not just the value but its **provenance**
> (which scope supplied it, whether an ancestor locked it, whether the caller may edit it).

### 👥 Target Personas
- **Platform / Master Admin** — sets platform-wide defaults and locks values that tenants must not change.
- **Portal Admin (super-tenant / reseller)** — sets values for the orgs inside their portal, optionally locked.
- **Org Admin** — sets org defaults for their members, within what the portal allows.
- **End User** — sets personal preferences, and can see which of their settings are inherited or locked.
- **App Developer** — declares a namespace and its key definitions so their app's settings are managed like everyone else's.

### ✅ Features In Scope
- [ ] Feature 1: Frozen OpenAPI contract for the config service + generated `@fuzefront/config-client` (Node) package.
- [ ] Feature 2: Catalog schema — `config_namespaces` + `config_key_definitions` carrying display name, description, value type, validation schema, default, allowed scopes, and the `is_system` / `is_hidden` / `is_secret` / `is_readonly` / `precedence` flags.
- [ ] Feature 3: Values schema — `config_values`, sparse per-scope overrides with `is_locked` + `lock_reason`.
- [ ] Feature 4: Resolution engine — walks `default → platform → portal → org → user`, honours per-key `precedence`, short-circuits at the outermost lock, and returns provenance per key.
- [ ] Feature 5: Read API — effective config for a scope, plus paginated catalog listing per the `gate-pagination` standard.
- [ ] Feature 6: Write API — set / reset-to-inherited / lock / unlock, bulk transactional, Permit-gated per scope.
- [ ] Feature 7: Service scaffold, Dockerfile, Helm chart and `release.yml` image-matrix entry.
- [ ] Feature 8: Feature flag `fuzefront.platform.config-management`, default OFF.
- [ ] Feature 9: Served **Swagger UI** + the OpenAPI spec published as JSON and YAML, with drift between the committed and served spec failing CI.
- [ ] Feature 10: **Python client package** for Python microservices, generated from the same frozen contract as the Node client, with cross-client parity enforced in CI.
- [ ] Feature 11: **Consumer integration guide** — how to declare keys and read/write configuration from Node and Python.

### 🚫 Out of Scope
- Secrets, audit history, change events, import/export and presets — all delivered by FF-EPIC-18.
- Any configuration UI — delivered by FF-EPIC-19, which is design-first and gated on approved frames.
- Migrating existing ad-hoc settings tables onto this service — a follow-up epic once the service is live.
- Feature flags. **Unleash owns flags**; this service must not become a second flag system (see Architecture Notes).

### 🏗️ High-Level Architecture Notes
> New standalone `services/config-service`, following the shape of the existing nine services
> (own OpenAPI contract, own DB schema and migrations, own Helm chart, own generated client package).
>
> **Two tables, not one.** A config system is a catalog of key *definitions* (metadata, shipped by the
> owning app) and a sparse set of *values* (overrides per scope). The split is what makes "system key",
> "hidden", "locked" and validation expressible at all — a plain KV store cannot say *"this key exists,
> is a boolean, and only the platform may write it."*
>
> **`is_locked` is the "inherited with non-edit permission" requirement.** A value locked at portal
> level beats every org/user value beneath it *and* is returned with `editable: false`, so the editor
> can grey the input and badge it "Locked by <scope>". This is what lets a super-tenant set values for
> tenants that they cannot modify.
>
> **`precedence` is the reverse-order hook.** Each key definition carries
> `most-specific-wins` (default) or `least-specific-wins`. Storing the ordering rule per key makes the
> stated future requirement — *org-level settings overriding user-specific ones* — a value change
> rather than a migration plus a resolver rewrite. Both branches ship now; the second is ~10 lines
> today and a breaking change later. It is deliberately distinct from `is_locked`: locking hard-pins
> one value, precedence is the ordering rule.
>
> **Resolution must return provenance, not just a value.** Without `source`, `locked` and `editable`
> per key, the editor in FF-EPIC-19 cannot render "inherited from Organization" or decide whether to
> disable an input — which is most of what that UI is.
>
> **Boundary with feature flags.** Per the repo overlay, Unleash owns feature flags and
> `feature-flags-engineer` owns the taxonomy. The split is: **config = durable, typed, user/tenant-authored
> settings; flags = rollout, targeting, kill-switches, experiments, authored by engineering.** Saying this
> explicitly is load-bearing — without it this service accretes flag-shaped keys and the family ends up
> with two flag systems and no clear owner. The config service's own rollout is gated by
> `fuzefront.platform.config-management`, default OFF.
>
> Permit remains the authorization boundary for every write: who may set a key at org level, and who may
> lock it, is a Permit decision, never a flag and never a UI affordance.

### 📊 Success Metrics
| Metric | Current Baseline | Target |
|--------|-----------------|--------|
| Features needing a bespoke settings table | Every one | 0 for new features — they register a namespace instead |
| Resolution responses carrying provenance (`source`/`locked`/`editable`) | N/A | 100% of effective-config reads |
| A value locked at portal level being writable by an org/user below it | N/A (unenforceable today) | 0 — rejected 403 at the API, not just hidden in UI |
| `gate-pagination` + BOLA no-leak on catalog + values endpoints | New | Green |
| Cross-scope leak (org A reading org B's values) | N/A | 0 |

### 📋 Child Stories
| Story ID | Jira | Summary | Status |
|----------|------|---------|--------|
| FF-EPIC-17-S1 | [FFRNT-153](https://fuzefront.atlassian.net/browse/FFRNT-153) | Frozen OpenAPI contract + `@fuzefront/config-client` (Node) | Open |
| FF-EPIC-17-S2 | [FFRNT-154](https://fuzefront.atlassian.net/browse/FFRNT-154) | Catalog schema — namespaces + key definitions | Open |
| FF-EPIC-17-S3 | [FFRNT-155](https://fuzefront.atlassian.net/browse/FFRNT-155) | Values schema — sparse per-scope overrides + locking | Open |
| FF-EPIC-17-S4 | [FFRNT-156](https://fuzefront.atlassian.net/browse/FFRNT-156) | Resolution engine with provenance | Open |
| FF-EPIC-17-S5 | [FFRNT-157](https://fuzefront.atlassian.net/browse/FFRNT-157) | Read API — effective config + paginated catalog listing | Open |
| FF-EPIC-17-S6 | [FFRNT-158](https://fuzefront.atlassian.net/browse/FFRNT-158) | Write API — set / reset / lock, bulk transactional, Permit-gated | Open |
| FF-EPIC-17-S7 | [FFRNT-159](https://fuzefront.atlassian.net/browse/FFRNT-159) | Service scaffold, Helm chart, release image matrix | Open |
| FF-EPIC-17-S8 | [FFRNT-255](https://fuzefront.atlassian.net/browse/FFRNT-255) | Feature flag `fuzefront.platform.config-management` | Open |
| FF-EPIC-17-S9 | [FFRNT-258](https://fuzefront.atlassian.net/browse/FFRNT-258) | Serve Swagger UI + publish the OpenAPI spec | Open |
| FF-EPIC-17-S10 | [FFRNT-259](https://fuzefront.atlassian.net/browse/FFRNT-259) | Python client package for Python microservices | Open |
| FF-EPIC-17-S11 | [FFRNT-260](https://fuzefront.atlassian.net/browse/FFRNT-260) | Consumer integration guide | Open |

### 🔗 Dependencies
- **Blocked By:** FF-EPIC-09 (`portals` table — the portal scope tier FKs against it); FF-EPIC-10 (portal/org context resolution supplies the scope chain for a request).
- **Blocks:** FF-EPIC-18 (all of it), FF-EPIC-19 (all of it).
- **Related:** FF-EPIC-12 (`portal_apps.config` is a per-portal app config blob that should migrate onto this service once it exists).

### 📎 References
- Existing service shape to follow: `services/app-registry-service/`, `services/billing-service/`
- Permit schema: `backend/src/permit/schema.ts`
- Feature-flags skill (the boundary this epic must not cross): `.claude/skills/feature-flags/`
- Portals/org model: FF-EPIC-09, FF-EPIC-10

---

## Stories

### 📖 Story: The config API is frozen as a contract before anyone implements against it

| Field | Value |
|-------|-------|
| **Jira** | [FFRNT-153](https://fuzefront.atlassian.net/browse/FFRNT-153) |
| **Story ID** | FF-EPIC-17-S1 |
| **Parent Epic** | FF-EPIC-17 — Configuration Service Core & Resolution |
| **Priority** | High |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 8 (8 Contract) |
| **Tech Layers** | Contract |

#### 🧑‍💼 User Story
> As the **Orchestrator**, I want **the config service's API and event contract frozen and published as
> a generated client** so that **the backend, UI and test streams can fan out in parallel against one
> agreed surface instead of discovering each other's assumptions at integration time**.

#### 📌 Background & Context
This is the sequential gate for the whole epic, per the repo's contract-first convention —
`contract-designer`, not `backend-engineer`, owns the spec, exactly as `product-designer` (not the
implementer) owns the frames. The contract must express the resolution response including provenance,
because that shape is what FF-EPIC-19's editor is built against.

**This one frozen spec has three consumers**, all generated from it and none hand-maintained
alongside it:

| Consumer | Delivered by |
|---|---|
| **Node** — `@fuzefront/config-client` | this story |
| **Python** — client package for Python microservices | FF-EPIC-17-S10 |
| **Humans** — served Swagger UI + published spec | FF-EPIC-17-S9 |

Usage of all three is documented by FF-EPIC-17-S11. Freeze the spec with all three in mind: a
contract shaped only around the Node client generates awkwardly for Python and reads poorly in
Swagger, and by then it is frozen.

#### ✅ Acceptance Criteria
1. **Given** the contract work is complete **When** `services/config-service/openapi.yaml` is linted **Then** it defines the catalog, effective-config read, and value write/lock endpoints, and passes the repo's OpenAPI lint gate.
2. **Given** the frozen spec **When** the client is generated **Then** `@fuzefront/config-client` builds and publishes privately, and its `EffectiveConfigEntry` type carries `value`, `source`, `locked`, `editable` and the key `definition`.
3. **Edge case:** **Given** a key whose `precedence` is `least-specific-wins` **When** the contract describes the resolution response **Then** the schema is identical — precedence changes which scope wins, not the response shape, so no consumer needs to branch on it.
4. **Error case:** **Given** a write to a key locked by an ancestor scope **When** the contract defines that path **Then** it specifies a **409** with a body naming the locking scope — not a bare 403 — so the UI can render "Locked by <scope>" rather than a generic denial.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] OpenAPI lint gate green
- [ ] `@fuzefront/config-client` generated, builds, and publishes privately to GitHub Packages
- [ ] Contract PR merged before any implementation story starts
- [ ] PM verified all Acceptance Criteria

#### 📋 Sub-Tasks
| Type | Summary | Assignee | Points | Status |
|------|---------|----------|--------|--------|
| Contract | OpenAPI 3.1 spec for catalog / effective-config / value-write endpoints, incl. provenance + 409 lock shape | — | 5 | Open |
| Contract | Generate + publish `@fuzefront/config-client` | — | 3 | Open |

#### 🔗 Dependencies
- **Blocks:** every other story in FF-EPIC-17, and all of FF-EPIC-18 / FF-EPIC-19.

#### ⚠️ Risks & Assumptions
- **Assumption:** The scope chain is fixed at `platform → portal → org → user` for v1; adding a team tier later is an additive enum value, not a reshape.
- **Risk:** Freezing the contract before the resolver is built could miss a field the resolver needs — mitigate by prototyping the resolution response against two real key shapes (a locked enum, a secret) before freezing.

#### 📎 References
- Existing contracts to follow: `services/billing-service/openapi.yaml`, `packages/security/openapi.yaml`

---

### 📖 Story: Config keys are declared with the metadata that makes them manageable

| Field | Value |
|-------|-------|
| **Jira** | [FFRNT-154](https://fuzefront.atlassian.net/browse/FFRNT-154) |
| **Story ID** | FF-EPIC-17-S2 |
| **Parent Epic** | FF-EPIC-17 — Configuration Service Core & Resolution |
| **Priority** | High |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 12 (8 BE + 4 QA) |
| **Tech Layers** | Backend |

#### 🧑‍💼 User Story
> As an **App Developer**, I want **to declare my app's config keys with a display name, description,
> type, validation rule, default and visibility flags** so that **the settings editor can render and
> validate my settings without me building a bespoke UI or table for them**.

#### 📌 Background & Context
The catalog half of the two-table design. Without declared metadata there is no way to express a valid
value set, a system key, or a hidden key — the editor would have nothing to render and nothing to
validate against.

#### ✅ Acceptance Criteria
1. **Given** the migration runs **When** it completes **Then** `config_namespaces` and `config_key_definitions` exist, with `(namespace_id, key)` unique and columns for `display_name`, `description`, `help_url`, `category`, `sort_order`, `tags`, `value_type`, `schema`, `default_value`, `allowed_scopes`, `is_system`, `is_hidden`, `is_secret`, `is_readonly`, `precedence`, `requires_restart`, `deprecated_at`, `replaced_by`.
2. **Given** a key definition with `value_type = 'enum'` and an `enum_values` list **When** a value outside that list is submitted **Then** validation rejects it with a message naming the allowed values.
3. **Edge case:** **Given** a key marked `is_system = true` **When** any non-platform principal attempts to modify its *metadata* **Then** the write is refused — system-key metadata is immutable, which is the whole point of the flag.
4. **Error case:** **Given** a key definition whose `default_value` does not satisfy its own `schema` **When** the definition is created or updated **Then** it is rejected at write time, so an unsatisfiable key can never enter the catalog.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] Unit tests written and passing (coverage ≥ 80%)
- [ ] Migration is idempotent and documented
- [ ] Functional tests passing on staging
- [ ] PM verified all Acceptance Criteria on staging
- [ ] Deployed to staging and smoke-tested

#### 📋 Sub-Tasks
| Type | Summary | Assignee | Points | Status |
|------|---------|----------|--------|--------|
| Backend | Migrations for `config_namespaces` + `config_key_definitions`; JSON-Schema validation helper | — | 8 | Open |
| QA | Definition validation tests: enum rejection, self-inconsistent default, system-key metadata immutability | — | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-17-S1 (contract).
- **Blocks:** FF-EPIC-17-S3, S4.

#### ⚠️ Risks & Assumptions
- **Assumption:** JSON Schema is sufficient for validation; no custom per-key validator plugins in v1.
- **Risk:** `value_type` and `schema` can disagree (e.g. type `number` with a string schema) — mitigate by deriving a base schema from `value_type` and intersecting, rather than trusting the two to be kept in sync by hand.

#### 📎 References
- App registry (for `owner_app_id` FK): `backend/applications/src/app-registry/service.ts`

---

### 📖 Story: A value can be set at any tier without overwriting the tiers around it

| Field | Value |
|-------|-------|
| **Jira** | [FFRNT-155](https://fuzefront.atlassian.net/browse/FFRNT-155) |
| **Story ID** | FF-EPIC-17-S3 |
| **Parent Epic** | FF-EPIC-17 — Configuration Service Core & Resolution |
| **Priority** | High |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 10 (6 BE + 4 QA) |
| **Tech Layers** | Backend |

#### 🧑‍💼 User Story
> As a **Portal Admin**, I want **to set a value for my portal without erasing the platform default
> beneath it or the org/user overrides above it** so that **each tier keeps its own intent and I can
> remove my override later and fall back cleanly**.

#### 📌 Background & Context
The values half of the design: sparse overrides, one row per `(definition, scope_type, scope_id)`, plus
the `is_locked` flag that makes a tier's value binding on everything below it.

#### ✅ Acceptance Criteria
1. **Given** the migration runs **When** it completes **Then** `config_values` exists with `definition_id`, `scope_type`, `scope_id`, `value`, `is_locked`, `lock_reason`, `set_by_user_id`, timestamps, and a unique constraint on `(definition_id, scope_type, scope_id)`.
2. **Given** a platform default and an org override for the same key **When** both are stored **Then** they coexist as two rows; removing the org row leaves the platform row untouched.
3. **Edge case:** **Given** a key whose `allowed_scopes` excludes `user` **When** a user-scope value is written for it **Then** the write is refused — a key that is not user-settable cannot acquire a user row by any path.
4. **Error case:** **Given** a `scope_id` that does not resolve to a real portal/org/user **When** a value is written **Then** the FK violation is mapped to a clear error rather than surfacing as an unhandled DB exception.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] Unit tests written and passing (coverage ≥ 80%)
- [ ] Migration is idempotent and documented
- [ ] Functional tests passing on staging
- [ ] PM verified all Acceptance Criteria on staging
- [ ] Deployed to staging and smoke-tested

#### 📋 Sub-Tasks
| Type | Summary | Assignee | Points | Status |
|------|---------|----------|--------|--------|
| Backend | Migration `config_values` + storage layer honouring `allowed_scopes` | — | 6 | Open |
| QA | Sparse-override coexistence, `allowed_scopes` refusal, FK-error mapping tests | — | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-17-S2 (definitions to FK against), FF-EPIC-09-S1 (`portals`).
- **Blocks:** FF-EPIC-17-S4.

#### ⚠️ Risks & Assumptions
- **Assumption:** `scope_id` can be a single nullable UUID column because portal/org/user ids do not collide.
- **Risk:** A polymorphic `scope_id` cannot carry a real FK to three different tables — mitigate with a validation trigger or service-layer existence check, and say which was chosen in the migration's comment rather than leaving it implicit.

#### 📎 References
- Portals table: FF-EPIC-09-S1

---

### 📖 Story: Resolving a key says where the value came from and whether it can be changed

| Field | Value |
|-------|-------|
| **Jira** | [FFRNT-156](https://fuzefront.atlassian.net/browse/FFRNT-156) |
| **Story ID** | FF-EPIC-17-S4 |
| **Parent Epic** | FF-EPIC-17 — Configuration Service Core & Resolution |
| **Priority** | High |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 14 (10 BE + 4 QA) |
| **Tech Layers** | Backend |

#### 🧑‍💼 User Story
> As an **End User**, I want **the settings I see to show which ones are mine, which are inherited from
> my org or portal, and which are locked** so that **I understand why a setting has its value and why
> some of them cannot be edited**.

#### 📌 Background & Context
The core algorithm. Walks `default → platform → portal → org → user`, applies per-key `precedence`,
and short-circuits at the outermost `is_locked`. Returns provenance because a bare value is not enough
to build the editor.

#### ✅ Acceptance Criteria
1. **Given** a key with a platform default and an org override **When** a user in that org resolves it **Then** the org value is returned with `source.scope_type = 'org'` and `editable: true` (assuming the user may write at user scope).
2. **Given** a key locked at portal level **When** any org or user beneath resolves it **Then** the portal value is returned with `locked: true` and `editable: false`, regardless of any org/user rows that exist beneath it.
3. **Edge case:** **Given** a key whose `precedence` is `least-specific-wins` **When** both a platform value and a user value exist **Then** the *platform* value wins — the reverse-order case works end to end, not merely as an unused column.
4. **Error case:** **Given** a stored value that no longer validates against its definition (the definition's schema changed after the value was written) **When** the key is resolved **Then** the default is returned with a warning in the response, rather than the request failing — a stale value must not break a consumer's boot.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] Unit tests written and passing (coverage ≥ 80%)
- [ ] Both `precedence` directions explicitly tested
- [ ] Functional tests passing on staging
- [ ] PM verified all Acceptance Criteria on staging
- [ ] Deployed to staging and smoke-tested

#### 📋 Sub-Tasks
| Type | Summary | Assignee | Points | Status |
|------|---------|----------|--------|--------|
| Backend | Resolver: 4-tier walk, `precedence` branch, lock short-circuit, provenance assembly, invalid-value fallback | — | 10 | Open |
| QA | Resolution matrix tests across all tiers × both precedence directions × locked/unlocked × invalid-stored-value | — | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-17-S3.
- **Blocks:** FF-EPIC-17-S5, S6; FF-EPIC-19-S3.

#### ⚠️ Risks & Assumptions
- **Assumption:** A request's portal/org context is already resolved by FF-EPIC-10's middleware and can be trusted as the scope chain.
- **Risk:** Resolving key-by-key produces N+1 queries for a full namespace — mitigate by resolving a whole namespace in one query set from the start, since the editor always loads a namespace at a time.

#### 📎 References
- Portal context resolution: FF-EPIC-10-S1

---

### 📖 Story: Consumers read a scope's effective configuration in one call

| Field | Value |
|-------|-------|
| **Jira** | [FFRNT-157](https://fuzefront.atlassian.net/browse/FFRNT-157) |
| **Story ID** | FF-EPIC-17-S5 |
| **Parent Epic** | FF-EPIC-17 — Configuration Service Core & Resolution |
| **Priority** | High |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 10 (6 BE + 4 QA) |
| **Tech Layers** | Backend |

#### 🧑‍💼 User Story
> As an **App Developer**, I want **one call that returns my namespace's fully-resolved configuration for
> the current scope** so that **my app boots with correct settings without N round-trips or its own
> merge logic**.

#### 📌 Background & Context
Exposes S4 over HTTP, plus the catalog listing the admin UI needs. Both are list endpoints and must
satisfy the repo's `gate-pagination` standard.

#### ✅ Acceptance Criteria
1. **Given** an authenticated caller **When** they GET the effective config for a namespace **Then** every non-hidden key the caller may see is returned, each with value + provenance, in one response.
2. **Given** a catalog with more definitions than one page **When** the catalog is listed **Then** results paginate per `gate-pagination` (cursor-based), with no duplicated or skipped rows.
3. **Edge case:** **Given** keys marked `is_hidden = true` **When** the effective config is read by a normal caller **Then** those keys are absent entirely — not returned-and-flagged, since a hidden key that ships to the browser is not hidden.
4. **Error case:** **Given** a caller requests a scope they have no Permit authority over (another org's config) **When** the read is made **Then** it returns 403 and leaks nothing about whether that scope exists.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] Unit tests written and passing (coverage ≥ 80%)
- [ ] Endpoints documented in OpenAPI
- [ ] `gate-pagination` green on all listing endpoints
- [ ] BOLA/authorization verified (appsec-reviewer pass)
- [ ] PM verified all Acceptance Criteria on staging
- [ ] Deployed to staging and smoke-tested

#### 📋 Sub-Tasks
| Type | Summary | Assignee | Points | Status |
|------|---------|----------|--------|--------|
| Backend | Effective-config + catalog-listing routes, Permit-gated, cursor-paginated | — | 6 | Open |
| QA | Pagination contract test, hidden-key absence test, cross-scope 403 no-leak test | — | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-17-S4.
- **Blocks:** FF-EPIC-19-S3, S4.

#### ⚠️ Risks & Assumptions
- **Assumption:** Permit already models portal-admin / org-admin / platform-admin authority distinctly, reusing FF-EPIC-11's derivation.
- **Risk:** The effective-config endpoint is on every app's boot path, so a slow resolver becomes a platform-wide latency floor — mitigate by treating a namespace resolve as a single query and measuring it under load before rollout.

#### 📎 References
- Permit schema: `backend/src/permit/schema.ts`

---

### 📖 Story: Admins change values, reset them, and lock them for the tiers below

| Field | Value |
|-------|-------|
| **Jira** | [FFRNT-158](https://fuzefront.atlassian.net/browse/FFRNT-158) |
| **Story ID** | FF-EPIC-17-S6 |
| **Parent Epic** | FF-EPIC-17 — Configuration Service Core & Resolution |
| **Priority** | High |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 14 (10 BE + 4 QA) |
| **Tech Layers** | Backend |

#### 🧑‍💼 User Story
> As a **Portal Admin**, I want **to set values for my portal and lock the ones my tenants must not
> change** so that **I can enforce policy across every org beneath me without relying on them to leave
> a setting alone**.

#### 📌 Background & Context
The write half. Includes reset-to-inherited as a distinct operation from "set to the parent's current
value" — the first keeps tracking the parent, the second pins a copy — and bulk writes, because a
settings page saves many keys and must not half-apply.

#### ✅ Acceptance Criteria
1. **Given** an admin with Permit authority at a scope **When** they set a value there **Then** it is validated against the key's schema, stored, and reflected in the next effective-config read.
2. **Given** a scope with an override **When** the admin resets it **Then** the row is removed and the key resolves from its parent again — distinct from writing the parent's current value, which would pin it.
3. **Edge case:** **Given** a page saving 20 keys where key 17 fails validation **When** the bulk write is submitted **Then** **no** key is written — the batch is atomic, so a settings page never half-saves.
4. **Error case:** **Given** a key locked at portal level **When** an org admin beneath attempts to write it **Then** the API returns **409** naming the locking scope, and the stored value is unchanged — enforced server-side, not merely disabled in the UI.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] Unit tests written and passing (coverage ≥ 80%)
- [ ] Endpoints documented in OpenAPI
- [ ] BOLA/authorization verified (appsec-reviewer pass)
- [ ] Write-path authorization tested independently of the UI
- [ ] PM verified all Acceptance Criteria on staging
- [ ] Deployed to staging and smoke-tested

#### 📋 Sub-Tasks
| Type | Summary | Assignee | Points | Status |
|------|---------|----------|--------|--------|
| Backend | set / reset / lock / unlock routes, bulk transactional write, Permit gating per scope | — | 10 | Open |
| QA | Atomic-bulk-failure test, lock-refusal 409 test, reset-vs-pin distinction test, cross-scope write 403 | — | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-17-S4.
- **Blocks:** FF-EPIC-18-S2, FF-EPIC-19-S3.

#### ⚠️ Risks & Assumptions
- **Assumption:** Lock authority is a distinct Permit action from write authority — an org admin may write their own scope without being able to lock it against users.
- **Risk:** Two admins editing the same namespace concurrently silently overwrite each other — mitigate with an optimistic-concurrency version on the write, surfaced as a save-conflict rather than last-write-wins.

#### 📎 References
- Permit schema: `backend/src/permit/schema.ts`

---

### 📖 Story: The config service is deployable like every other FuzeFront service

| Field | Value |
|-------|-------|
| **Jira** | [FFRNT-159](https://fuzefront.atlassian.net/browse/FFRNT-159) |
| **Story ID** | FF-EPIC-17-S7 |
| **Parent Epic** | FF-EPIC-17 — Configuration Service Core & Resolution |
| **Priority** | High |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 8 (8 DevOps) |
| **Tech Layers** | DevOps |

#### 🧑‍💼 User Story
> As a **Platform Operator**, I want **the config service scaffolded, containerised, charted and wired
> into the release image matrix** so that **it deploys through the same GitOps path as every other
> service instead of becoming a special case**.

#### 📌 Background & Context
Chat is the cautionary precedent in this repo: a fully-built, fully-unit-tested backend that was never
deployable because `enabled: false`, no release-matrix entry, and a deleted Argo app were each somebody
else's problem. This story exists so config does not repeat it.

#### ✅ Acceptance Criteria
1. **Given** the scaffold **When** the service is built **Then** `services/config-service` has a Dockerfile, health endpoint, and the standard env/config loading used by the existing services.
2. **Given** the Helm chart **When** it is rendered **Then** `configService.enabled` and its DB connection resolve correctly for both kind-fuzeinfra and the prod values.
3. **Edge case:** **Given** the service starts with its DB unreachable **When** the health probe runs **Then** it reports unhealthy rather than serving requests that would resolve every key to its default — silently serving defaults would look like working software while ignoring all configuration.
4. **Error case:** **Given** the image matrix **When** `release.yml` runs **Then** a `config-service` image is built and tagged — verified by an actual release run, not by the entry merely being present in the file.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] Helm chart renders and `kubeconform` passes
- [ ] `release.yml` image-matrix entry present **and exercised**
- [ ] Deployed to staging and smoke-tested
- [ ] Runbook entry added for the new service

#### 📋 Sub-Tasks
| Type | Summary | Assignee | Points | Status |
|------|---------|----------|--------|--------|
| DevOps | Service scaffold + Dockerfile + health probe | — | 3 | Open |
| DevOps | Helm chart, values for kind + prod, SealedSecret scaffolding for the DB credential | — | 3 | Open |
| DevOps | `release.yml` image-matrix entry + verified release run | — | 2 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-17-S1 (the service needs its contract to scaffold against).
- **Related:** Any FuzeInfra capability request goes via `@claude` cross-repo delegation; this repo never edits FuzeInfra directly.

#### ⚠️ Risks & Assumptions
- **Assumption:** A new Postgres database/role for the service can be provisioned through the existing `database-engineer` bootstrap model.
- **Risk:** `master` is deploy-on-push here, so merging this story ships it — merge in a deploy window, never bot-merge.

#### 📎 References
- Existing charts: `deploy/`, `services/*/Dockerfile`
- Repo overlay deploy rules: `CLAUDE.md`

---

### 📖 Story: Configuration management rolls out behind a feature flag

| Field | Value |
|-------|-------|
| **Jira** | [FFRNT-255](https://fuzefront.atlassian.net/browse/FFRNT-255) |
| **Story ID** | FF-EPIC-17-S8 |
| **Parent Epic** | FF-EPIC-17 — Configuration Service Core & Resolution |
| **Priority** | Medium |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 4 (2 BE + 2 QA) |
| **Tech Layers** | Backend |

#### 🧑‍💼 User Story
> As a **Master Admin**, I want **the config service gated behind a flag, default OFF** so that **it can
> be introduced and withdrawn without a deploy while it is still proving itself on the boot path**.

#### 📌 Background & Context
Per the family flag standard, `fuzefront.platform.config-management` is a **release** flag and therefore
defaults OFF. It gates consumers reading from the service, not the service's own existence.

#### ✅ Acceptance Criteria
1. **Given** the flag is OFF **When** any consumer boots **Then** it uses its existing configuration source and behaves exactly as before — zero regression.
2. **Given** the flag is ON **When** a consumer boots **Then** it resolves settings through the config service.
3. **Edge case:** **Given** the flag is turned ON for a scope with no values set yet **When** config is resolved **Then** every key falls back to its declared default, so switching on cannot leave a consumer with missing settings.
4. **Error case:** **Given** Unleash is unreachable at evaluation time **When** the flag is read **Then** it defaults OFF (prior stable behaviour), consistent with the release-flag convention.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] Unit tests written and passing (coverage ≥ 80%)
- [ ] Flag registered in Unleash under the `<repo>.<domain>.<flag>` taxonomy with owner + removal criterion
- [ ] Both flag states (ON/OFF) explicitly tested
- [ ] `developers` segment strategy attached at creation
- [ ] PM verified all Acceptance Criteria on staging

#### 📋 Sub-Tasks
| Type | Summary | Assignee | Points | Status |
|------|---------|----------|--------|--------|
| Backend | Flag wiring for `fuzefront.platform.config-management`, default OFF | — | 2 | Open |
| QA | Both flag states + Unleash-unreachable fallback test | — | 2 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-17-S5 (there must be something to gate).

#### ⚠️ Risks & Assumptions
- **Assumption:** `@fuzefront/feature-flags` is already available in this repo.
- **Risk:** A flag on the boot path becomes permanent if nobody retires it — record the removal criterion in the Unleash description at creation, not later.

#### 📎 References
- Feature-flags skill: `.claude/skills/feature-flags/`

---

### 📖 Story: The contract is browsable and published, not buried in a YAML file

| Field | Value |
|-------|-------|
| **Jira** | [FFRNT-258](https://fuzefront.atlassian.net/browse/FFRNT-258) |
| **Story ID** | FF-EPIC-17-S9 |
| **Parent Epic** | FF-EPIC-17 — Configuration Service Core & Resolution |
| **Priority** | High |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 8 (5 BE + 3 QA) |
| **Tech Layers** | Backend / DevOps |

#### 🧑‍💼 User Story
> As an **App Developer on any team**, I want **the config service's OpenAPI contract served as
> browsable Swagger UI and published as a machine-readable spec** so that **I can discover and try
> the API without cloning the repo or reading YAML**.

#### 📌 Background & Context
This repo currently holds **six** OpenAPI specs (`services/chat-service`, `services/billing-service`,
`services/payment-service`, `services/app-registry-service`, `packages/auth`, `packages/security`)
and **publishes none of them** — `pages-frames.yml` builds only `design/frames/**`. FF-EPIC-02's gap
analysis recorded that as an open gap for chat. Config is a platform-wide service that every other
service and both client packages consume, so shipping it API-dark would repeat the same mistake at
wider blast radius. This story also establishes the pattern the other five specs can follow.

#### ✅ Acceptance Criteria
1. **Given** the running service **When** a developer opens the docs route **Then** Swagger UI renders the config-service contract and the raw spec is retrievable at a stable machine-readable URL (JSON **and** YAML).
2. **Given** the served spec **When** it is compared to `services/config-service/openapi.yaml` **Then** they are identical — the UI is generated from the committed contract, never hand-maintained alongside it.
3. **Edge case:** **Given** the docs route in production **When** an unauthenticated visitor loads it **Then** exposure follows the decided policy (public contract vs authenticated-only) and the "try it" console cannot be used to make unauthenticated writes.
4. **Error case:** **Given** the spec fails to parse or drifts from the served version **When** CI runs **Then** the build fails rather than shipping a docs page that misdescribes the API — a stale contract is worse than no contract.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] Swagger UI reachable and rendering the real contract
- [ ] Spec served as both JSON and YAML at stable URLs
- [ ] Drift between committed spec and served spec fails CI
- [ ] Docs route's auth posture explicitly decided and documented
- [ ] Same-origin API base respected — no absolute API host hard-coded

#### 📋 Sub-Tasks
| Type | Summary | Assignee | Points | Status |
|------|---------|----------|--------|--------|
| Backend | Serve Swagger UI + JSON/YAML spec endpoints from the committed contract | — | 3 | Open |
| DevOps | Publish the spec alongside the existing Pages pipeline (extend beyond `design/frames/**`) | — | 2 | Open |
| QA | Spec-drift CI check, unauthenticated-exposure behaviour, try-it console cannot write unauthenticated | — | 3 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-17-S1 (the frozen contract), FF-EPIC-17-S7 (something to serve it from).
- **Blocks:** FF-EPIC-17-S11 (the guide links to it).

#### ⚠️ Risks & Assumptions
- **Assumption:** Serving docs from the service itself is preferred over a separate docs site; if the team prefers Pages-only, the drift check (AC4) still applies.
- **Risk:** A "try it" console pointed at production is a live write surface — decide the environment policy before enabling it, not after.

#### 📎 References
- The five other unpublished specs this pattern should later cover.

---

### 📖 Story: Python microservices consume config the same way Node ones do

| Field | Value |
|-------|-------|
| **Jira** | [FFRNT-259](https://fuzefront.atlassian.net/browse/FFRNT-259) |
| **Story ID** | FF-EPIC-17-S10 |
| **Parent Epic** | FF-EPIC-17 — Configuration Service Core & Resolution |
| **Priority** | High |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 10 (7 BE + 3 QA) |
| **Tech Layers** | Backend |

#### 🧑‍💼 User Story
> As a **developer of a Python microservice**, I want **a first-class Python client for the config
> service** so that **Python services consume configuration the same way Node services do, instead of
> hand-rolling HTTP calls and re-implementing resolution semantics**.

#### 📌 Background & Context
`@fuzefront/config-client` (S1) serves Node consumers. Python services have no equivalent, and
without one they will either hand-roll requests — re-implementing caching, retry and provenance
handling inconsistently — or skip the service entirely. Both clients are generated from the **same**
frozen contract so their behaviour cannot diverge.

#### ✅ Acceptance Criteria
1. **Given** the frozen OpenAPI contract **When** the Python client is generated/built **Then** it is published as an installable package exposing the same operations as the Node client: read effective config, read the catalog, set / reset / lock values.
2. **Given** a resolved entry **When** the Python client returns it **Then** it carries the same provenance fields as the Node client (`value`, `source`, `locked`, `editable`, `definition`) with typed access — the two clients present one model, not two dialects.
3. **Edge case:** **Given** the contract changes **When** CI runs **Then** **both** clients are regenerated and a divergence between them fails the build — two clients maintained by hand drift within one release.
4. **Error case:** **Given** the config service is unreachable at boot **When** a Python consumer starts **Then** the client surfaces a typed error and honours the documented fallback (declared defaults), rather than hanging the service's startup indefinitely.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] Unit tests written and passing (coverage ≥ 80%)
- [ ] Package published privately and installable by a Python service
- [ ] Generated from the same contract as the Node client; divergence fails CI
- [ ] Caching + cache-invalidation parity with the Node client (FF-EPIC-18-S4/S5)
- [ ] Usage documented (FF-EPIC-17-S11)

#### 📋 Sub-Tasks
| Type | Summary | Assignee | Points | Status |
|------|---------|----------|--------|--------|
| Backend | Generate + package the Python client from the frozen contract; typed provenance model | — | 5 | Open |
| Backend | Publish pipeline + version pinned to the contract version | — | 2 | Open |
| QA | Cross-client parity test, unreachable-service fallback, typed-error surface | — | 3 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-17-S1 (frozen contract + the Node client it must stay in parity with).
- **Blocks:** FF-EPIC-17-S11.
- **Related:** FF-EPIC-18-S4 / S5 — cache invalidation and ETag polling must be implemented in **both** clients or Python consumers silently serve stale config.

#### ⚠️ Risks & Assumptions
- **Assumption:** There is (or will be) at least one Python consumer; if none exists yet, this still ships so the first one does not hand-roll.
- **Risk:** A private Python package needs a registry story of its own — the repo's publishing convention today is GitHub Packages for npm. Decide the Python distribution channel explicitly rather than assuming parity exists.

#### 📎 References
- Existing Python packaging precedent in this repo: `packages/identity-py/`

---

### 📖 Story: A developer can adopt config management without reading its source

| Field | Value |
|-------|-------|
| **Jira** | [FFRNT-260](https://fuzefront.atlassian.net/browse/FFRNT-260) |
| **Story ID** | FF-EPIC-17-S11 |
| **Parent Epic** | FF-EPIC-17 — Configuration Service Core & Resolution |
| **Priority** | Medium |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 6 |
| **Tech Layers** | Docs |

#### 🧑‍💼 User Story
> As a **developer onboarding a service onto config management**, I want **a guide that shows how to
> declare keys, read resolved values, and handle inheritance and locking** so that **I can adopt the
> service correctly without reading its source**.

#### 📌 Background & Context
A generic config service is only as useful as its adoption. The concepts that most need explaining
are exactly the ones invisible from an endpoint list: the four-tier scope chain, what `precedence`
does, why a value can be read-only, and why config is **not** the feature-flag system.

#### ✅ Acceptance Criteria
1. **Given** the guide **When** a developer reads it **Then** it covers: declaring a namespace and key definitions, reading effective config in **Node and Python**, writing/resetting/locking values, and the meaning of every key-definition flag (`is_system`, `is_hidden`, `is_secret`, `is_readonly`, `precedence`, `requires_restart`).
2. **Given** the guide **When** it explains resolution **Then** it shows the chain `default → platform → portal → org → user` with a worked example including provenance and a locked ancestor.
3. **Edge case:** **Given** the guide **When** it covers caching **Then** it explains that consumers must handle `config.changed` events **and** the ETag/version poll — documenting only the event path produces consumers that silently serve stale config when an event is missed.
4. **Error case:** **Given** a developer looking for feature flags **When** they read the guide **Then** it states plainly that **Unleash owns flags** and this service owns durable typed settings, with the boundary and a pointer to the `feature-flags` skill — undocumented, this service accretes flag-shaped keys.

#### 🔲 Definition of Done
- [ ] Guide published under `docs/guides/`, following `docs/guides/BUILDING_ON_FUZEFRONT.md`
- [ ] Node **and** Python examples, both runnable as written
- [ ] Links to the served Swagger UI (FF-EPIC-17-S9)
- [ ] Feature-flag boundary stated explicitly
- [ ] Reviewed by someone who did **not** write the service

#### 📋 Sub-Tasks
| Type | Summary | Assignee | Points | Status |
|------|---------|----------|--------|--------|
| Docs | Consumer integration guide: key declaration, both client languages, resolution + provenance, caching contract, flag boundary | — | 6 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-17-S1, FF-EPIC-17-S9 (Swagger to link to), FF-EPIC-17-S10 (Python client to document).
- **Related:** FF-EPIC-18-S4 / S5 — the caching contract this guide must describe.

#### ⚠️ Risks & Assumptions
- **Assumption:** `docs-maintainer` owns this; it is written from the frozen contract, not from the implementation.
- **Risk:** A guide written before the clients stabilise goes stale immediately — write it against the frozen contract and verify the examples run before closing.

#### 📎 References
- Consumer-guide convention: `docs/guides/BUILDING_ON_FUZEFRONT.md`
- Feature-flags skill: `.claude/skills/feature-flags/`
