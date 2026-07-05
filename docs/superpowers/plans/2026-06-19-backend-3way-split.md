# Backend 3-Way Split: Implementation Plan

**Date:** 2026-06-19  
**Status:** PLANNING — do NOT implement without explicit approval  
**Scope:** Extract the current monolithic `backend/` into three microservices within the same repo; update Helm chart, ingress, frontend nginx, release CI, and Skaffold.

---

## 1. Capability & Hard Requirements

**Capability:** Decompose `backend/src/` into three separately-deployable services while preserving every merged feature.

**Hard requirements:**
- All existing API surfaces remain reachable with identical paths and semantics.
- No regression in: local auth, Authentik OIDC SSO, Permit authorization, Plan-B provisioning (reconciler + outbox + self-heal on login), OIDC callback, `/internal/provision`, Kafka event publish, migrations 001–009.
- DB: shared Postgres, least-privilege `fuzefront_user`. Each service owns its domain migrations; shared 001–009 chain must not break existing deployments (knex tombstone lesson).
- Routing: clients hit services directly via ingress path routing; no backend-as-proxy.
- Deploy: all three in the umbrella `fuzefront` Helm chart, synced by the one Argo Application. Each gets its own Deployment + Service + `enabled` gate in values.
- Local dev: Helm/Skaffold on kind. Prod: Argo GitOps.
- `VITE_API_URL` / frontend nginx `/api` proxy continues to work after the routing change.

---

## 2. Library & Architecture Review (feature-tech-planning step)

### 2a. Inter-service routing options

| Option | Fit | Complexity | Latency | Notes |
|---|---|---|---|---|
| **Ingress path routes (chosen)** | Full | Low — just nginx path rules | 0 extra hops | Clients hit security-service or applications-service directly. Thin backend serves only `/health` and `/readiness`. |
| API Gateway (Kong, Traefik plugin) | Full | High | 1 extra hop | Overkill for 3 services; adds operational surface. |
| Backend-as-proxy | Full | Medium | 1 extra hop | Violates stated constraint; creates a bottleneck and single-point coupling. |
| Service mesh (Istio sidecar) | Full | Very high | Negligible | Not installed in FuzeInfra; inadvisable to introduce for this split. |

**Recommendation:** Ingress path routing. Zero new infrastructure; the nginx ingress-controller already handles path-based routing. ingress-nginx matches the longest path prefix, so more-specific paths take precedence naturally. The thin backend is a lightweight coordinator that terminates health/readiness only.

### 2b. Shared code strategy

| Option | Fit | DX | Notes |
|---|---|---|---|
| **`@fuzefront/core` npm workspace package** | Full | Good — typed, tree-shaken | Mirrors `@fuzefront/shared`. Already a precedent in the repo. |
| Copy-paste per service | Low | Bad — drift | Rejected. |
| Symlinks within monorepo | Low | Fragile | Docker multi-stage build breaks symlinks. |
| HTTP/gRPC internal API | Partial | High effort | For data, not for shared code like db config. |

**Recommendation:** New `@fuzefront/core` workspace package at `backend/core/`. Strict no-side-effects — pure config, types, and bootstrap utilities.

### 2c. Migration ownership strategy

| Option | Fit | Safety |
|---|---|---|
| **Partitioned chains per service, single shared table** | Full | Safe if knex migration names don't collide |
| All migrations in one service, others wait | Medium | Coupling between services at startup |
| Each service owns its own `knex_migrations` table | Full | Clean, but requires table name config |

**Recommendation:** Each service gets a separate `knex_migrations_<service>` table (configured via `migrations.tableName`). The existing 001–009 chain is tombstoned in security-service's directory (ALL nine files, 001–009) with `knex_migrations` table unchanged — existing deployments see no missing files. Applications-service uses a fresh chain starting at `001_` under `knex_migrations_apps`. Applications-service is the **sole runtime owner** of apps DDL; security-service's 002 and 006 become empty no-op tombstones (same filenames preserved).

---

## 3. Module-by-Module Move Map

### 3a. `backend/security/` → **security-service** (port 3002)

All identity, access control, provisioning, and session management:

| Source | Destination |
|---|---|
| `src/routes/auth.ts` | `security/src/routes/auth.ts` |
| `src/routes/organizations.ts` | `security/src/routes/organizations.ts` |
| `src/routes/internal.ts` | `security/src/routes/internal.ts` |
| `src/services/oidc.ts` | `security/src/services/oidc.ts` |
| `src/services/organizationProvisioning.ts` | `security/src/services/organizationProvisioning.ts` |
| `src/services/eventPublisher.ts` | `security/src/services/eventPublisher.ts` |
| `src/middleware/auth.ts` | `security/src/middleware/auth.ts` |
| `src/middleware/permissions.ts` | `security/src/middleware/permissions.ts` |
| `src/utils/permit/` (all 8 files) | `security/src/utils/permit/` |
| `src/permit/schema.ts` | `security/src/permit/schema.ts` |
| `src/permit/sync-permit-schema.ts` | `security/src/permit/sync-permit-schema.ts` |
| `src/config/permit.ts` | `security/src/config/permit.ts` |
| `src/migrations/001_create_users_table.ts` | `security/src/migrations/001_...` (keep numbering) |
| `src/migrations/002_create_apps_table.ts` | `security/src/migrations/002_...` **no-op tombstone** (empty up/down) |
| `src/migrations/003_create_sessions_table.ts` | `security/src/migrations/003_...` |
| `src/migrations/004_create_organizations_table.ts` | `security/src/migrations/004_...` |
| `src/migrations/005_create_organization_memberships_table.ts` | `security/src/migrations/005_...` |
| `src/migrations/006_update_apps_for_organizations.ts` | `security/src/migrations/006_...` **no-op tombstone** (empty up/down) |
| `src/migrations/007_update_sessions_for_organizations.ts` | `security/src/migrations/007_...` |
| `src/migrations/008_create_fuzefront_user.ts` (tombstone) | `security/src/migrations/008_...` |
| `src/migrations/009_provisioning_backbone.ts` | `security/src/migrations/009_...` |
| `src/seeds/001_initial_users.ts` | `security/src/seeds/001_...` |
| `src/types/shared.ts` (User, Organization, Membership, Session, Permission, CommandEvent, SocketMessage, MenuItem types) | Re-export from `@fuzefront/core` |
| `src/types/express.d.ts` | `security/src/types/express.d.ts` |

