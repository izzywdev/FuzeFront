---
name: microservice-readiness
description: Use to audit whether an existing microservice is fully ready across ALL production dimensions — backend, DB, frontend, npm packages (TS + Python), tests, SDK client, OpenAPI spec, MCP tools, user/org global event handling, Helm deploy, CI gating, and feature flag registration. Returns a per-dimension status table with concrete gap findings and the fix action required for each gap. Not for building new services — see microservice-builder.
---

# microservice-readiness

Audits an **existing** microservice against the full FuzeFront production-readiness checklist. Run this after sprint closure, before flipping `enabled: true` in Helm/feature-flag, and as part of any pre-release gate. The audit produces a **status table** (Complete / Gap / Missing) plus a **fix list** — every gap is a required fix, not a suggestion.

## Inputs

- `<service>` — the service name exactly as it appears in `services/<service>/` and `values.yaml` (e.g. `selection-list-service`)
- `<slug>` — the camelCase key in `values.yaml` (e.g. `selectionListService`)
- `<flag>` — the feature flag key (e.g. `fuzefront.selection-lists.service`)
- `<ts-client-pkg>` — the published TypeScript client package name (e.g. `@fuzeone/selection-list-client`)
- `<ui-pkg>` — the published UI package name if any (e.g. `@fuzeone/selection-lists-ui`)

## Checklist (run every item, report every finding)

### 1. Backend service

Look in `services/<service>/src/`:

- [ ] Entry point (`app.ts`) mounts routes in correct order (health before auth, auth before business)
- [ ] All resource routes present (`lists.ts`, `items.ts`, etc. matching OpenAPI paths)
- [ ] Auth middleware (`middleware/auth.ts`) — stateless JWT verify, no DB round-trip on every request
- [ ] Authz middleware (`middleware/authz.ts`) — Security-API-backed ReBAC (Permit.io via `@fuzefront/auth`); test-mode no-op; flag kill-switch present
- [ ] Service layer extracted from route handlers (not inline controller logic)
- [ ] Health endpoint returning `{ status: "ok" }` at `/health`
- [ ] `Dockerfile` is multi-stage, non-root, copies **all workspace packages** it imports (check `package.json` for `@fuzefront/*` and `@fuzeone/*` deps; each must have a `COPY packages/<pkg>/` stage before `npm install`)

**Fix if missing:** Implement the missing slice; ensure Dockerfile COPY mirrors `packages/identity/` + `packages/feature-flags/` pattern.

---

### 2. Database

Look in `services/<service>/src/db/migrations/`:

- [ ] Core tables migration (resources with typed IDs, org_id isolation, unique constraints)
- [ ] All referenced join/junction tables have migrations
- [ ] Indexes migration (separate, applied after data migrations)
- [ ] All migrations are **ordered** (`YYYYMMDD_NNNNNN_description.ts`) and **idempotent** (`createTableIfNotExists` / `CREATE TABLE IF NOT EXISTS`)
- [ ] Knex config at `src/db/knexfile.ts` (or equivalent)
- [ ] Migration runner at `src/db/migrate.ts` — called on pod start or via Helm pre-sync Job

**Fix if missing:** Add the missing migration in the next numbered slot; test that it runs twice without error.

---

### 3. Frontend UI package

Look in `packages/<service>-ui/`:

- [ ] Package exists with a real `package.json` (`name`, `version`, `publishConfig` → GitHub Packages, `access: "restricted"`)
- [ ] Exports actual React components (not `export {}` placeholder stubs)
- [ ] Vite config present with `lib` mode + `tsconfig.build.json` for `.d.ts` emission
- [ ] All flows from `design/frames/<feature>/manifest.json` are implemented (compare frame inventory vs exported components)
- [ ] `App.tsx` (shell) imports from this package and uses real components, gated by `useFlag('<flag>', false)`
- [ ] Shell nav item (`SidePanel.tsx` or equivalent) is also flag-gated

