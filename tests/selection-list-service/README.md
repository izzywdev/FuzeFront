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
| Running `selection-list-service` | Defaults to `http://localhost:3008` |
| Postgres (test DB) | Required for `security/mirror-not-authority.test.ts` and for the quota ceilings seeded by `helpers/global-setup.ts` |
| Stand-in Security API | `node helpers/fake-security-api.mjs` (port 3002, or `PORT`); point the service at it with `SECURITY_SERVICE_URL` |

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
   only way `testUser('mirrorb')` (helpers/ids.ts; fixture ids are codec-valid TypeIDs, never hand-typed literals) could appear to have access

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
npm install        # also links the local @izzywdev/fuzefront-identity (packages/identity, its dist/ is committed)
npm test
```

`npm install` here is enough to run the stand-in on its own (`node helpers/fake-security-api.mjs`): the suite
declares `@izzywdev/fuzefront-identity` (`file:../../packages/identity`, the same reference the services use), which
the stand-in and the id fixtures import for the TypeID <-> UUID codec. It no longer relies on a root
`npm ci` having hoisted the workspace package.

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
| `SERVICE_BASE_URL` | `http://localhost:3008` | URL of the running service |
| `SECURITY_SERVICE_URL` | `http://localhost:3002` | Where the harness reaches the stand-in Security API to post fixtures (`/__fixture/*`) and read grants. Set it to the SAME value the service under test uses, so fixtures land on the stand-in the service consults |
| `FAKE_SECURITY_URL` | (unset) | Explicit override of the above for the harness only (e.g. the harness reaches the stand-in at an address the service cannot use). Only honoured when set. Resolved once, in `helpers/security-url.ts` |
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
the harness's Security API URL (`SECURITY_SERVICE_URL`, overridable with `FAKE_SECURITY_URL`; default
`http://localhost:3002`; see `helpers/security-url.ts`) must point at it.

### `it.failing` = a known, ticketed deviation