**Routes exposed by security-service:**
- `POST   /api/auth/login`
- `GET    /api/auth/user`
- `POST   /api/auth/logout`
- `GET    /api/auth/oidc/login`
- `GET    /api/auth/oidc/callback`
- `GET    /api/auth/method`
- `GET    /api/organizations`
- `POST   /api/organizations`
- `GET    /api/organizations/:id`
- `PUT    /api/organizations/:id`
- `DELETE /api/organizations/:id`
- `POST   /internal/provision` (cluster-internal only; NOT exposed via public ingress)

Note: `/api/users` and `/api/tokens` have no handlers today — ingress routes for these paths are **not added in this split**; they are deferred to the identity-ui and api-tokens plans respectively.

**WebSocket:** Security-service does NOT own sockets. Applications-service owns them.

---

### 3b. `backend/applications/` → **applications-service** (port 3003)

All app framework logic — registration, Module-Federation remote management, heartbeat, health checks, WebSocket broadcasting:

| Source | Destination |
|---|---|
| `src/routes/apps.ts` | `applications/src/routes/apps.ts` |
| `src/sockets/socketHandler.ts` | `applications/src/sockets/socketHandler.ts` |
| `src/migrations/002_create_apps_table.ts` | `applications/src/migrations/001_create_apps_table.ts` (renumbered 001 under its own chain; **rewritten to be idempotent**) |
| `src/migrations/006_update_apps_for_organizations.ts` | `applications/src/migrations/002_update_apps_for_organizations.ts` (**rewritten to be idempotent**) |
| `src/seeds/002_initial_apps.ts` | `applications/src/seeds/001_initial_apps.ts` (**rewritten to be idempotent**) |

**Idempotency rewrites (C1 — required):**
- `001_create_apps_table.ts` (`up`): wrap `createTable` in `if (!await knex.schema.hasTable('apps'))`.
- `002_update_apps_for_organizations.ts` (`up`): create enum via `DO $$ BEGIN CREATE TYPE app_visibility_enum AS ENUM (...); EXCEPTION WHEN duplicate_object THEN NULL; END $$`; guard each `alterTable` column add with `if (!await knex.schema.hasColumn('apps', '<col>'))`.
- `001_initial_apps.ts` seed: use INSERT … ON CONFLICT DO NOTHING (or equivalent `hasRows` check).

**Routes exposed by applications-service:**
- `GET    /api/apps`
- `POST   /api/apps`
- `POST   /api/apps/register`
- `PUT    /api/apps/:id/activate`
- `DELETE /api/apps/:id`
- `POST   /api/apps/:id/heartbeat`
- `GET    /api/apps/health`
- `GET    /api/apps/:id`
- `GET    /api/apps/:id/status` (future; scaffold)

**WebSocket:** Socket.IO server lives here. Applications-service owns `/socket.io/`.

**Note on auth middleware:** Applications-service imports `authenticateToken` and `requireRole` from `@fuzefront/core` (where they are re-exported as thin wrappers around JWT + DB lookup). The Permit `permissions.ts` middleware is security-service–only; app-level permission checks remain Permit-based but the middleware module is imported from `@fuzefront/core` (exported by security-service into core at extraction time, or duplicated into core).

**Decision:** Export `authenticateToken` and `requireRole` from `@fuzefront/core`. They only depend on `db` and `JWT_SECRET`. Move `permissions.ts` (Permit-based) to `security/src/middleware/permissions.ts` and also publish it as an export from a future `@fuzefront/security-client` package if applications-service needs Permit checks; for now applications-service uses JWT-only auth (`requireRole`).

---

### 3c. `backend/` (thin entry point) — **runtime-env / gateway shell** (port 3001)

The thin backend retains port 3001 (no breaking change to existing nginx `proxy_pass`). It serves ONLY:

| Endpoint | Purpose |
|---|---|
| `GET /health` | Platform-wide health (can fan-out to security + applications /health or just self) |
| `GET /api/health` | Alias |
| `GET /readiness` | K8s readiness (DB reachable) |

**Contents of thin backend `src/`:**
- `index.ts` — minimal Express: health + readiness endpoints, graceful shutdown, CORS, helmet. No domain routes. **Does NOT call `initializeDatabase()` or `runMigrations()`** — the thin backend owns no schema. DB connection is used only for health-check (`checkDatabaseHealth()`).
- `config/database.ts` — subset: only `checkDatabaseHealth()` + connection (no `runMigrations`, `runSeeds`). Or just import from `@fuzefront/core`.
- No routes beyond `/health`.
- No Socket.IO.
- No Kafka.
- No Permit.