**Fix if missing:** Implement missing flows; add `FederatedAppErrorBoundary` wrapper on each route; ensure `<Navigate to="/dashboard" replace />` when flag is OFF.

---

### 4. npm Packages (TypeScript + Python)

**TypeScript client** (`<ts-client-pkg>` at `<ts-client-dir>/`):

- [ ] `package.json` has `name`, `version`, `publishConfig.registry: "https://npm.pkg.github.com"`, `publishConfig.access: "restricted"`, `repository` field
- [ ] `src/client.ts` covers all OpenAPI operations (verify against spec path count)
- [ ] `src/types.ts` matches OpenAPI schemas
- [ ] `src/errors.ts` maps HTTP status codes to typed error classes
- [ ] `package.json` has a `lint:contract` script running Spectral against the service OpenAPI spec
- [ ] Published in `release.yml` on version bump (or dedicated publish workflow)

**Python client** (`packages/<service>-client-py/` or similar):

- [ ] Present if the service is consumed by any Python workloads
- [ ] Has a dedicated PyPI publish workflow triggered on tag `<pkg>/v*`

**Fix if missing:** Add the missing package; wire its publish into `packages-publish.yml` or a dedicated workflow.

---

### 5. Tests

**Service unit tests** (`services/<service>/tests/`):

- [ ] Test files cover all route handlers + middleware + service layer
- [ ] `package.json` `test` script runs them
- [ ] **Wired into CI** (`ci.yml` or `service-tests.yml`) — must be a required gate, not just present on disk

**Contract/acceptance integration tests** (`tests/<service>/`):

- [ ] Independent test package `@fuzefront/<service>-tests`
- [ ] Covers all API paths from the OpenAPI spec (contract tests)
- [ ] Security tests: authz boundary tests (403 for unpermitted callers), mirror-not-authority tests if applicable
- [ ] Requires a Postgres service container; CI job declares it
- [ ] **Wired into CI** as a dedicated job analogous to `chat-service-tests`

**Playwright e2e** (`frontend/tests/*.spec.ts`):

- [ ] Specs exist for every flow declared in `design/frames/<feature>/manifest.json`
- [ ] Specs follow `*.red.spec.ts` naming convention until the flow is green (TDD)
- [ ] **Wired into Playwright CI job** — selection-lists specs must run alongside other e2e

**Fix if missing:** Add CI job. The job pattern is: `services: postgres:16`, `working-directory: services/<service>`, `run: npm ci && npm test`. See `chat-service-tests` in `ci.yml` as the canonical reference.

---

### 6. SDK Client (TypeScript)

- [ ] Client covers 100% of the OpenAPI operation IDs (count paths in spec vs methods in client)
- [ ] `TokenProvider` abstraction (not hard-coded auth header)
- [ ] Injectable `fetch` for testing
- [ ] **OpenAPI codegen or drift check**: either the client is generated (`openapi-typescript` / `openapi-generator`), or there is a CI script that diffs the spec against the client's exported operations and fails on mismatch

**Fix if missing:** If hand-authored, add a `scripts/check-client-drift.mjs` that reads the spec's `paths` and verifies each `operationId` is exported from the client. Wire into CI.

---

### 7. OpenAPI Spec

Look at `services/<service>/openapi.yaml`:

- [ ] OpenAPI 3.1.0 (not 3.0.x)
- [ ] All resource CRUD operations documented
- [ ] Request/response schemas use `$ref` to named components (not inline definitions)
- [ ] Error responses documented (`400`, `401`, `403`, `404`, `409`, `429`, `500`)
- [ ] Spectral ruleset at `services/<service>/.spectral.yaml`
- [ ] `lint:contract` in the TypeScript client's `package.json` runs Spectral
- [ ] Spec is **frozen at contract lock** — no unreviewed changes post-freeze

**Fix if missing:** Add the missing operations or error responses; run `spectral lint openapi.yaml` clean.

