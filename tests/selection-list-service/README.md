# Selection-List Service — Independent Acceptance and Contract Test Suite

**FFRNT-198 / S12** — Written by `test-engineer` against the frozen spec
(`services/selection-list-service/openapi.yaml`, frozen; currently 4.0.0).

## Status: GREEN, and a required CI gate

This suite was authored **before** the service existed and was TDD-red
(`continue-on-error`) in CI. The service now meets the frozen spec and the
suite passes in full, so `selection-list-service-integration-tests`
(`.github/workflows/ci.yml`) is a **real gate**: a regression fails the build and
the `notify` job. A red test means a real deviation from the frozen OpenAPI
contract — fix the service (or amend the contract PR), never weaken the test.

## Prerequisites

| Requirement | Notes |
|---|---|
| Node 24+ | `node --version` must be `>=24.0.0` |
| Running `selection-list-service` | Defaults to `http://localhost:3011` |
| Postgres (test DB) | Required for `security/mirror-not-authority.test.ts` and for the quota ceilings seeded by `helpers/global-setup.ts` |
| Stand-in Security API | `node helpers/fake-security-api.mjs` (port 3002); point the service at it with `SECURITY_SERVICE_URL` |

## Running the service locally

Follow the instructions in `services/selection-list-service/README.md` to start
the service in test mode. The service must:

1. Accept JWTs signed with `JWT_SECRET` (set it to `test-jwt-secret-for-selection-list-service`
   or override `TEST_JWT_SECRET` in your shell before running the tests)
