# Selection-List Service — Independent Acceptance and Contract Test Suite

**FFRNT-198 / S12** — Written by `test-engineer` against the frozen spec
(`services/selection-list-service/openapi.yaml` v1.0.0).

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

security/
  authz.test.ts                  Authorization matrix (5 roles × 8 actions)
  mirror-not-authority.test.ts   FFRNT-242: mirror table cannot authorize
```

## FFRNT-242 — mirror-not-authority

`security/mirror-not-authority.test.ts` is the **critical security regression test**.
It directly inserts a row into `selection_list_access` (bypassing Permit) and asserts
that the service still denies all requests from that user. This test REQUIRES a DB
connection to the test database.

If the DB connection is unavailable, the tests are **SKIPPED** with a warning (not
silently passed). The skip is a flagged gap — it means FFRNT-242 is not verified in
that run.

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
