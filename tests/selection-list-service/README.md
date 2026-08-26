# Selection-List Service — Independent Acceptance and Contract Test Suite

**FFRNT-198 / S12** — Written by `test-engineer` against the frozen spec
(`services/selection-list-service/openapi.yaml` v1.0.0).

## These tests are intentionally RED

This suite was authored **before** the service exists. Every test is expected to fail
until `backend-engineer` delivers a compliant implementation. Red tests against a real
bug are a deliverable — they stay red until the bug is fixed, not until the test is
removed.

## Prerequisites

| Requirement | Notes |
|---|---|
| Node 24+ | `node --version` must be `>=24.0.0` |
| Running `selection-list-service` | Defaults to `http://localhost:3011` |
| Postgres (test DB) | Required only for `security/mirror-not-authority.test.ts` |

## Running the service locally

Follow the instructions in `services/selection-list-service/README.md` to start
the service in test mode. The service must:

1. Accept JWTs signed with `JWT_SECRET` (set it to `test-jwt-secret-for-selection-list-service`
   or override `TEST_JWT_SECRET` in your shell before running the tests)
2. Connect to a fresh Postgres instance with the service's own migrations applied
3. Use test-mode quota ceilings (see Environment Variables below)
4. Use a Permit mock/test environment (the mirror-not-authority tests require that
   the test Permit mock does NOT grant `usr_01test00000000mirrorb00000` access to
   any list, so the direct DB injection is the only grant path)

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