2. Connect to a fresh Postgres instance with the service's own migrations applied
3. Resolve quota ceilings from `selection_list_org_quota` (the harness seeds the quota suite's org in `helpers/global-setup.ts` from `TEST_QUOTA_*`; the service needs no special mode)
4. Authorize through the stand-in Security API (`helpers/fake-security-api.mjs`),
   not the allow-all `NODE_ENV=test` no-op: set `SECURITY_SERVICE_URL` and
   `FUZEFRONT_SELECTION_LIST_AUTHZ_ENABLED=true`. It grants only via the service's
   own grant calls, so the mirror-not-authority tests' direct DB injection is the
   only way `usr_01test00000000mirrorb00000` could appear to have access

Quick start (adjust to the service's actual startup command):

```bash
# In one terminal
cd services/selection-list-service
JWT_SECRET=test-jwt-secret-for-selection-list-service \
  DB_NAME=selection_list_service_test \
  npm run start:test
```

## Running the tests

```bash
cd tests/selection-list-service
npm install
npm test
```

Run only contract tests (faster, no DB dependency):

```bash
npm run test:contract
```

Run only security tests (requires DB for mirror-not-authority):

```bash
npm run test:security
```

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `SERVICE_BASE_URL` | `http://localhost:3011` | URL of the running service |
| `JWT_SECRET` | `test-jwt-secret-for-selection-list-service` | Secret for signing test JWTs |
| `TEST_DB_URL` | — | Full Postgres DSN (preferred) |
| `DB_HOST` | `localhost` | Postgres host |
| `DB_PORT` | `5432` | Postgres port |
| `DB_NAME` | `selection_list_service_test` | Database name |
| `DB_USER` | `postgres` | Postgres user |
| `DB_PASSWORD` | `postgres` | Postgres password |
| `TEST_QUOTA_ORG_LISTS` | `3` | Test-mode ceiling for `org_lists` |
| `TEST_QUOTA_LIST_ITEMS` | `5` | Test-mode ceiling for `list_items` |

## Test structure

```
contract/
  lists.test.ts         GET/POST /v1/selection-lists; pagination; archive/purge
  items.test.ts         GET/POST/PATCH /v1/selection-lists/{id}/items; reorder
  translations.test.ts  PUT translations; autofill; locale fallback chain
  access.test.ts        GET/PUT/DELETE /v1/selection-lists/{id}/access; last-owner
  quota.test.ts         Quota enforcement; concurrent creates; QUOTA_EXCEEDED shape
  resolve.test.ts       POST /v1/resolve; archived/missing ids; minimal shape
  response-shape.test.ts   every resource/status validated against openapi.yaml 4.0.0 (Ajv): required
                           nullable `seed`, AuthorPrincipal created_by/granted_by, Error envelope
  outbox-events.test.ts    HTTP -> event_outbox: exactly the events of plan §4 per mutation, payloads valid
                           against the shared Zod schemas, listRevision strictly increasing, no event on
                           rejected/no-op requests, per-org seq order (plan §14 P1-P6)
  outbox-relay.test.ts     relay delivery guarantees with a fake transport: key = org, 10 attempts -> park +
                           DLQ, per-org head-of-line ordering across a failure (plan §14 O1-O3)
  seeding.test.ts          platform defaults + app seeding through the compiled consumer handlers and the
                           seed library (Kafka-free): S1-S7, R1-R14, attestation failure matrix, token never
                           in outbox/logs/DLQ, seeded rows over HTTP, the [deleted-user] sentinel
  identifiers.test.ts      identifier standard: server-minted ids, cross-type confusion, "an id is never a
                           capability" (same-org and cross-org)
  request-validation.test.ts  additionalProperties:false + resolve `ids` schema; contains the it.failing
                           pins for the known deviations (see the file header)
  spec-consistency.test.ts offline: client issues the spec's routes/bodies; x-permit-* == the 3.0.0 matrix
                           in docs/planning/selection-lists-permit-actions.md; the CI stand-in Security
                           API encodes the documented role tables

security/
  authz.test.ts                  Authorization matrix (5 roles × 8 actions)
  authz-catalog.test.ts          Tenant-role catalog actions (3.0.0); item purge M-1; PATCH archive L-1
  mirror-not-authority.test.ts   FFRNT-242: mirror table cannot authorize
```

### Seeding / relay suites: how they run without Kafka

`contract/seeding.test.ts` and `contract/outbox-relay.test.ts` import the **compiled** service
(`services/selection-list-service/dist/...`, so `npm run -w selection-list-service build` must have run)
and drive the consumer handlers / relay against the same Postgres the running service uses, with
`DB_*` from the environment (identical to the service's). Run the service **without `KAFKA_BROKERS`** (the
CI default): with a live relay the outbox rows would leave `pending` while the relay suite asserts on them.
Only the Kafka transport and the Security API's token-introspection endpoint are faked (the latter by an
in-process server the suite owns); the seeded lists are reached over HTTP through the stand-in Security API's
machine-token grant route (the support path of docs/planning/selection-lists-permit-actions.md §5), so
`FAKE_SECURITY_URL` (default `http://localhost:3002`) must point at it.

### `it.failing` = a known, ticketed deviation

`contract/request-validation.test.ts` marks tests `it.failing` where the service deviates from the frozen
spec. They keep CI green while the defect stays provable; when the service is fixed they go red ("expected
to fail but passed") and the `.failing` must be removed in the same PR. Never weaken the assertion.

## FFRNT-242 — mirror-not-authority

`security/mirror-not-authority.test.ts` is the **critical security regression test**.
It directly inserts a row into `selection_list_access` (bypassing Permit) and asserts
that the service still denies all requests from that user. This test REQUIRES a DB
connection to the test database.

In CI, `selection-list-service-integration-tests` provides exactly that: a
`postgres:15` service with the service's migrations applied, plus the stand-in
Security API (`helpers/fake-security-api.mjs`) so authorization gets a real decision.
The suite runs against both and passes — the earlier "DB unavailable" gap is closed.

If the DB connection is unreachable (e.g. a local run with no test database), the
tests **FAIL LOUDLY** — they are never silently skipped, so an unverified run can
never report a false green.

## What these tests do NOT cover

- UI/browser end-to-end tests (`frontend-test-engineer`)
- Android / TWA layer
- Permit mock configuration (the Permit mock is the implementer's responsibility;
  these tests assert the observable API behaviour against whatever Permit answers)
- Machine translation provider (autofill tests assert the result shape, not the
  translation quality or provider choice)

## Contract source

`services/selection-list-service/openapi.yaml` — the frozen contract. If any test
contradicts the spec, the spec wins and the test must be updated (not the service).
Changes to the spec require a `contract-designer` sign-off and a `info.version` bump.