`contract/request-validation.test.ts` marks tests `it.failing` where the service deviates from the frozen
spec. They keep CI green while the defect stays provable; when the service is fixed they go red ("expected
to fail but passed") and the `.failing` must be removed in the same PR. Never weaken the assertion.

## SL9 — shared / common lists and copy-on-write fork (contract 4.1.0)

Design record: `docs/planning/selection-lists-shared-and-fork.md` (§4 authz matrix, §6 algorithms, §7 flag,
§11 test plan). The suites below pin §11 items 1-11 against the frozen `openapi.yaml` 4.1.0; each file's header
comment names the design-record rows it pins. R7 (existing 4.0.0 behaviour for existing data) is covered by the
suites above, which run unchanged against a flag-ON service.

```
contract/
  shared-lists-listing.test.ts        include_shared / visibility filter / shadowing / pagination / editable hint / 4.1.0 shapes
  shared-lists-precedence.test.ts     which list a key means: own readable active list > common list; archived + private forks
  shared-lists-fork.test.ts           POST …/fork: 201 / 200 / 409 fork_exists | fork_not_applicable | key-taken / 403 quota / 400 / 404;
                                      copies items (archived too) + translations + origin_item_id + forked_from + owner grant; COW; concurrency; on-delete keep
  shared-lists-fork-size.test.ts      the 5000-item cap (5001 -> 400, 5000 -> 201 with a 5000-entry itemMap); bulk rows inserted by SQL
  shared-lists-fork-required.test.ts  every per-list mutation on a common list: 409 fork_required (+fork_url, source_list_id) / 403 / 404 order
  shared-lists-visibility.test.ts     visibility on create + PATCH, platform one-way (409 visibility_locked), read-only fields rejected
  shared-lists-resolve.test.ts        platform ids resolve from every org, effective_item_id redirect, private/archived fork no redirect, ETag varies
  shared-lists-events.test.ts         outbox: list.forked / visibility.changed / created snapshots; one transaction (xmin); nothing on refusals
  shared-lists-flag-off.test.ts       flag OFF: 4.0.0 behaviour with 4.1.0 shapes (needs the second, flag-OFF instance — see below)
  shared-lists-org-renderings.test.ts publishing / forking through either rendering (TypeID / bare UUID) of one org id
  shared-lists-platform-suspension.test.ts  platform-org SUSPENSION (writes 403 / reads served / resume; ordering; flag-independent) and
                                      FUTURE-DATED org events rejected (needs the two suspension instances — see below)
  shared-lists-access-groups.test.ts  grant GROUPS: a user's mirror rows under both renderings are one grant (GET once, DELETE revokes all,
                                      PUT converges, last-owner guard, paged roster); the org id's renderings are one group
  shared-lists-duplicate-winner.test.ts  PERMIT-AWARE duplicate winner (same key under two renderings): listing, ?key=, fork lookup, resolve
  shared-lists-dark-create-renderings.test.ts  create / rename onto a key held under another rendering is 409 even with the flag OFF
security/
  shared-read-authz.test.ts           shared read per tenant role (developer -> 404), cross-org 404, nobody mutates via shared read, id is not a capability
  shared-lists-privileged-ops.test.ts publish_platform (platform org only), promotion, owner-only visibility, purge of common lists
  shared-lists-fake-policy.test.ts    the stand-in Security API evaluates read_shared / publish_platform as the Permit schema defines them
  shared-lists-platform-org-trust.test.ts  decoy platform-typed org gets nothing; unset / unconfirmed / deactivated platform org disables every platform feature
  shared-lists-authorship-masking.test.ts  created_by of another org's rows renders as system:platform
```

### Turning the feature on (and off) in the harness

The flag `fuzefront.selection-lists.shared-lists` is process-wide, so "both states" means **two service
instances on the same database**, both started like the CI job does (`NODE_ENV=test`, stand-in Security API):

| | main instance (`SERVICE_BASE_URL`) | flag-OFF instance (`SHARED_LISTS_FLAG_OFF_URL`) |
|---|---|---|
| `FUZE_FLAGS_PROVIDER` | `offline` | `offline` |
| `FUZE_FLAGS_OFFLINE_ON` | `fuzefront.selection-lists.service,fuzefront.selection-lists.shared-lists` | `fuzefront.selection-lists.service` |
| `SELECTION_LIST_PLATFORM_ORG_ID` | `org_01jpmf4z1yf88rpb9z9sd6pz00` | the same |
| `PORT` | e.g. `3011` | e.g. `3012` |

* The platform org id is **configuration only** (service 1.1.0): `SELECTION_LIST_PLATFORM_ORG_ID` is honoured once
  `selection_list_ref_index` shows an active row with `is_active = true` and `org_type = 'platform'` for it.
  `helpers/global-setup.ts` writes that row (plus a *decoy* org typed `platform` that is not the configured id) with plain SQL.
  `security/shared-lists-platform-org-trust.test.ts` additionally needs three instances whose only difference is that
  setting - unset / an org with no projection row / an org projected `is_active=false` - passed as
  `SHARED_LISTS_PLATFORM_DISABLED_URLS="unset=<url>,unconfirmed=<url>,deactivated=<url>"`
  (`.github/workflows/ci.yml` starts them on 3013-3015; the flag-OFF instance is 3012).
* `contract/shared-lists-platform-suspension.test.ts` DEACTIVATES and REACTIVATES a platform org, so it cannot use the shared one
  (suspending it would fail every parallel suite's writes). It has its own platform org (`SUSPENDABLE_PLATFORM_ORG_ID`,
  helpers/sl9-constants.ts) and two more instances on the same database that differ only in the shared-lists flag:
  `SHARED_LISTS_SUSPENSION_URLS="on=<url>,off=<url>"` (CI: 3016 flags ON, 3017 shared-lists OFF; the id literal in ci.yml is
  pinned to the constant by `contract/harness-ids.test.ts`). The suite confirms the org in the projection and delivers the
  identity.org.* events the way `contract/seeding.test.ts` does - the compiled handlers (`dist/events/*.handler.js`, via
  `helpers/org-events.ts`) against the same Postgres - and observes every effect over HTTP on those instances (the suspension
  is read fresh per request). It does not use, and cannot disturb, the other instances.
* Duplicate-key and grant-group states cannot be created through the API any more (that is the point of the rules they test), so
  `helpers/renderings.ts` plants them as legacy rows with plain SQL; all assertions are over HTTP. The stand-in's
  `POST /__fixture/deny-catalog-action` withdraws one catalog action from one subject (a caller who may `resolve` but holds no
  shared read), which is how the resolve redirect is shown to be decided among the forks the caller can READ.
* `TEST_PLATFORM_ORG_ID` (default `org_01jpmf4z1yf88rpb9z9sd6pz00`) must equal the service's
  `SELECTION_LIST_PLATFORM_ORG_ID`. The suites tell the stand-in Security API which org is the platform org
  through `POST /__fixture/platform-org`; `publish_platform` is effective only in that tenant.
* Every flag-ON suite starts with a precondition probe (`assertSharedListsOn`): a service without the feature fails
  with an explicit `PRECONDITION:` message instead of a cascade of 400s. The OFF suite does the mirror probe and
  fails (never skips) when `SHARED_LISTS_FLAG_OFF_URL` is unset.
* The suites mint per-run orgs/users, so re-running against the same database is safe; the only fixed orgs are the
  quota-override rows seeded by `helpers/global-setup.ts` (platform org, fork quota orgs). A fresh database per run
  (as CI has) is still the reference.
* `shared-lists-events` proves "one request, one transaction" by the rows' shared correlation id and, while they are
  still `pending`, their shared `xmin`. `contract/outbox-relay.test.ts` marks every org's rows `sent` in a parallel
  worker (an UPDATE, which rewrites `xmin`), so the `xmin` half is asserted only for rows the relay has not touched.
  Run the suites without `KAFKA_BROKERS`, as CI does.

## FFRNT-242 — mirror-not-authority

`security/mirror-not-authority.test.ts` is the **critical security regression test**.
It directly inserts a row into `selection_list_access` (bypassing Permit) and asserts
that the service still denies all requests from that user. This test REQUIRES a DB
connection to the test database.

If the DB connection is unreachable, the tests **fail loudly** with a clear "test database
unreachable" error (never silently skipped), so an unverified run can never report a false
green. In CI, `selection-list-service-integration-tests` always provides a migrated Postgres,
so this holds there.

### Both renderings of the injected row

A service build stores and looks up `selection_list_access.user_id` by the user's TypeID (`usr_...`) or by its
bare UUID, depending on the build. `insertDirectAccessGrant` (helpers/db.ts) therefore writes the injected
`USER_B` grant in **both** renderings (and `removeDirectAccessGrant` / `directAccessRowCount` address both), and
`beforeEach` asserts that both rows landed. A row in only one form would be invisible to a service keyed by the
other, and the test would pass without ever exercising "the mirror is consulted".

### Proving the test is not vacuous (manual mutation check)

This needs a service that consults the mirror, so it cannot run in CI. To re-check after touching the injection:
in a scratch copy of the BUILT service (`services/selection-list-service/dist/middleware/authz.js`), insert before
`const decision = await getAuthzClient().check(` in `requireAuthzCheck`:

```js
if (process.env.MUTATE_MIRROR && listId) {
  const keyUser = process.env.MUTATE_MIRROR === 'uuid' ? require('@izzywdev/fuzefront-identity').toUuid(userId) : userId;
  const hit = await db('selection_list_access').where({ list_id: listId, user_id: keyUser }).whereNull('revoked_at').first();
  if (hit) { next(); return; }   // the mirror treated as an authority
}
```

(`db` is whatever the compiled file calls the knex handle, `db_1.db` today.) Start the service with
`MUTATE_MIRROR=typeid`, then `MUTATE_MIRROR=uuid`, and run `npx jest security/mirror-not-authority`: the six
`USER_B cannot ...` tests must FAIL under both. Recorded result (current master service): both forms fail 6 of 8.
The previous harness (TypeID-only injection) failed 6 of 8 under `typeid` but PASSED 8 of 8 under `uuid` - the
vacuous pass this fixes. Against the PR #1462 service (bare-UUID rows) the new harness fails 6 of 8 under both forms, and the old one
failed 6 of 8 under `typeid` but passed 8 of 8 under `uuid`. Discard the patched `dist` afterwards (rebuild).

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
