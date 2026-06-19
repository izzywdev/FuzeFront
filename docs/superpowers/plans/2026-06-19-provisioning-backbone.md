# Plan B — Provisioning Backbone — Implementation Plan

**Goal:** Make tenant provisioning correct, idempotent, and self-healing. A user always
has exactly one `personal` org; every org's Permit wiring (user sync → tenant → owner
role → welcome email) is driven by a resumable, dependency-ordered reconciler that records
per-step state and can be re-run safely (on org create, on login, or via an internal HTTP
endpoint that Plan D's provisioning-service will call).

## Context already on this branch
- **A** — Permit PDP + schema IaC (`backend/src/permit/*`). Permit client at `backend/src/config/permit.ts`.
- **A0** — DB bootstrap split: migrations must NOT do role/DB DDL. Migration 008 is a no-op tombstone.
- **C** — `shared/src/kafka` exposes `createKafkaClient`, `TypedProducer`, `TOPICS`, `FuzeEvent`,
  and Zod schemas `identityUserCreatedSchemaV1`, `notifyEmailRequestedSchemaV1`. email-service
  consumes `notify.email.requested`. Backend will publish to these topics.
- Permit utils in `backend/src/utils/permit/*` (user-sync, tenant-management, role-assignment).
- Org create route fire-and-forgets Permit (`routes/organizations.ts` ~177-197).
- `services/oidc.ts#syncUserToDatabase` creates first-time users.
- Login handlers: local `routes/auth.ts` (~150) and OIDC callback (~399).

## Design decisions
- **Step state in DB** (`organization_provisioning`) is the source of truth; reconciler is the
  single executor. Kafka events (`identity.user.created`) and reconcile-on-login are just
  *triggers* — losing an event never loses provisioning because login self-heals.
- **Outbox**: first-time user creation writes an `event_outbox` row in the same txn, then
  best-effort publishes `identity.user.created`. Publish failure is non-fatal (row stays
  `pending` for a future drainer / D to pick up). Keeps the write atomic without 2-phase commit.
- **Welcome email** is a provisioning step that publishes `notify.email.requested` (template
  `welcome`) — also best-effort but recorded as a step so it's retried until it sends.
- **Injectable externals** for tests: provisioning takes `{ permit, publish }` deps; defaults
  bind to the real Permit client + a lazily-created shared `TypedProducer`. Tests pass fakes —
  no real Permit cloud or broker.
- **Kafka resolution**: backend imports `@fuzefront/shared` (kafka sub-barrel). Jest maps it to
  `shared/src/kafka/index.ts` (mirrors email-service). For build/runtime the backend image is
  built from repo root (mirror email-service Dockerfile) so `shared/dist` is present.

## Tasks

### T1 — Migration 009 (`backend/src/migrations/009_provisioning_backbone.ts`)
- Add `'personal'` to `organization_type_enum` (`ALTER TYPE ... ADD VALUE IF NOT EXISTS`).
- `organizations.provisioning_state` enum {pending,active,failed} default 'pending'.
- `organization_provisioning(id, organization_id FK, step, status, attempts, last_error,
  created_at, updated_at)` UNIQUE(organization_id, step). step ∈ {permit_user_sync,
  permit_tenant_create, permit_role_assign, welcome_email}; status ∈ {pending,done,failed}.
- `organization_invitations(id, organization_id FK, email, role, token UNIQUE, expires_at,
  status{pending,accepted,revoked,expired}, invited_by FK, created_at)` — for Plan G.
- `event_outbox(id, topic, payload jsonb, correlation_id, status{pending,sent,failed},
  attempts, last_error, created_at, sent_at)` — outbox for identity/email events.
- No role/DB DDL. `ADD VALUE` can't run in a txn, so guard enum change accordingly.

### T2 — Fix benign 409 in `utils/permit/tenant-management.ts`
- `createTenantInPermit` returns `true` on success AND on a 409/"already exists"; throws/false
  only on real errors. Add a `isAlreadyExistsError(err)` helper (checks status 409 / message).

### T3 — Provisioning service (`backend/src/services/organizationProvisioning.ts`)
- Types: `ProvisioningDeps { permit, publish }`, default factory.
- `ensurePersonalOrg(userId, deps?)` — idempotent; AT MOST ONE personal org per user enforced
  via a partial unique index OR a guarded select-then-insert in a txn (advisory: unique index
  `WHERE type='personal'` on owner_id). Returns the org.
- `reconcileOrganizationProvisioning(orgId, deps?)` — ensures step rows exist, runs missing/failed
  steps in order, skips `done`, records `failed`+`last_error`+`attempts++`, sets
  `provisioning_state='active'` when all done. Idempotent + resumable.
- `runInternalProvision(userId, deps?)` — ensurePersonalOrg + reconcile for all owned non-active orgs.

### T4 — Wire-ups
- `routes/organizations.ts`: replace fire-and-forget with `await reconcileOrganizationProvisioning(orgId)`
  (best-effort try/catch so a Permit outage doesn't 500 the create; state recorded for retry).
- `services/oidc.ts`: on first-time user, write outbox row + best-effort publish `identity.user.created`.
- `routes/auth.ts` local login + OIDC callback: after auth, fire `ensurePersonalOrg` + reconcile
  owned non-active orgs (best-effort, non-blocking of the response).
- New `routes/internal.ts`: `POST /internal/provision` guarded by `x-internal-secret` ==
  `process.env.INTERNAL_PROVISION_SECRET`; body `{ userId }`; runs `runInternalProvision`. Mount in index.ts.

### T5 — Kafka publisher helper (`backend/src/services/eventPublisher.ts`)
- Lazy singleton `TypedProducer` from `@fuzefront/shared`; `publishIdentityUserCreated`,
  `publishNotifyEmailRequested`. Disabled (no-op, logs) when `KAFKA_BROKERS` unset.

### T6 — Tests (`backend/tests/provisioning.test.ts`, `internal-provision.test.ts`)
- ensurePersonalOrg idempotency (double call → 1 personal org).
- reconciler resumability (re-run skips done; failed step retried, attempts++).
- benign-409 vs real failure (fake permit tenants.create throws 409 → step done; throws 500 → failed).
- reconcile-on-login heals a missing/incomplete org.
- internal endpoint auth (401 wrong/missing secret) + behavior (200 provisions).
- Jest `moduleNameMapper` for `@fuzefront/shared` → shared kafka source.

### T7 — Build/runtime plumbing
- Backend `package.json`: add `@fuzefront/shared`, `kafkajs`, `zod` deps; jest moduleNameMapper.
- Backend image build from root context (skaffold + Dockerfile) building shared first.
- Document the `POST /internal/provision` contract for Plan D.
- `npm run build` + type-check + jest green before commit.

## Internal endpoint contract (for Plan D)
```
POST /internal/provision
Headers: x-internal-secret: <INTERNAL_PROVISION_SECRET>
Body: { "userId": "<uuid>" }
200 { ok, personalOrgId, reconciled: [{orgId, state}] }
401 { error } on bad/missing secret
400 { error } on missing userId
```
Idempotent; safe to retry. Single-sources provisioning logic in the backend.
</content>
