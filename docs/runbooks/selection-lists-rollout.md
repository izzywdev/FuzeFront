# Runbook — selection-lists production rollout

**Status (updated 2026-10-26, `origin/master` @ `bac173471`): workload ENABLED; flag state UNVERIFIED; shared lists have no UI.**
`selectionListService.enabled` is `true` in `deploy/helm/fuzefront/values-prod.yaml` (flipped by #1592 on
2026-10-21, together with the pinned `platformOrgId` that `gate-platform-org-pin` requires), so the
section 8 "last step" has been **executed**; sections 2-4 and 8 are kept as the checklist to
re-verify and as the record. All three release flags (`fuzefront.selection-lists.service`,
`.seed-defaults`, `.shared-lists`) default OFF and fail closed; **what they are set to in the live
Unleash, whether the pod is healthy, and whether the P6 broker ACLs hold cannot be read from this
repo** and are therefore marked UNVERIFIED below. Note that the owner-directed `all-flags` set of
`prod-unleash-ops` ("bulk GA", 2026-10-18) lists the master and `seed-defaults` flags but **not** `shared-lists`,
so if it was dispatched the base feature may already be ON while shared lists are still OFF. Nothing in this
runbook enables any flag.

This is the readiness checklist plus the enable / ramp / rollback procedure. Read these first
for the parts it does not repeat:

- [`selection-lists-flag-rollout.md`](selection-lists-flag-rollout.md): the flag record, what the flag gates, both-state tests.
- [`selection-lists-seeding-operations.md`](selection-lists-seeding-operations.md): the seeding flag, Kafka topics and monitoring, which are prerequisites for default lists.
- [`docs/security/selection-lists-authz-review-2026-10.md`](../security/selection-lists-authz-review-2026-10.md): the authorization review with a resolution status per finding.
- [`per-service-database-and-role.md`](per-service-database-and-role.md): the dedicated database and role pattern.

## How to read this document: facts vs. things in flight

This runbook was rewritten on **2026-10-05** against `origin/master` @ `86ccadee`; the status block, P1-P5, M5/M6, D1-D5, 3(a)/(c)/(h), sections 8 and 10 were re-verified against `bac173471` on **2026-10-26** (live-cluster, Unleash, Permit and Kafka state is still not readable from the repo). The platform
around the service is changing quickly, so every prerequisite in section 2 is tagged with one of:

| Tag | Meaning |
|---|---|
| **MERGED** | Present on master at the commit above (file named). Re-read it if master has moved. |
| **IN FLIGHT** | A PR exists but was **not merged** when this was written. **Check the PR / merge state before relying on it.** Do not treat the described behaviour as a fact until the PR is merged and the release has bumped the image/chart. |
| **UNVERIFIED** | Needs live-cluster, Permit, Unleash or registry state this author could not read. A command that would settle it is given. |

Anything marked IN FLIGHT below may have merged, changed shape, been split, or been closed since.

## 1. Two kinds of "on" — do not conflate them