---

### 8. MCP Server

Check `.fuze/manifest.json` `mcp` block and `deploy/helm/fuzefront/files/mcp-tools.overrides.yaml`:

- [ ] Service tools are registered in the `fuzefront-mcp` gateway tool overrides OR the service has its own `mcp/` directory with a dedicated MCP server
- [ ] Tool names follow the convention `<service-prefix>_<verb>_<resource>` (e.g. `selectionlist_list_lists`, `selectionlist_create_item`)
- [ ] Tools cover at minimum: list, get, create, and the service's unique hot-path operation
- [ ] The gateway's tool manifest builds and the gateway image is tagged in the CI matrix

**Fix if missing:** Add tools to `mcp-tools.overrides.yaml` pointing at the service's OpenAPI spec; tag the gateway rebuild in the CI matrix. Use the `mcp-maintainer` agent.

---

### 9. User/Org Global Event Handling

This is the most commonly missing dimension. Every service that holds per-org or per-user data **must** subscribe to lifecycle events and clean up on deletion.

**Grep for** in `services/<service>/src/`: `kafka`, `consumer`, `user.deleted`, `user.created`, `organization.deleted`, `organization.created`.

- [ ] Kafka consumer (`src/events/consumer.ts` or `src/workers/lifecycle.ts`) present
- [ ] Consumer group: `<service>-lifecycle-consumer`
- [ ] Subscribed topics: `user.lifecycle`, `organization.lifecycle` (or equivalent topic names per the repo's AsyncAPI spec)
- [ ] `organization.deleted` handler: deletes or soft-deletes all rows where `org_id = event.organizationId`, in the correct cascade order (child rows before parent), **wrapped in a transaction**
- [ ] `user.deleted` handler: anonymizes or nulls `created_by`, `updated_by`, `granted_by` FK-like columns for that user
- [ ] `organization.created` handler (if the service needs to initialize per-org defaults): idempotent upsert
- [ ] `user.created` handler (if the service grants default access to new users): idempotent upsert
- [ ] Consumer is started in `app.ts` (or a dedicated worker entrypoint) and shut down gracefully on `SIGTERM`
- [ ] Consumer errors are logged with structured context (`{ topic, partition, offset, orgId }`) and do not crash the pod (DLQ or logged-skip pattern)
- [ ] Integration test covering the `organization.deleted` cascade (check that all child rows are gone after the event fires)

**Fix if missing:** Implement `src/events/consumer.ts` using `kafkajs`; add to `app.ts` startup; write the integration test; add `KAFKA_BROKERS` env var to Helm values and SealedSecrets scaffold.

---

### 10. Helm / Deploy

Look in `deploy/helm/fuzefront/templates/` and `values.yaml`:

- [ ] `<service>-deployment.yaml` — `enabled` gate (`{{- if .Values.<slug>.enabled }}`), liveness/readiness probes, resource limits set
- [ ] `<service>-service.yaml` — ClusterIP, correct port
- [ ] `<service>-networkpolicy.yaml` — ingress from shell + other permitted callers; egress to Postgres + Security API + Kafka
- [ ] `values.yaml` entry: `enabled: false` (ships dark), `replicas`, `port`, `image.repository`, `image.tag`
- [ ] SealedSecret scaffold for all non-public secrets (DATABASE_URL, JWT_SECRET, KAFKA_CLIENT_CERT if mTLS)
- [ ] `SECURITY_SERVICE_URL`, `KAFKA_BROKERS` set inline (not secret)
- [ ] `values-prod.yaml` tag-bump entry in `release.yml`
- [ ] Liveness probe path matches the health endpoint (`/health`)

**Fix if missing:** Add the missing template or values key; run `helm template . -f values-local.yaml | kubeconform -strict` to verify. Never cast missing values with `| int` — declare the default in `values.yaml`.

---

### 11. CI

Check `.github/workflows/ci.yml` and `release.yml`:

- [ ] **Image build**: `release.yml` has a build+push step for `ghcr.io/izzywdev/fuzefront-<service>` triggered on `services/<service>/**` path changes
- [ ] **UI build**: `ci.yml` type-checks and builds the UI package
- [ ] **Service unit tests**: CI job runs `npm test` inside `services/<service>/` (with `postgres:16` service container if needed)
- [ ] **Contract/acceptance tests**: CI job runs `tests/<service>/` suite (dedicated job, separate from unit tests, also with Postgres service)
- [ ] **Playwright e2e**: selection-lists specs included in the Playwright CI job
- [ ] **Python client publish**: dedicated publish workflow for `packages/<service>-client-py/`
- [ ] Service appears in the **build-success gate** job's `needs:` array
- [ ] **Prod tag-bump**: `release.yml` `dispatch-release` step references the new image

**Fix if missing:** Add the missing CI job. Copy the `chat-service-tests` pattern — it is the canonical reference for a service with a Postgres dependency in CI.

---

### 12. Feature Flag

Look in `packages/feature-flags/flag-registry.yaml` and `packages/feature-flags/src/catalog.ts`:

- [ ] Flag key `<flag>` present in `flag-registry.yaml`
- [ ] `type: release`, `default: false`, `owner` set, `web_exposed: true`, JIRA ticket linked
- [ ] Exported constant in `catalog.ts` (`SELECTION_LISTS_SERVICE` or equivalent)
- [ ] Service-side routes import and check the flag (`src/flags.ts` lazy-require pattern; fail-safe default `false`)
- [ ] Shell nav item AND route guard both check the flag independently (not just one)
- [ ] Flag registered in Unleash before any pod rolls out (owner: `feature-flags-engineer`)

**Fix if missing:** Add the flag entry to `flag-registry.yaml` and `catalog.ts`; add the flag guard to the service routes.

---

## Output format

Produce a **status table** and a **gap fix list**:

```
| Dimension | Status | Gap |
|---|---|---|
| Backend service | Complete | None |
| Database | Complete | None |
| Frontend UI | Complete | None |
| npm packages (TS + Python) | Complete | None |
| Tests | Gap | Unit + contract tests not in CI gate |
| SDK client (TS) | Complete | No codegen pipeline (manual drift risk) |
| OpenAPI spec | Complete | None |
| MCP server | Missing | No tools registered in gateway or mcp/ dir |
| User/org events | Missing | No Kafka consumer; org deletion leaks rows |
| Helm deploy | Complete | None |
| CI | Gap | Service unit + contract tests not gated |
| Feature flag | Complete | None |
```

Then for each non-Complete row, produce:

```
## Gap: <Dimension>
**Finding:** <concrete description — file paths, what is absent>
**Fix:** <exact action — file to create, job to add, command to run>
**Owner:** <domain agent responsible>
**Blocking merge:** yes | no (blocking only if the service is about to go live or the flag is about to flip true)
```

## When to call this skill

- After a sprint that closes a new microservice feature
- Before flipping the Helm `enabled: true` or the feature flag to `true`
- As the first step in a `go-live` PR review
- As a periodic readiness check every 30 days on services that are `enabled: false`

## Ownership

The audit is run by whoever initiates it (orchestrator / `fuzefront-expert`). Each gap fix goes to the domain agent that owns that dimension:
- Backend / DB gaps → `backend-engineer` / `database-engineer`
- Frontend gaps → `frontend-engineer`
- npm / packaging gaps → `devops-engineer`
- Test gaps → `test-engineer` / `frontend-test-engineer`
- MCP gaps → `mcp-maintainer`
- Event consumer gaps → `backend-engineer`
- CI gaps → `devops-engineer`
- Feature flag gaps → `feature-flags-engineer`
- Helm gaps → `devops-engineer`

**FIX is the rule.** A gap finding without a fix or a named blocker is unfinished work.