**What the thin backend is NOT:** a proxy. The ingress routes `/api/auth`, `/api/organizations` directly to security-service; `/api/apps`, `/socket.io/` directly to applications-service. The thin backend's port-3001 Service is kept alive temporarily during the transition (Phase 3) to avoid breaking the frontend nginx before it is updated.

---

## 4. Shared Package: `@fuzefront/core`

New workspace package at `backend/core/`:

```
backend/core/
  package.json         name: @fuzefront/core, version: 1.0.0
  tsconfig.json
  src/
    config/
      database.ts      (full db config: initializeDatabaseConnection, waitForPostgres,
                         ensureDatabase, runMigrations, runSeeds, checkDatabaseHealth,
                         closeDatabase — the complete current database.ts.
                         IMPORTANT: getDatabaseConfig() must accept an optional
                         migrations.tableName parameter so each service can use its
                         own migrations table. Default: 'knex_migrations'.)
    middleware/
      auth.ts          (authenticateToken, requireRole — JWT + DB lookup)
    types/
      shared.ts        (User, Organization, Membership, Session, App, etc.)
      express.d.ts     (req.user augmentation)
    bootstrap/
      index.ts         (createExpressApp: helmet, CORS, request-logging, 404/500
                         handlers — boilerplate that would otherwise be triplicated)
```

**`getDatabaseConfig` tableName plumbing (I1 — required):**  
Today `database.ts` hardcodes `tableName: 'knex_migrations'`. `@fuzefront/core`'s `getDatabaseConfig()` must accept a `migrationsTableName?: string` parameter. Each service passes its own value:
- security-service: `'knex_migrations'` (default — keeps the existing table name)
- applications-service: `'knex_migrations_apps'`
- thin backend: does not call `runMigrations`; tableName is irrelevant

**Consumed by:** security-service, applications-service, thin backend, and (in the future) any new microservice added to FuzeFront.

**NOT in core:** Permit config/utils (security-service only), OIDC service (security-service only), organizationProvisioning (security-service only), Socket.IO (applications-service only), Kafka eventPublisher (security-service for now; shared kafka barrel already in `@fuzefront/shared`).

**Package boundary:** `@fuzefront/core` exports are intentionally boring: config + types + express bootstrap. Zero business logic. Business logic lives in the owning service.

---

## 5. Migration Partitioning Strategy (critical — tombstone lesson)

### The problem
The current `knex_migrations` table on any running DB has 9 rows (001–009). Knex's `validateMigrationList` compares the recorded list against what it finds on disk. If a migration file is missing (e.g. 002 moved to applications-service), startup crashes.

### The solution: separate migration tables per service, sole DDL ownership

**security-service** takes over the existing `knex_migrations` table. It keeps ALL nine files 001–009 in `security/src/migrations/`. Files 001, 003, 004, 005, 007, 008, 009 are copied byte-identical. Files **002 and 006 are converted to empty no-op tombstones** (both `up` and `down` are no-ops). On any already-migrated deployment, `knex migrate:latest` on security-service is a no-op (all 9 already recorded). On new deployments it runs all 9 — 002 and 006 no-op, so the apps table and its org columns are left to applications-service. `validateMigrationList` never sees a missing file.

**applications-service** is the **sole creator** of apps DDL. It uses `tableName: 'knex_migrations_apps'`. Its migrations start at `001_create_apps_table.ts` and `002_update_apps_for_organizations.ts`, **both rewritten to be idempotent** (see Section 3b). On existing deployments the apps table and columns already exist — the idempotent guards mean no crash. On new deployments applications-service creates the apps schema itself after the organizations table exists (startup ordering below).

**Concrete migration file map:**

| Original file | security-service copy | knex_migrations | applications-service copy | knex_migrations_apps | Notes |
|---|---|---|---|---|---|
| 001_create_users_table | `security/src/migrations/001_...` | row | — | — | unchanged |
| 002_create_apps_table | `security/src/migrations/002_...` **no-op tombstone** | row (already recorded) | `applications/src/migrations/001_create_apps_table.ts` | row | sole DDL owner = applications-service |
| 003_create_sessions_table | `security/src/migrations/003_...` | row | — | — | unchanged |
| 004_create_organizations_table | `security/src/migrations/004_...` | row | — | — | unchanged |
| 005_create_organization_memberships_table | `security/src/migrations/005_...` | row | — | — | unchanged |
| 006_update_apps_for_organizations | `security/src/migrations/006_...` **no-op tombstone** | row (already recorded) | `applications/src/migrations/002_update_apps_for_organizations.ts` | row | sole DDL owner = applications-service |
| 007_update_sessions_for_organizations | `security/src/migrations/007_...` | row | — | — | unchanged |
| 008_create_fuzefront_user (tombstone) | `security/src/migrations/008_...` | row | — | — | keep as-is |
| 009_provisioning_backbone | `security/src/migrations/009_...` | row | — | — | unchanged |

**Key property:** Security-service's `knex_migrations` table is left entirely undisturbed. No existing deployment ever sees a "missing migration" error. There is no double-create hazard because security-service's 002/006 are empty no-ops.

**Startup order — in-process migrations, not initContainers (C2 — corrected):**  
There is no migrate initContainer in this stack. `index.ts`'s `startServer()` calls `initializeDatabase()` → `runMigrations()` in-process at boot (see the real `backend/src/index.ts`). The same pattern is used for each new service. For startup ordering on a fresh cluster (applications-service migration 001 doesn't need an FK constraint but migration 002 adds `organization_id` FK to `organizations`), applications-service's `waitForPostgres` is **extended to also poll `pg_tables` for the `organizations` table to exist** before running its migrations. This is a loop in the existing `waitForPostgres` / boot sequence — no mythical initContainer is involved.