| Switch | Where | Effect |
|---|---|---|
| Helm `selectionListService.enabled` | `values-prod.yaml` (GitOps; **merge = production deploy**; **already `true`** since #1592) | Creates the Deployment/Service/Ingress/Middleware/NetworkPolicy and the per-service database Job. The feature is **dark** until the flag is on: the API answers 404 and the shell hides the UI. |
| Unleash flag `fuzefront.selection-lists.service` | Unleash prod, via `prod-unleash-ops` | Turns the feature on for the targeted % of orgs/users: the API stops 404ing, the shell sidebar entry and `/settings/selection-lists*` routes appear. |
| Unleash flag `fuzefront.selection-lists.seed-defaults` | Unleash prod | Separately gates seeding the platform default lists into orgs (see the seeding runbook). Not needed to use lists, only to get the three default lists automatically. |
| Unleash flag `fuzefront.selection-lists.shared-lists` (SL9) | Unleash prod | Gates every shared/common-list and fork behaviour (section 10). Additionally requires the master flag. No workflow enables it; see `selection-lists-flag-rollout.md`, "Third flag". |

Order is always: **prerequisites, then workload (flags OFF), verify it is healthy and 404s, then ramp the flags.**

## 2. Prerequisites

Every row must hold before the final step. Rows marked IN FLIGHT must be re-checked.

### 2.1 What the service needs in the cluster

| # | Prerequisite | State when written | What to check |
|---|---|---|---|
| P1 | **Database password sealed** (`Secret/selection-list-secrets`, key `DB_PASSWORD`, read by the per-service DB bootstrap Job **and** the Deployment) | **MERGED** (file present). `deploy/contabo/sealed/selection-list-secrets.yaml` exists on master alongside the `.template`. The password is minted and sealed by the `rotate-sealed-secret` workflow so no human sees it. Whether the Secret is Synced in the cluster is UNVERIFIED. | `ls deploy/contabo/sealed/selection-list-secrets.yaml`; Argo `fuzefront-sealed` Synced; `kubectl -n fuzefront get secret selection-list-secrets` (UNVERIFIED). **Merge it in its own change, before the final step:** the DB bootstrap Job is a pre-upgrade hook that runs before the sealed-secret sync, so enabling both in one change fails the Job on a missing Secret and fails the whole Argo sync. |
| P2 | **Service machine identity** (OAuth `client_credentials`, scope `authz:admin`) for Security API grant/revoke (creator `list-owner` on create, access grants, seeded-list owner grants). Without it grants **fail closed** (creates 500, no access can be granted) | **MERGED, and different from the original plan.** The Deployment no longer uses OAuth client credentials: it mounts a projected ServiceAccount token (path `fuzefront-security`, audience `fuzefront-security`, 600 s; `templates/selection-list-service-deployment.yaml`) and `src/lib/machineIdentity.ts` exchanges it for exactly two Security-API scopes, `selection-list:owner-grant` and `selection-list:grant-cleanup` (never `authz:admin`). The earlier `SERVICE_CLIENT_ID`/`_SECRET` / register-Job (#1299) design is not what ships. | The pod log line `projected workload identity configured for owner bootstrap and stale-grant cleanup` at startup (or the ERROR `projected workload token missing …`); then create one list as an org admin and confirm the creator is `list-owner`. UNVERIFIED live. |
| P3 | **Kafka topics exist with the intended settings** (13 change topics, 2 outcome topics, `seed.requested` + DLQ with 1-day retention because its messages carry bearer tokens) | **MERGED.** `kafkaTopics.enabled: true` in `values-prod.yaml` (#1298: a non-blocking, bounded Job instead of the old wedging post-upgrade hook); the SL9 topics `selection-lists.list.forked` and `selection-lists.visibility.changed` are declared in `values.yaml`. Whether the Job completed on the cluster is UNVERIFIED; change-event `.dlq` topics are not declared and rely on broker auto-create. | `kubectl -n fuzefront get jobs -l app.kubernetes.io/component=kafka-topics`; list topics via the FuzeInfra `cluster-query` workflow. Detail: seeding runbook section 2.3. |
| P4 | **All three Unleash flags exist in Unleash, OFF** (`fuzefront.selection-lists.service`, `fuzefront.selection-lists.seed-defaults`, and the SL9 `fuzefront.selection-lists.shared-lists`, the last created by the same `flags=selection-lists-create` dispatch once this lands) | **Creation is wired; verify it ran.** The `selection-lists-create` set of `prod-unleash-ops` creates all three flags OFF and never enables anything (create-only; an existing flag is left untouched). It must have been dispatched **after** the SL9 flag-registration change for the third flag to exist. **Check the live state; do not assume.** | Unleash prod admin UI or API: **all three** keys (`fuzefront.selection-lists.service`, `fuzefront.selection-lists.seed-defaults`, `fuzefront.selection-lists.shared-lists`) exist, environment `production` disabled. Never create them by hand in the UI if the workflow can. |
| P5 | **Shared-lists / fork contract and service** (a list that an org shares with others, and forking a common list into an org's own copy) | **MERGED, dark.** Contract 4.1.0 (`openapi.yaml` `info.version: 4.1.0`) and the service implementation are on master; every behaviour is behind `fuzefront.selection-lists.shared-lists` (OFF). Sharing changes who can read what, so run section 10 and re-read the authz section **before** that flag is ever turned on. The UI for it is **not** merged (no shell code reads the flag yet). | `services/selection-list-service/openapi.yaml` `info.version`; section 10; `docs/guides/SELECTION_LIST_SERVICE.md` § "Shared lists, common lists and forks". |
| P6 | **HARD PREREQUISITE: broker ACLs on the `identity.*` topics verified** (only the identity service may produce `identity.org.*` / `identity.user.*`; only the seed senders may produce `selection-lists.seed.requested`) | **FuzeInfra#1394.** **Do not turn the flags on in production until this is verified.** (The workload was deployed by #1592 without any in-repo record that the ACLs were verified, so treat this as an OPEN prerequisite for the first ramp step, and for the shared-lists flag in particular.) Rationale (owner decision): the service deliberately does NOT authenticate event producers in-process (no first-writer-wins owner hardening, no Security-API check before destructive org cascades). Its protection against forged events is therefore the broker: without ACLs any in-cluster workload that can reach Kafka could forge `identity.org.deleted` for an ordinary org (archive or purge a tenant's lists), `identity.user.deleted` (anonymise authorship, revoke a user's grants), `identity.org.created` (swap the owner used for seeded-list owner grants), `seed.requested` (write amplification up to the per-source caps) or flood a topic. The platform org is immune to deletion (it is only suspended) but the rest are accepted residual risks until the ACLs hold. The full list is in the design record, section 12 (Risks). | Ask FuzeInfra (via `@fuze`) for the verified ACL state of the three topic families, or `kafka-acls --list` through the `cluster-query` workflow: produce rights on `identity.org.*` / `identity.user.*` held by the identity service principal only, and on `selection-lists.seed.requested` by the registered seed senders only. UNVERIFIED when written. |

**Hard prerequisite:** Broker ACLs on the `identity.*` Kafka topics verified (FuzeInfra#1394) before the service is exposed to users in production (flags ON). The absence of in-process producer authentication is an **accepted residual risk** until then.

### 2.2 Already on master (re-read if master moved)

| # | Prerequisite | State | Evidence |
|---|---|---|---|
| M1 | Authorization is enforced in production; grants use the machine identity; no implicit admin-to-owner | **MERGED** | `authz.flags.ts` `isAuthzEnforced`, `lib/machineIdentity.ts`, `backend/security/.../authz.ts` grant gate; see the authz review resolution table |
| M2 | `SelectionList` and `SelectionListCatalog` declared in the Permit policy-as-code | **MERGED** (live Permit sync **UNVERIFIED**) | `backend/src/permit/schema.ts`, `backend/security/src/permit/schema.ts`. The `permit-schema-sync` Job applies it where `permit.enabled`; confirm in the Permit dashboard that `SelectionList` and `SelectionListCatalog` and their roles exist, otherwise every check denies |
| M3 | Per-service database and login role `selection_list_svc` created by a pre-upgrade Job from the password in P1 | **MERGED** | `templates/service-db-bootstrap-job.yaml`, `values.yaml` `selectionListService.db.*`, `docs/runbooks/per-service-database-and-role.md` |
| M4 | Flag client in the image and initialised at startup; `/ready` checks the DB; `/metrics`; crash containment | **MERGED** | `src/lib/featureFlags.ts`, `src/routes/health.ts`, `src/lib/http.ts` |
| M5 | Seeding (platform pack, consumers, reconciler, owner grants, SL9 seed-list `visibility`) | **MERGED**, behind `seed-defaults` and `SEED_RECONCILER_ENABLED` (not set by the chart); seed-list `visibility` additionally behind `shared-lists` | seeding runbook. The pack's 10 non-English locales are **machine-translated, pending native review**; they are stored `is_machine: true` (runbook section 2.5; pack-provenance fix is PR #1301, check its merge state) |
| M6 | Image built and bumped by `release.yml` | **MERGED**; tag at time of writing `dbe338ab82c8` (`values-prod.yaml`); re-check that it contains the SL9 service commits you rely on | Re-check that the tag at the time of the final step contains every selection-list commit you rely on: `git merge-base --is-ancestor <commit> <tag-commit>`. UNVERIFIED that the image exists in GHCR: `docker manifest inspect ghcr.io/izzywdev/fuzefront-selection-list-service:<tag>` |

### 2.3 Open decisions and known gaps (owner call before the first ramp step)

| # | Item | Why it matters |
|---|---|---|
| D1 | **Org-scoped token path.** Resolved in code since the first draft: `POST /api/organizations/{orgId}/session-token` (`backend/security/src/services/orgSessionToken.ts`) mints a short-lived `fuze-org-session` token after the active-membership proof, and the shell injects it (`frontend/src/lib/selectionListsAuth.ts`, #1312); see the guide's "Authentication and the org claim". The authz review's I-1 row is a 2026-10-05 snapshot and still reads OPEN | Verify end to end on the first ramp step: UI visible + API 401 means the exchange is failing |
| D2 | Authz review **M-2** and **M-4**: resolved in code since the first draft (the last-owner guard asks the Security API, `src/services/authority.ts`; `user_lists` / `list_locales` / the archived-rows ceiling are enforced, `src/services/quota.service.ts`; ingress rate limits `selectionListService.ingress.rateLimit.*`). The review's table is a snapshot and still reads OPEN | Confirm in the guide's "Access control" and "Quota" sections; record the decision |
| D3 | `POST /tenants` and `GET /tenants` on the Security API are still open to any authenticated caller (residual of authz review C-1) | Platform-wide, not specific to this service |
| D4 | The MCP gateway (`selectionListsMcp.enabled: false`): its upstream now targets `fuzefront-selection-list-service` (`templates/selection-list-service-mcp-gateway.yaml`), so the host mismatch of authz review I-1c is fixed | Still keep the gateway **off** until an owner decision; it is dark by default |
| D5 | `selection_list_access` mirror lags a Security-API-only grant; app-seeded lists get no owner grant (the org owner is granted on platform-seeded lists only). Seed-list `visibility: org` (shared-lists flag ON) is the member-visibility fix, and nothing that ships declares it | seeding runbook section 6 |

### 2.4 Platform organization: configurable everywhere, derived and enforced in production

`selectionListService.platformOrgId` (Deployment env `SELECTION_LIST_PLATFORM_ORG_ID`) names the organization whose operators may publish a **common (global) list** to every other organization. It stays **configurable per environment** (a local cluster may use any id), but **production may only carry the immutable root platform organization**, so a typo or a mistaken or malicious chart edit cannot hand global-publish power to an ordinary org.

- **Nobody types the id into the gate.** The gate derives the expected production id from the code: it parses `export const ROOT_ORG_ID = '<uuid>'` in `backend/security/src/migrations/014_seed_root_platform_organization.ts` (currently `00000000-0000-0000-0000-000000000010`, the seeded root org) and converts it to the canonical TypeID with the identity codec (lowercase Crockford base32 of the 128-bit UUID), currently `org_0000000000000000000000000g`. Note the UUID ends in `10` (hex) and the TypeID ends in `0g`: the id is not "...1". If the constant cannot be found or parsed (or is defined more than once there), the gate fails.
- **Drifted copies fail the gate.** Every other `ROOT_ORG_ID = '<uuid>'` definition in the repo's TS/JS sources and tests (the applications service and migrations, the monolith migration 015, the devportal middleware, the frontend constant, test mocks) must equal the authoritative value. A copy that has drifted is a real hazard and is reported with its file and line.
- **Why it is not a GitHub Actions repository variable.** A repo variable can be changed by any repo admin with no PR, no review and no audit trail, which defeats a gate whose purpose is to catch mistaken or malicious edits. Deriving the id from reviewed code keeps every change under code review and CODEOWNERS (the gate, its tests, its workflow and the authoritative migration are owner-protected). If the owner ever insists on a variable, it may only be added as an extra must-equal cross-check, never as the source. The id is not a secret (it is a public identifier already present in several services), so secrecy is not the reason.
- **Empty is the default and means "fail closed"**: every platform feature is off, no common list is served or created. That is the correct state while `selectionListService.enabled` is `false`.
- **The gate** is the CI job `gate-platform-org-pin` (`scripts/gate_platform_org_pin.py`, tests in `scripts/__tests__/test_gate_platform_org_pin.py`). It reads only the **production** overlay and prints which rule it applied. It fails when:
  1. `values-prod.yaml` sets `platformOrgId` to anything other than `""` or exactly the derived id (strict string equality: the bare UUID, other letter case or surrounding whitespace are rejected);
  2. the Helm-merged effective production values disagree with rule 1 (an inherited or overridden value), or `enabled` is not a real boolean;
  3. `selectionListService.enabled` is `true` in production while `platformOrgId` is empty or not the derived id (an enabled production service with no platform org is an explicit failure, never a silent fail-closed deploy);
  4. the **rendered** production manifests (`helm template` with the production overlay) carry `SELECTION_LIST_PLATFORM_ORG_ID` as anything but the derived id (when enabled), or a probe render with the service forced on would carry a value other than `""` or the derived id (a template or override elsewhere cannot smuggle in another org);
  5. the authoritative constant is missing, unparsable or defined twice, any other `ROOT_ORG_ID` definition disagrees with it, or a values file or the chart cannot be read, parsed or rendered. It fails closed and never skips.
- **Enabling it in production** therefore takes two things in the same reviewed change: `selectionListService.enabled: true` (section 8) **and** `selectionListService.platformOrgId: "org_0000000000000000000000000g"` in `values-prod.yaml`, or the gate fails the PR. Shared lists additionally need the release flag `fuzefront.selection-lists.shared-lists`.
- **Changing the expected id** is not an operation on the gate: it only follows the `ROOT_ORG_ID` constant. Changing that constant is a code change to an immutable seeded identity (it orphans every row bound to it) and needs owner review like any CODEOWNERS path. Do not edit the chart, the gate's strict comparison or its tests to get around a failure.
- **Local and other overlays** are not checked and may set any id.
- **Branch protection:** adding `gate-platform-org-pin` to the required status checks of "Protect Master" is an owner action; until then the check runs on every PR and on `master` but does not block merging.

## 3. Readiness checklist (read from the repo; re-verify against live where marked)

### (a) Container image

| Check | Evidence | Status |
|---|---|---|
| Image built by `release.yml` and tag bumped in `values-prod.yaml` | step "Build & push selection-list-service" in `.github/workflows/release.yml`; the bump anchors on the `repository:` line followed directly by `tag:` | VERIFIED (read) |
| Pinned tag is a real, recent build containing the hardening | `values-prod.yaml` `tag: dbe338ab82c8` (bumped by `release.yml`; check each commit you depend on with `git merge-base --is-ancestor <commit> <tag-commit>`) | tag VERIFIED (read); contents and registry presence UNVERIFIED |
| Image boots | `Dockerfile` ships `@fuzefront/auth` and `@fuzefront/feature-flags` with their runtime deps | VERIFIED (read); runtime UNVERIFIED |

### (b) Database

| Check | Evidence | Status |
|---|---|---|
| Migrations | run **in-process at app start** (`src/index.ts` `runMigrations()`; failure exits non-zero, so a bad migration shows as CrashLoopBackOff and never serves a half-migrated schema); knex lock makes concurrent starts safe | VERIFIED (read) |
| Database + role | created/reconciled by `templates/service-db-bootstrap-job.yaml` (pre-upgrade hook) as role `selection_list_svc` (LOGIN, no createdb/createrole), password from `selection-list-secrets/DB_PASSWORD` (**P1**) | VERIFIED (read); execution UNVERIFIED |
| TLS | `selectionListService.db.ssl: "true"` (knexfile production default, certificate verified). Whether the FuzeInfra Postgres serves a certificate this client trusts is **UNVERIFIED**; if the pod logs `server does not support SSL` or a certificate error, set `db.ssl: "false"` as a reviewable one-line values change, never edit the code | UNVERIFIED |
| FuzeInfra-owned pieces | None required: database/role creation is this chart's own hook using the existing Postgres superuser secret. **Never edit FuzeInfra from here**; delegate anything else via `@fuze` | VERIFIED (read) |

### (c) Secrets / env wired in the Deployment

| Env | Source in `templates/selection-list-service-deployment.yaml` | Status |
|---|---|---|
| `DB_HOST` `DB_PORT` `DB_NAME` `DB_USER` `DB_PASSWORD` `DB_SSL` | values + `selection-list-secrets/DB_PASSWORD` (no `DATABASE_URL`) | wired; Secret missing until **P1** |
| `JWT_SECRET` | `fuzefront-secrets/JWT_SECRET` (the shared platform secret, verify-only) | wired |
| `SECURITY_SERVICE_URL` | `http://fuzefront-security:<securityService.port>` | wired |
| `KAFKA_BROKERS` | `fuzeinfra-kafka.fuzeinfra.svc.cluster.local:9092` (same broker Service as chat/applications). Service-name resolution UNVERIFIED: `-n fuzeinfra get svc` | wired |
| `FUZEFRONT_SELECTION_LIST_AUTHZ_ENABLED` | `authzEnabled: true`, declared so the manifest states the posture; **in production authz is always enforced regardless** | wired |
| `UNLEASH_URL` / `UNLEASH_APP_NAME` / `UNLEASH_CLIENT_TOKEN` | prod `featureFlags.*` -> `unleash-secrets/UNLEASH_CLIENT_TOKEN` (`optional: true`). The service now calls `init()` | wired; token presence UNVERIFIED |
| Projected workload token (no client id/secret) | `volumes: fuzefront-workload-token` (ServiceAccount token, audience `fuzefront-security`), read by `src/lib/machineIdentity.ts`; see **P2** | wired |
| Permit PDP / API keys | intentionally absent: authorization goes through the Security API | VERIFIED (read) |

### (d) Kafka consumers

Consumers (org created/updated/deleted, user deleted, seed requested) start whenever `KAFKA_BROKERS` is set and **never** take the API down if Kafka is unreachable. Topic existence is **P3**; consumer groups, DLQs and monitoring are in the seeding runbook sections 2.3 and 4. The org-deleted and user-deleted handlers are fixed (authz review M-3, resolved).

### (e) Health, readiness, NetworkPolicy, metrics

| Check | Evidence | Status |
|---|---|---|
| Probes | readiness `GET /ready` (bounded `select 1`), liveness `GET /health` (cheap) | VERIFIED (read) |
| NetworkPolicy | `fuzefront-selection-list-service-ingress`: TCP `selectionListService.port` (3008, declared explicitly in values, no cast) from `kube-system` (Traefik) and the release namespace | VERIFIED (rendered; see section 8) |
| Metrics | `GET /metrics` (process metrics + request-duration histogram, no id labels); pod carries the scrape annotations. Whether the monitoring namespace is admitted by the NetworkPolicy and a dashboard/alert exists is **UNVERIFIED** | partially verified |

### (f) Permit

Declared in policy-as-code (**M2**). Live application of the schema is UNVERIFIED: Permit dashboard, or the post-sync `permit-schema-sync` Job log. If it is missing every `check` denies and every create fails on the `list-owner` grant.

### (g) Shell sidebar entry and routes gated by the flag

| Check | Evidence | Status |
|---|---|---|
| Sidebar entry | `frontend/src/components/SidePanel.tsx` `useFlag('fuzefront.selection-lists.service', false)` | VERIFIED (read) |
| Routes | `frontend/src/App.tsx` flag-gated routes; deep links wait for the flag to load | VERIFIED (read) |
| Browser can see the flag | key is in `WEB_EXPOSED_FLAGS` (`packages/feature-flags/src/catalog.ts`) | VERIFIED (read) |
| Server gate | router-level `requireSelectionListsFlag` mounted before every `/v1/selection-lists/*` router; fails closed on evaluation error; `/v1/resolve` has its own | VERIFIED (read) |
| Edge route | Ingress publishes only `/api/v1/selection-lists` and `/api/v1/resolve` on `app.fuzefront.com` with a `stripPrefix /api` Middleware; no edge auth bypass | VERIFIED (rendered) |

### (h) Observability

Structured pino logging with a per-request `reqId`; `/metrics` (above). **No dashboards or alerts** exist for this service (UNVERIFIED in the live cluster). Interim ramp signals: pod status/restarts, `kubectl logs` for `level>=50`, ingress 5xx for `app.fuzefront.com/api/v1/selection-lists`, `knex_migrations` row count = the number of migrations (13 at the time of writing: `ls services/selection-list-service/src/db/migrations`).

### (i) Rollback

| Layer | Action | Effect |
|---|---|---|
| Flag (fast, seconds, no deploy) | Dispatch `prod-unleash-ops` with `flags=selection-lists`, `action=disable` (section 5). | API routes answer **404** for everyone (also fail-closed on Unleash error); shell entry and routes disappear on the next `/api/flags` read. The strategy is kept, so re-enable returns to the same %. |
| Workload (deploy) | `git revert` the section 8 commit (a single line, `enabled: true -> false`) and merge in a deploy window. | Argo prunes the Deployment/Service/Ingress/Middleware/NetworkPolicy. The `fuzefront_selection_list` database and its data are **not** dropped. |
| Data | **Forward-only.** Lists/items/translations/grants created while ON stay in the DB; a data rollback is a separate migration, never a toggle. |

## 4. Deploy sequence

Merge **in this order**, each as its own change, checking Argo state between steps. Merge = production deploy; never hand-deploy or operate the cluster from here.

1. **P1**: the sealed `selection-list-secrets` (DB password). Wait for Argo `fuzefront-sealed` Synced.
2. **P3**: the Kafka topics Job (so `seed.requested` retention is right before anything can publish).
3. **P4**: the Unleash flags exist, OFF. Dispatch the workflow set that creates them once its PR is merged.
4. **P2**: the machine identity (register Job or an equivalent), then introspect one token and confirm `authz:admin`.
5. Confirm **M2** (Permit schema applied), **D1** (org-scoped token path) and record **D2**/**D4** decisions.
6. Make sure `values-prod.yaml` pins an image tag that contains everything above (re-read **M6**).
7. **Section 8**: the one-line flip, in a deploy window.
8. Verify the workload with the flags still OFF (section 6, stage 0), then ramp (section 5).

`selectionListsMcp` stays `false` (**D4**).

## 5. Unleash ramp procedure

Source: `.claude/skills/unleash-flag-enable/SKILL.md` and `.github/workflows/prod-unleash-ops.yml`. It runs on the in-cluster `fuzefront` runner (no CF-Access session, no token handling) and reads the admin token from `unleash-secrets`. Each step is idempotent: an existing `flexibleRollout` strategy is PATCHed, never duplicated; `stickiness: default` plus a fixed `groupId` keep a user in the same bucket as the % grows. Do **not** run any of this before the section 4 steps are done.

Preconditions (skill): the flag is default-OFF and tested both ways (done, see the flag runbook); an owner decision (who, target %, date) is recorded on the requesting PR/issue; the flag is in `WEB_EXPOSED_FLAGS` (it is).

```
gh workflow run prod-unleash-ops.yml --repo izzywdev/FuzeFront \
  -f flags=selection-lists -f action=enable -f rollout=10     # then 25, 50, 100
# rollback / disable:
gh workflow run prod-unleash-ops.yml --repo izzywdev/FuzeFront \
  -f flags=selection-lists -f action=disable
```

`fuzefront.selection-lists.seed-defaults` is **not** ramped by percentage: the seeding path evaluates it with an `orgId` only (no `userId`), so use per-org targeting with an `orgId` constraint (`org_…` TypeID form, now canonicalised for every evaluation). See the seeding runbook section 3; at the time of writing `prod-unleash-ops` has no ramp entry for it (P4 only makes it **creatable**), so enabling it uses the raw `unleash-flag-enable` procedure.

Caveat on the workflow's own verification: its **Verify** step only prints the environment state (`ON`/`OFF`) and exits 0 silently if the admin token cannot be read; it does **not** print the rollout percentage or prove evaluation. Do the explicit both-state checks below at every step.

### Verifying BOTH states at each step

| State | Check | Expected |
|---|---|---|
| Flag ON for a bucketed user | Signed-in user in the rollout: `GET https://app.fuzefront.com/api/flags` | `"fuzefront.selection-lists.service": true`; sidebar shows "Selection Lists"; `/settings/selection-lists` renders; `GET /api/v1/selection-lists` returns 200, not 404/401. |
| Flag OFF (not in bucket, or after `disable`) | Same calls as a user outside the %, or after rollback | `/api/flags` shows `false` / key absent; no sidebar entry; `/settings/selection-lists` redirects to `/dashboard`; `GET /api/v1/selection-lists` returns **404** `{"code":"NOT_FOUND"}`. |
| Unleash unreachable | (Do not induce in prod.) In-code fail-safe | The release flag evaluates OFF everywhere (404 / UI hidden), never ON. |
| UI/API agree | For the same user, the UI entry and the API both on, or both off | A visible menu with an API 404 or **401** is a no-go (a 401 is **D1**). |
| Authz | A member with no grant on a list; an admin creating a list | The member cannot read/purge a list they hold no role on; the creator is `list-owner` of what they create (proves the machine identity, **P2**). |

Console-clean check (`ui-runtime-validation` skill) on `/settings/selection-lists` for a bucketed user at each step.

### Go / no-go criteria per stage

| Stage | Gate to START | Soak | Go (advance) when | No-go / rollback when |
|---|---|---|---|---|
| 0 - workload live, flags OFF | section 4 steps 1-7 done; authz decisions recorded | until the pod is stable | Pod `Running`, 0 restarts, `/ready` green; `knex_migrations` complete (log `Applied migration(s)` / up to date); `GET /api/v1/selection-lists` returns 404 for everyone; NetworkPolicy/Ingress present; `app.fuzefront.com` unaffected; Kafka consumers started (non-fatal if absent) | CrashLoop/ImagePullBackOff/CreateContainerConfigError (missing Secret = **P1/P2** not done); any non-404 from the API with the flag OFF (flag gate broken: **disable the workload**); regression on other routes under `/api` |
| 1 - 10% | stage 0 go; owner decision recorded | >= 1 day | Zero 5xx / `INTERNAL_ERROR` on `/api/v1/selection-lists/*`; both-state checks pass; console clean; no unexpected 403 for a legitimate admin; no restarts; UI and API agree | Any 5xx burst, authz denial for a legitimate org admin, **cross-org data in any response (immediate `action=disable`, page security)**, UI/API disagree, restart loop |
| 2 - 25% | stage 1 go | >= 1 day | As stage 1; quota endpoint sane; latency acceptable (use ingress/pod logs and `/metrics`) | As stage 1 |
| 3 - 50% | stage 2 go | >= 1 day | As stage 1; DB connections/CPU/memory within limits (`kubectl top pod`); Kafka DLQs empty or understood | As stage 1; OOMKilled; sustained CPU throttling |
| 4 - 100% | stage 3 go; **D2** closed or explicitly accepted for GA | stable one release cycle | As stage 1. Then schedule flag removal per the flag record (delete the flag, the `SidePanel`/`App.tsx` guards, `src/flags.ts`, `middleware/flagGate.ts` in one PR) | As stage 1 |

## 6. Verification commands (read-only; use the FuzeInfra `cluster-query` workflow for prod cluster reads)

```
# workload gate (stage 0)
gh workflow run cluster-query.yml --repo izzywdev/FuzeInfra -f kubectl_args='-n fuzefront get pods -l app=fuzefront-selection-list-service -o wide'
gh workflow run cluster-query.yml --repo izzywdev/FuzeInfra -f kubectl_args='-n fuzefront logs deploy/fuzefront-selection-list-service --tail=100'
gh workflow run cluster-query.yml --repo izzywdev/FuzeInfra -f kubectl_args='-n fuzefront get secret selection-list-secrets'
gh workflow run cluster-query.yml --repo izzywdev/FuzeInfra -f kubectl_args='-n fuzeinfra get svc'      # Kafka/Postgres service names
```

Edge probe (not cluster): `curl -s -o /dev/null -w '%{http_code}\n' https://app.fuzefront.com/api/v1/selection-lists` -> `401` unauthenticated (auth runs before the flag gate), `404` authenticated with the flag OFF.

## 7. Delegations (drafted, NOT SENT)

**To `@fuze` backend-engineer (FuzeFront):** the org-scoped token path (**D1**); the last-owner guard against the Security API, grant revocation on user delete and list purge (**M-2**, **L-5**); enforcing `user_lists` / `list_locales` and a hard storage ceiling (**M-4**); pinning `HS256` and rejecting workload/delegation tokens in `middleware/auth.ts` (**L-2**); human-gating `POST /tenants` (**D3**).

**To devops-engineer (FuzeFront):** the MCP gateway upstream host (**D4**); an ingress rate limit on `/api/v1/resolve` and the write routes (**M-4**); dashboards/alerts for the service.

**To `@fuze` FuzeInfra - nothing required.** Optional read-only confirmations: (a) the Kafka bootstrap Service DNS name in `fuzeinfra`; (b) whether `postgres.fuzeinfra` serves TLS this client trusts; (c) that the selection-lists topics exist (or that the topics Job ran).

## 8. The last step: the one-line prod values flip

> **EXECUTED.** #1592 (2026-10-21) flipped `selectionListService.enabled` to `true` in `values-prod.yaml`, and `platformOrgId: org_0000000000000000000000000g` is pinned there (`python3 scripts/gate_platform_org_pin.py` prints PASS, `RULE APPLIED enabled-requires-pinned`). The text below is kept as the record and as the rollback reference (`git revert` of that commit disables the workload); it is **not** a pending step. The PR description of #1592 records a purely additive render diff; the P1/P3 ordering caveats below were not re-verified by this docs pass.

**Do this only after every row in sections 2 and 4 is satisfied, in a deploy window, as its own PR.** Merging it deploys to production. It is the only change that creates the workload; the flags stay OFF until section 5.

The whole change, in `deploy/helm/fuzefront/values-prod.yaml` (the first key under `selectionListService:`, currently line 1035):

```diff
 selectionListService:
-  enabled: false
+  enabled: true
+  platformOrgId: "org_0000000000000000000000000g"
```

The second line is **required by the `gate-platform-org-pin` CI job** (section 2.4): with the service enabled, production must carry exactly the root platform organization id the gate derives from `ROOT_ORG_ID` (section 2.4), and the PR fails otherwise. It is the only value the gate accepts there.

Mechanical form (does nothing if the block has already moved; check the diff is exactly the two lines above):

```
sed -i '/^selectionListService:$/{n;s/^  enabled: false$/  enabled: true\n  platformOrgId: "org_0000000000000000000000000g"/}' deploy/helm/fuzefront/values-prod.yaml
git diff --stat   # expect: 1 file changed, 2 insertions(+), 1 deletion(-)
python3 scripts/gate_platform_org_pin.py   # expect: PASS, RULE APPLIED enabled-requires-pinned
```

Do **not** touch `selectionListsMcp` (it stays `false`), do not change the image tag in the same commit (the release bump owns it), and do not set any flag here.

Render check performed when this was written (`helm template` with `values.yaml` + `values-prod.yaml`, `--set secret.authentikClientSecret=ci-placeholder`): flipping the one line adds exactly six resources and changes nothing else: `NetworkPolicy/fuzefront-selection-list-service-ingress`, `Service/fuzefront-selection-list-service`, `Deployment/fuzefront-selection-list-service`, `Ingress/fuzefront-selection-list-service`, `Middleware/selection-list-service-stripprefix`, and the pre-upgrade `Job/fuzefront-svcdb-selection-list-service`. If a re-render shows more or fewer (for example a register Job once **P2** merges), re-read the prerequisites. Because the Job is a pre-upgrade hook that needs **P1**, a missing Secret fails the whole sync, which is why P1 merges first.

After the merge: Argo sync green, then section 6 / stage 0, **with both flags still OFF**.

## 9. Out of scope for this runbook

App code / API / authz policy (`backend-engineer`, authz review), the shell UI and `@fuzefront/selection-lists-ui` (`frontend-engineer`), tests (`test-engineer`, `frontend-test-engineer`), org-wide hardening policy (`platform-governance`), and the shared cluster (FuzeInfra).

## 10. Shared lists (SL9): run BEFORE turning `fuzefront.selection-lists.shared-lists` on

This section applies to the third flag (`fuzefront.selection-lists.shared-lists`, design record
`docs/planning/selection-lists-shared-and-fork.md`). The workload has been deployed in production only since
#1592 (2026-10-21) and was dark behind the master flag, so the audit below is expected to return **no rows**
(unless the master flag was ramped on an image that predates the cross-rendering key rule below). Run it anyway: with the flag ON the service treats the bare-UUID and the
`org_…` rendering of one organization id as the same organization, and the database constraint
`UNIQUE (organization_id, key)` does not (it compares the stored text).

### 10.1 Pre-enable audit (read-only): the same key under two renderings of one org

Creating or renaming a list is refused (409) when the key already exists for the same org under ANY rendering of its id,
whatever the shared-lists flag says, so duplicates can only exist in data written before that rule (or by hand). The audit
below finds them; at read time, with the flag ON, exactly one is effective (the one the caller can read: active, the
caller's own rendering, oldest, smallest id).

Run against the service database (`selection_list_svc`, read access is enough). It groups rows by the organization's
**UUID** (taken from the org projection, which stores both renderings of every org it has seen) and reports every
group with more than one row for a key **and** more than one stored rendering:

```sql
-- A. keys duplicated across renderings of the same org (expect 0 rows)
WITH rows AS (
  SELECT l.id, l.organization_id, l.key, l.status, l.visibility, l.created_at,
         COALESCE(r.entity_id, l.organization_id) AS org_uuid
    FROM selection_lists l
    LEFT JOIN selection_list_ref_index r
           ON r.entity_type = 'organization'
          AND (r.wire_id = l.organization_id OR r.entity_id = l.organization_id)
)
SELECT org_uuid, key,
       count(*)                                   AS rows,
       array_agg(organization_id ORDER BY created_at, id) AS stored_as,
       array_agg(id ORDER BY (status = 'active') DESC, created_at, id) AS ids_winner_first
  FROM rows
 GROUP BY org_uuid, key
HAVING count(*) > 1 AND count(DISTINCT organization_id) > 1
 ORDER BY org_uuid, key;

-- B. forks of the same common list held by one org under two renderings (expect 0 rows)
WITH rows AS (
  SELECT l.id, l.organization_id, l.forked_from_list_id, l.created_at,
         COALESCE(r.entity_id, l.organization_id) AS org_uuid
    FROM selection_lists l
    LEFT JOIN selection_list_ref_index r
           ON r.entity_type = 'organization'
          AND (r.wire_id = l.organization_id OR r.entity_id = l.organization_id)
   WHERE l.forked_from_list_id IS NOT NULL
)
SELECT org_uuid, forked_from_list_id, array_agg(id ORDER BY created_at, id) AS fork_ids
  FROM rows
 GROUP BY org_uuid, forked_from_list_id
HAVING count(*) > 1 AND count(DISTINCT organization_id) > 1;

-- C. organizations whose renderings this audit cannot pair (not in the org projection): expect 0 rows.
--    A TypeID cannot be decoded in SQL; if rows appear, decode them with the identity package
--    (`toUuid('<org_…>')`) and re-run A/B for those orgs by hand.
SELECT DISTINCT l.organization_id
  FROM selection_lists l
 WHERE NOT EXISTS (SELECT 1 FROM selection_list_ref_index r
                    WHERE r.entity_type = 'organization' AND (r.wire_id = l.organization_id OR r.entity_id = l.organization_id));
```

If A, B and C return nothing, there is nothing to reconcile: go on with section 5.

### 10.2 Reconciliation (only if A or B returned rows)

**Which row wins** — the same rule the service applies at read time, so reconciling changes nothing a user can see:
an **active** row beats an archived one; then the **oldest** (`created_at`), then the smallest `id`. (At read time an
exact match of the caller's claim also outranks age; after reconciliation there is only one row, so that no longer
matters.) The winner keeps its key, its id, its items, translations and grants. **Stored values elsewhere point at ids,
so no id is ever deleted or changed.**

**What happens to the loser** — it is renamed out of the way and archived, never deleted (its ids keep resolving, its
audit trail stays). Preferred path, per loser (emits `list.updated` through the outbox, needs a `list-owner`/admin
token of that org): `PATCH /v1/selection-lists/{loserId}` with
`{"key": "<key>--dup-<first 8 chars of the id>", "status": "archived"}`.

Fallback when no token can be produced, **with the shared-lists flag still OFF**, in one transaction, losers taken from
query A (`ids_winner_first` without its first element) — it bypasses the outbox, so downstream projections learn the
new key only from the next change of that list:

```sql
BEGIN;
UPDATE selection_lists
   SET key = key || '--dup-' || substr(id, length(id) - 7),
       status = 'archived',
       updated_at = now()
 WHERE id IN ('<loser id>', '<loser id>');
-- re-run query A: it must now return 0 rows
COMMIT;
```

For B (duplicate forks): keep the winner (same rule), archive the loser fork and rename its key as above; then confirm
`POST /v1/resolve` of one of the org's stored common ids returns one `effective_item_id`.

**Order of operations:** audit (10.1) → reconcile (10.2) → re-run the audit (0 rows) → only then set
`fuzefront.selection-lists.shared-lists` ON. Do not skip the re-run.

#### Access mirror rows under both renderings of one user (informational; no action required)

Lists created before the
rendering-aware code can hold `selection_list_access` rows for BOTH the bare UUID and the `usr_...` TypeID of one user
(the `(list_id, user_id)` key is exact). The service treats all live rows of a user as ONE grant group: `GET .../access`
lists the user once (survivor = the row under the Permit key form, i.e. the bare UUID, then the oldest `granted_at`, then
the smallest `user_id`); `DELETE` revokes every row's authority grant and soft-revokes every row; `PUT` converges the group
to exactly one live row with the new role (every other role in the group is revoked first); the last-owner guard counts the
pair as one owner (and the user as an owner when any row is). A TypeID cannot be decoded in SQL, so pairs are found with the
identity package; the legacy-rendering rows to look at are:

```sql
-- D. live access rows stored under the usr_ rendering (legacy; pair them with a bare-UUID row of the same list by decoding)
SELECT list_id, user_id, role, org_id FROM selection_list_access WHERE user_id LIKE 'usr_%' AND revoked_at IS NULL ORDER BY list_id, user_id;
```

Nothing needs to be reconciled by hand: the next `PUT` or `DELETE` of such a user through the API collapses the group.

### 10.3 The platform organization: deactivation = writes suspended, reads available

`SELECTION_LIST_PLATFORM_ORG_ID` must be a codec-valid `org_…` TypeID. A value that merely looks like one
(`org_notatypeid`) is a **fatal boot error** (`PlatformOrgConfigError`, the pod crash-loops with a clear message),
not a silent "waiting for the projection".

The platform org owns every common list, so its lifecycle events are never allowed to delete or break them:

| Event for the platform org | What the service does |
|---|---|
| `identity.org.deleted` (soft or hard) | **Nothing is deleted, archived or tombstoned.** Platform **writes are suspended** (`selection_list_ref_index.suspended_at` is set); logged at **error** with the event's `correlationId` (`SECURITY: … platform WRITES are SUSPENDED`) |
| `identity.org.updated` / `identity.org.created` with `isActive:false` | Same: writes suspended, projection otherwise unchanged |
| `identity.org.updated` / `identity.org.created` that changes its type away from `platform` | **Refused** (logged at error), no state change |
| `identity.org.updated` / `identity.org.created`, `isActive:true`, type `platform` (re-activation) | Suspension **cleared**, writes resume; logged at **warn** (`platform writes RESUMED`) |

While suspended, **reads keep working for every tenant** (common lists, items, resolve, ids, fork), and these are
refused with 403: `publish_platform` (publishing, promoting a list to `platform`), any mutation of a `platform` list or
its items/translations/grants by the platform org, purge of a platform list or item, and seeding of platform lists
(`seed.failed`/`INTERNAL_ERROR`, retryable — it succeeds after reactivation). The state is read fresh on every request;
the platform-org cache never masks it.

**Ordering (the lifecycle topics have separate consumer groups, so events arrive out of order).** Every suspension
path (`org.deleted` soft/hard, `org.updated`/`org.created` with `isActive:false`) compares the event's ORIGINAL
`occurredAt` (never altered: the ordering value is identical on every delivery) with the newest snapshot already applied
(`snapshot_at`).

**Future-dated envelopes are REJECTED, not clamped.** The three org lifecycle handlers (`org.created`, `org.updated`,
`org.deleted`, ordinary and platform orgs alike) acknowledge and **ignore** an envelope whose `occurredAt` is more than
the skew tolerance ahead of this service's clock: warn `REJECTED a future-dated org lifecycle envelope …` with the
`correlationId` and `occurredAt`, nothing applied (no projection, no suspension, no resume, no cascade, no seed). The
tolerance is `SELECTION_LIST_EVENT_FUTURE_SKEW_SECONDS` (default **300** = 5 minutes). A clamp to now was unsafe: the same
event got a different, later ordering instant on every redelivery, so a redelivered future-dated activation could clear
a genuine suspension (and the mirror case could re-suspend). An event inside the tolerance is applied with its original
timestamp, so a skew of up to the tolerance can make events of the next few minutes look stale (bounded, self-healing).
**A legitimately skewed producer clock drops the event** (the warn names it); fix the clock and have an operator re-send it
(for an `org.deleted` that was dropped the org simply keeps its data until the re-send).

| Deactivation vs newest applied snapshot | Result |
|---|---|
| strictly **newer** | suspends; records the instant in `suspended_event_at` (the snapshot clock is *not* moved) |
| **older** (stale) | ignored; **warn** `a STALE deactivation … was ignored` with the `correlationId` |
| **same instant** (tie) | ignored, **ties go to active**; warn `… SAME instant …`. Rationale: an activation and a deactivation cannot both win; the side that fails open is recoverable (re-send the deactivation), a suspension nothing will ever clear is not |

An activation (`isActive:true`, type `platform`) resumes only if it is **not older** than `suspended_event_at` (a tie
resumes). So a stale activation cannot resume a newer deactivation, and a replay of an old deactivation after the
resume is stale and ignored. A repeated deactivation keeps the first `suspended_at`; a repeated activation resumes once.
An early `org.deleted` for a not-yet-projected platform org creates a typeless suspended row; the org's own (older)
`org.created` still types it but resumes only if newer than the deactivation.

**The gate is flag-independent.** With `fuzefront.selection-lists.shared-lists` OFF (rollback / fail-safe) a suspended
platform org still refuses (403 `platform_suspended`) every mutation of a `platform`-visibility row it owns: list
PATCH/archive/restore, items, translations, access, and purge; and a pack upgrade is not seeded into it. Non-platform
rows and an unsuspended org keep their 4.0.0 behaviour with the flag OFF.

**Suspension follows the OWNER of the platform rows, not the configuration.** The gates (request-level, in-transaction,
purge, seeding) ask "is the org that owns *this* `platform` row suspended?" against the projection - they never ask
"is `SELECTION_LIST_PLATFORM_ORG_ID` suspended?". Removing or changing the variable after common rows exist therefore
does **not** lift a suspension: the former owner's rows stay write-refused (403 `platform_suspended`; seeding
retryable) until that org is reactivated. Any org that owns a `visibility = 'platform'` row is protected from the org
lifecycle consumers and is suspended (not deleted) by its own deactivation event, configured or not.

**No race with a deactivation.** The deactivation recording and the resume take the **same per-org outbox lock** every
mutating transaction takes first, and every mutating transaction re-reads the suspension (fresh) under that lock before it
writes anything (list PATCH/archive/restore/DELETE, items, list and item translations, access PUT/DELETE, publish/promote,
seeding). A write is either committed before the deactivation was recorded (a legitimate pre-suspension write) or is refused
with nothing written and no event queued; none can commit after `suspended_at` is set.

**Operator recovery.** A *legitimate* deactivation: nothing to do (that is the intended outcome). A *forged or
mistaken* one: confirm in the log (`grep 'platform WRITES are SUSPENDED'`, note the `eventId`), then either have
identity re-emit `identity.org.updated` with `isActive:true` for the platform org, or, if that is not possible,
clear the flag directly:

```sql
SELECT wire_id, suspended_at FROM selection_list_ref_index WHERE wire_id = '<SELECTION_LIST_PLATFORM_ORG_ID>';
UPDATE selection_list_ref_index SET suspended_at = NULL, updated_at = now()
 WHERE wire_id = '<SELECTION_LIST_PLATFORM_ORG_ID>' AND suspended_at IS NOT NULL;
```

A forged event can therefore at worst *pause* platform publishing (recoverable as above); it can never break common-list
reads or delete data. Broker ACLs on the `identity.*` topics (FuzeInfra#1394) remain the real producer control.

### 10.4 Pre-flight before turning `shared-lists` ON (read-only checks) and what stays dark

Nothing in this repo turns the flag on; these are the checks to run first. The flag is rollout only; every read and
write is still authorized by Permit.

1. **Master flag and scope.** `fuzefront.selection-lists.shared-lists` also needs `fuzefront.selection-lists.service`.
   Enable it **globally** (`selection-lists-flag-rollout.md`, "Third flag": an org-only or user-only constraint splits the
   service from the browser).
2. **The platform organization is confirmed by the projection.** `values-prod.yaml` pins
   `SELECTION_LIST_PLATFORM_ORG_ID` to `org_0000000000000000000000000g`, but the service serves, creates, forks and
   resolves common lists only once the org projection confirms that id (`resolvePlatformOrgId`,
   `services/selection-list-service/src/lib/sharedLists.ts`). Read-only check on the service database:

   ```sql
   SELECT wire_id, org_type, status, is_active, suspended_at
     FROM selection_list_ref_index
    WHERE entity_type = 'organization' AND wire_id = 'org_0000000000000000000000000g';
   ```

   Expect exactly one row with `org_type = 'platform'`, `status = 'active'`, `is_active = true`, `suspended_at IS NULL`.
   No row, a typeless row, another type or `is_active = false` means **every platform feature stays disabled** (service
   warn `… is not (yet) confirmed as an active platform org by the org projection`); an invalid id or a contradicted row
   makes the pod refuse to start. The row is written only by `identity.org.created` / `identity.org.updated`; the root
   org is created by a migration (`backend/security/src/migrations/014_seed_root_platform_organization.ts`), so confirm
   that identity has emitted an event for it (an `identity.org.updated` for the platform org with type `platform`,
   `isActive: true` creates the row). Whether that has happened is **UNVERIFIED** from this repo.
3. **Permit** has `SelectionListCatalog:read_shared` and `publish_platform` (M2); without them every shared read and every
   publish is denied (fail closed).
4. **Broker ACLs** (P6) verified, the section 10.1-10.2 audit returns 0 rows, and the P1-P4 rows hold.
5. **After the flag is ON**, with a platform operator token (acting in the platform org, holding `publish_platform`):
   create a `platform` list, then as an ordinary org member confirm `GET /v1/selection-lists?key=<key>&include_shared=true`
   returns it (follow `page.nextCursor` until `hasMore` is false: a page can be empty and not last), fork it, confirm the
   fork shadows it and `POST /v1/resolve` of a common item id returns `effective_item_id`. The shell has no UI for any of
   this yet.

**Rollback** = turn the flag OFF: shared reads, `include_shared`, fork and the resolve redirect stop and the service reverts
to 4.0.0 behaviour. Data created while ON (visibility values, forks, common lists) remains. The platform-suspension and
common-list purge guards (10.3) and the cross-rendering key uniqueness rule apply regardless of the flag.

**Not built (do not plan around them):** the shared-lists UI (frames approved; implementation and RED specs were open PRs on
2026-10-26), the jobs that would set `visibility = 'org'` on already-seeded lists and retro-fork per-org copies of the
platform pack (design record §9.4, §9.6), platform pack v2, and `SelectionList.revision` (fork provenance can show only
"comparison unavailable").