**Thin backend (C2 — corrected):** The thin backend's `index.ts` must **NOT call `runMigrations()`** (or `initializeDatabase()` which includes `runMigrations`). It only needs `waitForPostgres` + `initializeDatabaseConnection()` + `checkDatabaseHealth()`. This is a deliberate deviation from the current monolith's startup pattern.

**Phase 2 verification step (C1 — required):** After implementing applications-service migrations, run them against a DB that already has the apps table, `app_visibility_enum`, and all 006 columns fully populated → the migration run must complete as a clean no-op with no "already exists" or "duplicate column" errors.

---

## 6. Service Scaffolds

Each service mirrors the current backend structure:

```
backend/
  security/
    Dockerfile
    package.json            name: @fuzefront/security-service
    tsconfig.json
    jest.config.js
    src/
      index.ts              (Express + health on :3002; calls initializeDatabase()
                             which calls runMigrations() with tableName: 'knex_migrations')
      routes/
      middleware/
      services/
      utils/permit/
      permit/
      config/               (permit.ts + re-export core/config/database)
      migrations/           (001–009 — ALL nine files; 002 and 006 are no-op tombstones)
      seeds/                (001_initial_users)
      types/

  applications/
    Dockerfile
    package.json            name: @fuzefront/applications-service
    tsconfig.json
    jest.config.js
    src/
      index.ts              (Express + Socket.IO on :3003; calls initializeDatabase()
                             which calls runMigrations() with tableName: 'knex_migrations_apps';
                             waitForPostgres extended to also wait for 'organizations' table)
      routes/
      sockets/
      config/               (re-export core/config/database)
      migrations/           (001, 002 — idempotent rewrites)
      seeds/                (001_initial_apps — idempotent)
      types/

  core/
    package.json            name: @fuzefront/core
    tsconfig.json
    src/
      config/database.ts    (getDatabaseConfig accepts optional migrationsTableName)
      middleware/auth.ts
      types/shared.ts
      types/express.d.ts
      bootstrap/index.ts

  # Thin entry point — retains its current root as backend/
  Dockerfile                (unchanged at first; updated in Phase 3)
  package.json              (updated: no domain deps)
  src/
    index.ts                (health only; does NOT call runMigrations)
    config/database.ts      → imports from @fuzefront/core
```

### Dockerfile pattern (security-service example)

```dockerfile
# Build stage (root context — needs @fuzefront/shared kafka barrel)
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY shared/ ./shared/
COPY backend/core/ ./backend/core/
COPY backend/security/ ./backend/security/
RUN npm ci --workspace=@fuzefront/core --workspace=@fuzefront/security-service
RUN npm run build --workspace=@fuzefront/core
RUN npm run build --workspace=@fuzefront/security-service

# Runtime stage
FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/backend/security/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
```

Each service's Dockerfile sets `NODE_ENV=production` in the runtime stage. The TypeScript build must emit compiled migrations to `dist/migrations/` — verify that `tsconfig.json` includes the `migrations/` directory in `include`. Without this, `runMigrations()` finds no files in production (M3).

The root Dockerfile context (`.`) is kept for all three services (same as the current backend/Dockerfile) so the `@fuzefront/shared` kafka barrel is reachable.

---

## 7. Ingress & Frontend Routing Changes

### 7a. Ingress: new path-based rules

The current ingress routes all traffic to `fuzefront-frontend`. The updated ingress adds direct service paths. ingress-nginx matches the **longest path prefix**, so more-specific paths correctly take precedence over the catch-all.

```yaml
rules:
  - host: fuzefront.dev.local
    http:
      paths:
        # Security-service direct paths (real handlers exist today)
        - path: /api/auth
          pathType: Prefix
          backend:
            service: { name: fuzefront-security, port: { number: 3002 } }
        - path: /api/organizations
          pathType: Prefix
          backend:
            service: { name: fuzefront-security, port: { number: 3002 } }
        # Applications-service direct paths
        - path: /api/apps
          pathType: Prefix
          backend:
            service: { name: fuzefront-applications, port: { number: 3003 } }
        - path: /socket.io
          pathType: Prefix
          backend:
            service: { name: fuzefront-applications, port: { number: 3003 } }
        # Thin backend: health + any remaining /api routes
        - path: /api
          pathType: Prefix
          backend:
            service: { name: fuzefront-backend, port: { number: 3001 } }
        # Frontend catch-all
        - path: /
          pathType: Prefix
          backend:
            service: { name: fuzefront-frontend, port: { number: 8080 } }
```

**`/internal` is not exposed in the ingress.** It is cluster-internal only (security-service pod-to-pod via Service DNS). This is unchanged from the current setup.

**Deferred routes (I3):** `/api/users` and `/api/tokens` are **not added to the ingress or nginx in this split** — there are no handlers for them today. They will be added when the identity-ui plan (users) and api-tokens plan (tokens) land respectively.

### 7b. Frontend nginx.conf changes

The current nginx routes all `/api/` to `fuzefront-backend:3001`. In Phase 4 (after ingress path routes are live), the frontend nginx can be simplified — it no longer needs to proxy `/api/` at all since the ingress handles routing upstream of nginx. However, to maintain the in-pod nginx path for any non-ingressed deployments (local `port-forward` scenarios), we update nginx to fan out:

```nginx
# Security service (real handlers exist)
location /api/auth/ {
    proxy_pass http://fuzefront-security:3002;
    ...
}
location /api/organizations/ {
    proxy_pass http://fuzefront-security:3002;
    ...
}

# Applications service
location /api/apps/ {
    proxy_pass http://fuzefront-applications:3003;
    ...
}
location /socket.io/ {
    proxy_pass http://fuzefront-applications:3003;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    ...
}

# Thin backend (health, any catch-all /api/*)
location /api/ {
    proxy_pass http://fuzefront-backend:3001;
    ...
}
```

Note: `/api/users/` and `/api/tokens/` blocks are **not added here** (no handlers — see I3 above).

`VITE_API_URL` continues to point at the ingress host (e.g. `http://fuzefront.dev.local` / `https://app.fuzefront.com`). No frontend env change is needed.

---

## 8. Helm Chart Changes

### 8a. New Deployment + Service templates

Add `deploy/helm/fuzefront/templates/security.yaml` and `deploy/helm/fuzefront/templates/applications.yaml`, each containing a Deployment + Service block, gated by `securityService.enabled` / `applicationsService.enabled` (default `false` initially; set to `true` in values-local + values-prod in Phase 3).

**security.yaml** mirrors `backend.yaml` structure. Extra env vars:
- All current backend env vars (DB, JWT_SECRET, SESSION_SECRET, FRONTEND_URL)
- `PERMIT_API_KEY`, `PERMIT_PDP_URL`, `PERMIT_DEBUG`
- `KAFKA_BROKERS`
- `INTERNAL_PROVISION_SECRET`
- `AUTHENTIK_CLIENT_ID`, `AUTHENTIK_CLIENT_SECRET`, `AUTHENTIK_ISSUER_URL`, `AUTHENTIK_REDIRECT_URI`
- `NODE_EXTRA_CA_CERTS` (if CA configmap set)
- Port: 3002

**applications.yaml** simpler env set:
- `DB_*` (for migrations), `JWT_SECRET` (for socket auth), `FRONTEND_URL`
- Port: 3003

**Pre-install db-bootstrap Job (M2):** The existing pre-install db-bootstrap Helm Job is **unchanged**. It provisions the single `fuzefront_platform` database and the `fuzefront_user` role. All three services (thin backend, security-service, applications-service) connect as `fuzefront_user` — no new roles or databases are needed.

### 8b. values.yaml additions

```yaml
securityService:
  enabled: false          # flip to true in Phase 3
  image:
    repository: fuzefront/security-service
    tag: local
  port: 3002
  replicas: 1
  resources:
    requests: { cpu: 100m, memory: 256Mi }
    limits:   { cpu: "1",  memory: 512Mi }

applicationsService:
  enabled: false          # flip to true in Phase 3
  image:
    repository: fuzefront/applications-service
    tag: local
  port: 3003
  replicas: 1
  resources:
    requests: { cpu: 100m, memory: 256Mi }
    limits:   { cpu: "1",  memory: 512Mi }
```

### 8c. values-prod.yaml additions

```yaml
securityService:
  image:
    repository: ghcr.io/izzywdev/fuzefront-security-service
    tag: ""   # CI sed writes SHA here
  replicas: 2
  enabled: true   # set true in Phase 3 values-prod bump

applicationsService:
  image:
    repository: ghcr.io/izzywdev/fuzefront-applications-service
    tag: ""
  replicas: 2
  enabled: true
```

### 8d. Ingress template update

Extend the existing `ingress.yaml` to include the new path rules under a conditional block (`if .Values.securityService.enabled || .Values.applicationsService.enabled`). The catch-all `/` → frontend stays in all cases.

---

## 9. CI/CD Changes

### 9a. `release.yml` build matrix additions

Add two new `Build & push` steps after the existing backend step:

```yaml
- name: Build & push security-service
  uses: docker/build-push-action@v5
  with:
    context: .
    file: backend/security/Dockerfile
    push: true
    tags: |
      ghcr.io/izzywdev/fuzefront-security-service:${{ steps.tag.outputs.sha }}
      ghcr.io/izzywdev/fuzefront-security-service:latest

- name: Build & push applications-service
  uses: docker/build-push-action@v5
  with:
    context: .
    file: backend/applications/Dockerfile
    push: true
    tags: |
      ghcr.io/izzywdev/fuzefront-applications-service:${{ steps.tag.outputs.sha }}
      ghcr.io/izzywdev/fuzefront-applications-service:latest
```

The `sed` tag-bump step is updated to also patch `securityService.image.tag` and `applicationsService.image.tag` in values-prod.yaml.

The `paths:` trigger adds `backend/security/**` and `backend/applications/**`.

### 9b. `backend-tests.yml` / CI

The existing backend integration test job is extended to also run tests in `backend/security/` and `backend/applications/`. Backend root tests continue to run to prevent regression.

### 9c. Skaffold

Add two new artifacts to `skaffold.yaml`:

```yaml
- image: fuzefront/security-service
  context: .
  docker:
    dockerfile: backend/security/Dockerfile

- image: fuzefront/applications-service
  context: .
  docker:
    dockerfile: backend/applications/Dockerfile
```

Add `setValueTemplates` entries:

```yaml
securityService.image.repository: '{{.IMAGE_REPO_fuzefront_security_service}}'
securityService.image.tag: '{{.IMAGE_TAG_fuzefront_security_service}}'
applicationsService.image.repository: '{{.IMAGE_REPO_fuzefront_applications_service}}'
applicationsService.image.tag: '{{.IMAGE_TAG_fuzefront_applications_service}}'
```

---

## 10. Env / Secrets Per Service

| Secret / Env | thin backend | security-service | applications-service |
|---|---|---|---|
| `DB_*` (host/port/name/user) | health check only | YES (migrations + queries) | YES (migrations + queries) |
| `DB_PASSWORD` | YES (health) | YES | YES |
| `JWT_SECRET` | NO | YES (sign/verify) | YES (socket verify) |
| `SESSION_SECRET` | NO | YES | NO |
| `FRONTEND_URL` | YES (CORS) | YES (CORS + OIDC redirect) | YES (CORS + socket) |
| `PERMIT_API_KEY` | NO | YES | NO |
| `PERMIT_PDP_URL` | NO | YES | NO |
| `KAFKA_BROKERS` | NO | YES | NO |
| `INTERNAL_PROVISION_SECRET` | NO | YES | NO |
| `AUTHENTIK_CLIENT_ID/SECRET` | NO | YES | NO |
| `AUTHENTIK_ISSUER_URL` | NO | YES | NO |
| `AUTHENTIK_REDIRECT_URI` | NO | YES | NO |
| `NODE_EXTRA_CA_CERTS` | NO | YES (if CA configmap) | NO |

All secrets continue to live in the same chart Secret (`fuzefront-secrets`). Each Deployment's `env` block only references the keys it needs. No new secrets are required.

---

## 11. Argo CD Wiring

No change to the Argo Application. The umbrella `fuzefront` chart is the single Argo target:

```yaml
source:
  path: deploy/helm/fuzefront
  helm:
    valueFiles: [values-prod.yaml]
```

When Phase 3 sets `securityService.enabled: true` and `applicationsService.enabled: true` in `values-prod.yaml` and that commit lands on master, Argo auto-syncs and deploys the new Deployments + Services. The ingress path rules activate at the same moment. This is safe because:
1. The new services are running before the ingress switches.
2. The thin backend continues serving `/api/*` catch-all until the ingress is switched (Phase 3 is atomic in a single Helm release).

---

## 12. Phased Migration Sequence

### Phase 0: Core package + scaffolds (no behavior change)

**Goal:** Create the shared core package and empty service scaffolds. No routes moved. No ingress changed.

Steps:
1. Create `backend/core/` with `package.json` (name `@fuzefront/core`), `tsconfig.json`, copy `config/database.ts` (updated to accept `migrationsTableName` parameter), `middleware/auth.ts`, `types/shared.ts`, `types/express.d.ts`, `bootstrap/index.ts`.
2. Update root `package.json` workspaces to include `backend/core`, `backend/security`, `backend/applications`.
3. Create `backend/security/` scaffold: `package.json` (deps: `@fuzefront/core`, `@fuzefront/shared`, `express`, `permitio`, `openid-client`, `knex`, `pg`, `kafkajs`, `bcryptjs`, `jsonwebtoken`, `uuid`), `tsconfig.json`, `jest.config.js`, empty `src/index.ts` (health only on :3002).
4. Create `backend/applications/` scaffold: `package.json` (deps: `@fuzefront/core`, `@fuzefront/shared`, `express`, `knex`, `pg`, `socket.io`, `jsonwebtoken`, `uuid`), `tsconfig.json`, `jest.config.js`, empty `src/index.ts` (health only on :3003).
5. Create Dockerfiles for both new services (include `ENV NODE_ENV=production`; ensure `tsconfig.json` emits `dist/migrations/`).
6. Add Helm templates (`security.yaml`, `applications.yaml`) with `enabled: false`.
7. Add values entries with `enabled: false`.
8. Add Skaffold artifacts.
9. Add CI release matrix steps (images won't be deployed yet since `enabled: false`).

**Verification:** `npm ci` at root succeeds. `tsc --noEmit` in all three service directories. `skaffold build` succeeds (builds all 5 images). Helm template renders without error. Existing backend tests still pass. No deployment change.

---

### Phase 1: Move security-service modules (security routes live in both old backend and new service)

**Goal:** Copy all security domain code to `backend/security/`, wire up its index.ts to expose the routes on :3002, run migrations from the new location. The old backend STILL serves the same routes (dual-serving period).

Steps:
1. Copy (not move yet) routes/auth, routes/organizations, routes/internal, services/oidc, services/organizationProvisioning, services/eventPublisher, middleware/auth, middleware/permissions, utils/permit/*, config/permit, permit/schema, migrations 001–009 (with 002 and 006 as no-op tombstones), seeds/001 to `backend/security/src/`.
2. Update imports in copied files to use `@fuzefront/core` for db config, auth middleware, types.
3. Wire `backend/security/src/index.ts` to mount the routes and call `initializeDatabase()` (with `migrationsTableName: 'knex_migrations'`) on :3002.
4. Enable security-service in `values-local.yaml` only.
5. Deploy locally (`skaffold run`): both `fuzefront-backend:3001` and `fuzefront-security:3002` serve auth/org routes in parallel.

**Verification:**
- `curl http://fuzefront.dev.local/api/auth/login` via both `:3001` and `:3002` paths → same response.
- `POST /api/organizations` works via both.
- `/internal/provision` reachable cluster-internally on security-service pod.
- All existing backend integration tests still pass against `:3001`.
- New security-service integration tests run against `:3002`.

---

### Phase 2: Move applications-service modules

**Goal:** Copy apps domain code to `backend/applications/`, wire Socket.IO, run its idempotent migrations. Still dual-serving.

Steps:
1. Copy routes/apps, sockets/socketHandler to `backend/applications/src/`.
2. Write idempotent migrations 001 (`hasTable` guard) and 002 (enum `DO $$` + `hasColumn` guards) in `applications/src/migrations/`.
3. Write idempotent seed 001_initial_apps (INSERT … ON CONFLICT DO NOTHING).
4. Update imports to use `@fuzefront/core`.
5. Wire `backend/applications/src/index.ts`: mount apps routes on :3003, initialize Socket.IO, call `initializeDatabase()` with `migrationsTableName: 'knex_migrations_apps'` and extended `waitForPostgres` that also polls for the `organizations` table.
6. Enable applications-service in `values-local.yaml`.
7. Deploy locally.

**Idempotency verification (C1):** Run applications-service migrations against a Postgres DB that already has the `apps` table, `app_visibility_enum`, and all 006 columns → migration run completes with zero new operations and no errors.

**Verification:**
- `GET /api/apps` works via both `:3001` and `:3003`.
- WebSocket connects to `:3003` directly (test with `wscat`).
- Heartbeat → WebSocket broadcast works.
- Apps integration tests pass against `:3003`.
- Existing `:3001` apps routes still function.

---

### Phase 3: Switch ingress + frontend nginx (cutover)

**Goal:** Route production traffic to the new services. Remove domain routes from thin backend. This is the "flag day" that changes the live routing.

Steps:
1. Update `deploy/helm/fuzefront/templates/ingress.yaml` with path rules (Section 7a).
2. Update `frontend/nginx.conf` with per-service proxy blocks (Section 7b).
3. Slim down `backend/src/index.ts` to health-only (remove all `app.use('/api/...')` domain mounts; remove `initializeDatabase()` call; add `waitForPostgres` + `initializeDatabaseConnection()` + `checkDatabaseHealth()` only).
4. Remove domain deps from `backend/package.json`.
5. Set `securityService.enabled: true`, `applicationsService.enabled: true` in `values-local.yaml`.
6. Deploy locally with `skaffold run`.
7. Smoke test: sign-in flow, org create, app register, WebSocket heartbeat.
8. Run full e2e suite (`npm run test:e2e` in frontend/).

**Verification (local):**
- Sign-in via OIDC: browser → ingress → `/api/auth/oidc/login` → security-service ✓
- `GET /api/apps` → applications-service ✓
- WebSocket connect to `/socket.io/` → applications-service ✓
- `GET /health` → thin backend ✓
- `POST /internal/provision` is NOT reachable from outside cluster (no ingress rule) ✓

**Prod deploy (same PR or follow-up):**
1. Set `securityService.enabled: true`, `applicationsService.enabled: true` in `values-prod.yaml`.
2. Merge to master → release.yml builds 4 images (backend + security-service + applications-service + frontend), bumps all four tags in values-prod.yaml → Argo syncs.

---

### Phase 4: Remove duplicated code from thin backend + cleanup

**Goal:** Delete the now-duplicate source from `backend/src/` (routes that moved to security/applications). Clean up deps.

Steps:
1. Delete from `backend/src/`: `routes/auth.ts`, `routes/apps.ts`, `routes/organizations.ts`, `routes/internal.ts`, `services/`, `middleware/permissions.ts`, `utils/permit/`, `config/permit.ts`, `permit/`.
2. Keep in `backend/src/`: `index.ts` (health-only, no `runMigrations`), `config/database.ts` (health check only, re-exported from `@fuzefront/core`), `types/` (re-exports from `@fuzefront/core`).
3. Update `backend/package.json`: remove `permitio`, `openid-client`, `kafkajs`, `socket.io`, `bcryptjs`, `passport*` deps.
4. Keep `@fuzefront/shared` (transitively needed for health-check Kafka no-op).
5. Update all import paths in `backend/src/index.ts`.
6. Run tests.

**Verification:**
- `tsc --noEmit` in all four packages (core, security, applications, backend).
- `skaffold build` succeeds.
- Full integration test suite green.

---

### Phase 5: Hardening (post-split)

**Goal:** Per-service observability, readiness probes, resource tuning, and documentation.

Steps:
1. Add per-service `readinessProbe`/`livenessProbe` in Helm templates (same pattern as backend.yaml).
2. Tune resource requests/limits based on observed usage.
3. Add per-service structured logging with service name tag.
4. Swagger/OpenAPI: split is cosmetic. New services may add `/api-docs` routes but it is optional — the existing monolith docs remain accurate until services are stable. Each new service that adds docs creates `<service>/src/config/swagger.ts` independently.
5. Update `docs/` (deployment model, architecture diagram).

---

## 13. Rollback Considerations

### Phase 0–2 rollback
Free: the old backend still runs all routes. Disabling the new services (`enabled: false`) returns the system to the previous state.

### Phase 3 rollback
Revert the ingress template and nginx.conf changes in a follow-up commit. Argo auto-syncs. Traffic returns to the thin backend's catch-all `/api/` route. Since the thin backend still has its domain routes until Phase 4, this is a 1-commit rollback.

**Window:** Deploy Phase 3 and Phase 4 in separate PRs with at least 24 hours between them. This keeps the rollback window open.

### Phase 4 rollback
After Phase 4, rolling back requires cherry-picking deleted files from git history (no longer a trivial revert). This is why Phase 4 is the final phase and should only proceed after Phase 3 has been stable in production for ≥24h.

### Database rollback
The migration partitioning strategy is forward-safe: security-service's migration table is the same as the original. Applications-service migrations are idempotent. Rolling back Phase 3 does NOT require rolling back migrations.

---

## 14. Top Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Migration split causes `knex` validateMigrationList error** on existing deployed DB | Medium | High (service crash at startup) | Security-service keeps ALL nine files 001–009; 002 and 006 are no-op tombstones. No files are missing from the `knex_migrations` perspective. Tested in Phase 1 before any routing changes. |
| **Applications-service migrations crash on existing DB** (apps table/enum/columns already exist) | Medium | High (service crash at startup) | Migrations are rewritten to be idempotent (hasTable, hasColumn, DO $$ ... EXCEPTION WHEN duplicate_object). Verified in Phase 2 idempotency test before cutover. |
| **`@fuzefront/core` import cycles** between core and services | Medium | Medium (TS compile fail) | Core has zero imports from services. All arrows point inward: services → core, never core → service. Enforced by `package.json` dep graph. |
| **OIDC callback URL mismatch** after port change | Low | High (SSO broken) | The OIDC callback URL is `AUTHENTIK_REDIRECT_URI` in the Helm values. It uses the ingress host (e.g. `http://fuzefront.dev.local/api/auth/oidc/callback`). The ingress now routes `/api/auth/*` to security-service. URL does not change. The Authentik blueprint also has the redirect URI — if the ingress hostname is the same, no blueprint re-apply is needed. |
| **WebSocket `app.get('io')` pattern breaks** when apps routes move | Medium | Medium (heartbeat broadcasts silenced) | The `io` is initialized in applications-service's `index.ts` and passed to the router via `app.set('io', io)`. This pattern is self-contained in the service. Verified in Phase 2. |
| **Frontend `VITE_API_URL` hard-codes paths** that need updating | Low | Low | `VITE_API_URL` is the base URL only (e.g. `https://app.fuzefront.com`). Path routing is handled by the ingress and nginx. No frontend code change needed for Phase 3. |
| **`/internal/provision` accidentally exposed** via new ingress | Low | High (security) | The internal route is explicitly NOT in the ingress rules. Verified: no `path: /internal` entry in the ingress template. |
| **Concurrent reconcile advisory lock** (pg_advisory_xact_lock) contention under 2 replicas | Low | Low | The lock is per-orgId (hashtext) and short-lived (transaction scope). Two replicas reconciling different orgs don't block each other. Two replicas racing on the same org: one wins, one waits and then skips (all steps `done`). No change to this behavior. |
| **Race: applications-service starts before organizations table exists** (new cluster) | Medium | High (FK constraint violation) | Applications-service migration 002 adds `organization_id` FK to `organizations`. Mitigated by extending `waitForPostgres` / boot sequence to also poll `pg_tables` for the `organizations` table before calling `runMigrations()`. No initContainer needed — this is handled in-process. |
| **Thin backend crashes due to `permit.ts` module-load throw** (`PERMIT_API_KEY` unset) | Resolved | — | Confirmed from `config/permit.ts`: it throws at module load if `PERMIT_API_KEY` is unset. The thin backend must not import `permit.ts` at all. In Phases 0–3 the thin backend continues to dual-serve domain routes including Permit-guarded ones — this is SAFE because `PERMIT_API_KEY` is always set in deployment (Helm secret) and the Permit SDK uses `throwOnError: false` for permission checks. The thin backend only drops all Permit/domain imports at Phase 4 (delete). No action needed in Phase 0. |
| **`dist/migrations/` missing in production image** | Low | High (no migrations run at boot) | Each service's `tsconfig.json` must include `src/migrations/**` and output to `dist/migrations/`. Verified in Phase 0 with `skaffold build` + prod image inspection. |

---

## 15. Summary: The Locked Architecture

```
Ingress (ingress-nginx — longest-prefix-match)
  /api/auth/*          → fuzefront-security:3002
  /api/organizations/* → fuzefront-security:3002
  /api/apps/*          → fuzefront-applications:3003
  /socket.io/*         → fuzefront-applications:3003
  /api/*               → fuzefront-backend:3001 (health + readiness)
  /*                   → fuzefront-frontend:8080

  Deferred (no handlers yet — added with future plans):
    /api/users/*       → fuzefront-security (identity-ui plan)
    /api/tokens/*      → fuzefront-security (api-tokens plan)

fuzefront-security (security-service)
  Port: 3002
  Migrations table: knex_migrations (original chain 001-009;
    files 002 and 006 are no-op tombstones; sole creator of users,
    sessions, organizations, memberships, provisioning schema)
  Owns: users, sessions, organizations, memberships, invitations,
        provisioning, outbox, permit utils, OIDC, Kafka publish

fuzefront-applications (applications-service)
  Port: 3003
  Migrations table: knex_migrations_apps (chain 001-002; idempotent)
  Sole DDL owner: apps table, app_visibility_enum, org-related app columns
  Waits for: organizations table to exist before running migrations
  Owns: apps, app-org join columns, Socket.IO

fuzefront-backend (thin backend)
  Port: 3001
  No migrations, no runMigrations() call
  Owns: /health, /api/health, /readiness
  DB: connection for health-check only (checkDatabaseHealth)

@fuzefront/core (workspace package, not deployed)
  Owns: db config (getDatabaseConfig with migrationsTableName param),
        auth middleware (JWT), types, express bootstrap boilerplate

@fuzefront/shared (existing workspace package, not deployed)
  Owns: Kafka client, schemas, frontend hooks, FuzeEvent types

Pre-install db-bootstrap Job (unchanged)
  Provisions: fuzefront_platform database + fuzefront_user role
  Shared by: all three services
```

---

*End of plan. PLANNING ONLY — do NOT implement without explicit human sign-off.*
