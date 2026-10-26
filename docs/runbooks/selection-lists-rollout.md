# Runbook — selection-lists production rollout

**Status: PREPARED, NOT ENABLED.** `selectionListService.enabled` is `false` in
`deploy/helm/fuzefront/values-prod.yaml` and both Unleash flags are OFF. Nothing in
this runbook enables anything. The one-line change that **does** enable the workload is
the **last step** of this document ([section 8](#8-the-last-step-the-one-line-prod-values-flip)),
and it must not be committed, staged or pre-merged ahead of time. An earlier draft kept
that change as a "DO NOT MERGE" commit on a long-lived branch; that branch was retired in
favour of this written step.

This is the readiness checklist plus the enable / ramp / rollback procedure. Read these first
for the parts it does not repeat:

- [`selection-lists-flag-rollout.md`](selection-lists-flag-rollout.md): the flag record, what the flag gates, both-state tests.
- [`selection-lists-seeding-operations.md`](selection-lists-seeding-operations.md): the seeding flag, Kafka topics and monitoring, which are prerequisites for default lists.
- [`docs/security/selection-lists-authz-review-2026-10.md`](../security/selection-lists-authz-review-2026-10.md): the authorization review with a resolution status per finding.
- [`per-service-database-and-role.md`](per-service-database-and-role.md): the dedicated database and role pattern.

## How to read this document: facts vs. things in flight

This runbook was rewritten on **2026-10-05** against `origin/master` @ `86ccadee`. The platform
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
| Helm `selectionListService.enabled` | `values-prod.yaml` (GitOps; **merge = production deploy**) | Creates the Deployment/Service/Ingress/Middleware/NetworkPolicy and the per-service database Job. The feature is **still dark**: the API answers 404 and the shell hides the UI until the flag is on. |
| Unleash flag `fuzefront.selection-lists.service` | Unleash prod, via `prod-unleash-ops` | Turns the feature on for the targeted % of orgs/users: the API stops 404ing, the shell sidebar entry and `/settings/selection-lists*` routes appear. |
| Unleash flag `fuzefront.selection-lists.seed-defaults` | Unleash prod | Separately gates seeding the platform default lists into orgs (see the seeding runbook). Not needed to use lists, only to get the three default lists automatically. |

Order is always: **prerequisites, then workload (flags OFF), verify it is healthy and 404s, then ramp the flags.**

## 2. Prerequisites

Every row must hold before the final step. Rows marked IN FLIGHT must be re-checked.

### 2.1 What the service needs in the cluster

| # | Prerequisite | State when written | What to check |
|---|---|---|---|
| P1 | **Database password sealed** (`Secret/selection-list-secrets`, key `DB_PASSWORD`, read by the per-service DB bootstrap Job **and** the Deployment) | **IN FLIGHT.** Only `deploy/contabo/sealed/selection-list-service-secrets.yaml.template` exists on master; no real `selection-list-secrets.yaml`. The password is minted and sealed by the `rotate-sealed-secret` workflow so no human sees it. A PR titled "chore(secrets): seal DB_PASSWORD in fuzefront/selection-list-secrets" (#1295) was open. **Check the PR/merge state before relying on this.** | `ls deploy/contabo/sealed/selection-list-secrets.yaml`; Argo `fuzefront-sealed` Synced; `kubectl -n fuzefront get secret selection-list-secrets` (UNVERIFIED). **Merge it in its own change, before the final step:** the DB bootstrap Job is a pre-upgrade hook that runs before the sealed-secret sync, so enabling both in one change fails the Job on a missing Secret and fails the whole Argo sync. |
| P2 | **Service machine identity** (OAuth `client_credentials`, scope `authz:admin`) for Security API grant/revoke (creator `list-owner` on create, access grants, seeded-list owner grants). Without it grants **fail closed** (creates 500, no access can be granted) | **IN FLIGHT.** Today the Deployment reads `SERVICE_CLIENT_ID`/`SERVICE_CLIENT_SECRET` from `selection-list-secrets` (`optional: true`); nothing provisions them. A PR "feat(selection-list): mint the service's S2S identity in-cluster (PreSync register Job)" (#1299) moves this to an in-namespace register Job that writes a separate `Secret/selection-list-s2s`, gated by `selectionListService.s2s.register.enabled`. That PR also changes the Authentik scope mapping so the `authz:admin` scope is not clamped away. **Check the PR/merge state before relying on this**; if it does not land, the identity has to be provisioned another way (`docs/runbooks/s2s-client-credentials.md`). | Mint one real `client_credentials` token and introspect it: the introspected `scope` must contain `authz:admin` (the Security API reads that standard claim). UNVERIFIED live. |
| P3 | **Kafka topics exist with the intended settings** (13 change topics, 2 outcome topics, `seed.requested` + DLQ with 1-day retention because its messages carry bearer tokens) | **IN FLIGHT.** `kafkaTopics.enabled` is `false` in `values-prod.yaml` (the old post-upgrade hook wedged Argo syncs). A PR "fix(helm): make kafka-topics Job non-blocking and enable it in prod" (#1298) reworks it into a bounded last-wave Job. **Check the PR/merge state before relying on this.** Until it lands, topics rely on broker auto-create with default retention. | `kubectl -n fuzefront get jobs -l app.kubernetes.io/component=kafka-topics`; list topics via the FuzeInfra `cluster-query` workflow. Detail: seeding runbook section 2.3. |
| P4 | **All three Unleash flags exist in Unleash, OFF** (`fuzefront.selection-lists.service`, `fuzefront.selection-lists.seed-defaults`, and the SL9 `fuzefront.selection-lists.shared-lists`, the last created by the same `flags=selection-lists-create` dispatch once this lands) | **Creation is wired; verify it ran.** The `selection-lists-create` set of `prod-unleash-ops` (#1296, plus the SL9 third flag) creates all three flags OFF and never enables anything. It has to be dispatched once after the SL9 flag-registration PR merges, so a third flag may be missing until then. **Check the live state; do not assume.** | Unleash prod admin UI or API: **all three** keys (`fuzefront.selection-lists.service`, `fuzefront.selection-lists.seed-defaults`, `fuzefront.selection-lists.shared-lists`) exist, environment `production` disabled. Never create them by hand in the UI if the workflow can. |
| P5 | **Shared-lists / fork contract** (a list that an org shares with others, and forking a shared list into an org's own copy) | **IN FLIGHT.** A contract PR was reported open but no PR for it was found when this was written, so its number is not recorded here. It changes the API contract, so it is a reason to hold a GA, not a hard blocker for a pilot of the existing contract (4.0.0). **Find the PR and check its merge state before relying on this**; if it lands before the first ramp step, re-read the authz section of this runbook, because sharing changes who can read what. | `services/selection-list-service/openapi.yaml` `info.version` and the contract changelog; `gh pr list --search "selection list shared fork"`. |
| P6 | **HARD PREREQUISITE: broker ACLs on the `identity.*` topics verified** (only the identity service may produce `identity.org.*` / `identity.user.*`; only the seed senders may produce `selection-lists.seed.requested`) | **FuzeInfra#1394.** **Do not enable the service in production until this is verified.** Rationale (owner decision): the service deliberately does NOT authenticate event producers in-process (no first-writer-wins owner hardening, no Security-API check before destructive org cascades). Its protection against forged events is therefore the broker: without ACLs any in-cluster workload that can reach Kafka could forge `identity.org.deleted` for an ordinary org (archive or purge a tenant's lists), `identity.user.deleted` (anonymise authorship, revoke a user's grants), `identity.org.created` (swap the owner used for seeded-list owner grants), `seed.requested` (write amplification up to the per-source caps) or flood a topic. The platform org is immune to deletion (it is only suspended) but the rest are accepted residual risks until the ACLs hold. The full list is in the design record, section 12 (Risks). | Ask FuzeInfra (via `@fuze`) for the verified ACL state of the three topic families, or `kafka-acls --list` through the `cluster-query` workflow: produce rights on `identity.org.*` / `identity.user.*` held by the identity service principal only, and on `selection-lists.seed.requested` by the registered seed senders only. UNVERIFIED when written. |

**Hard prerequisite:** Broker ACLs on the `identity.*` Kafka topics verified (FuzeInfra#1394) before enabling the service in production.

### 2.2 Already on master (re-read if master moved)

| # | Prerequisite | State | Evidence |
|---|---|---|---|
| M1 | Authorization is enforced in production; grants use the machine identity; no implicit admin-to-owner | **MERGED** | `authz.flags.ts` `isAuthzEnforced`, `lib/machineIdentity.ts`, `backend/security/.../authz.ts` grant gate; see the authz review resolution table |
| M2 | `SelectionList` and `SelectionListCatalog` declared in the Permit policy-as-code | **MERGED** (live Permit sync **UNVERIFIED**) | `backend/src/permit/schema.ts`, `backend/security/src/permit/schema.ts`. The `permit-schema-sync` Job applies it where `permit.enabled`; confirm in the Permit dashboard that `SelectionList` and `SelectionListCatalog` and their roles exist, otherwise every check denies |
| M3 | Per-service database and login role `selection_list_svc` created by a pre-upgrade Job from the password in P1 | **MERGED** | `templates/service-db-bootstrap-job.yaml`, `values.yaml` `selectionListService.db.*`, `docs/runbooks/per-service-database-and-role.md` |
| M4 | Flag client in the image and initialised at startup; `/ready` checks the DB; `/metrics`; crash containment | **MERGED** | `src/lib/featureFlags.ts`, `src/routes/health.ts`, `src/lib/http.ts` |
| M5 | Seeding (platform pack, consumers, reconciler, owner grants) | **MERGED**, behind `seed-defaults` and `SEED_RECONCILER_ENABLED` | seeding runbook. The pack's 10 non-English locales are **machine-translated, pending native review**; they are stored `is_machine: true` (runbook section 2.5; pack-provenance fix is PR #1301, check its merge state) |
| M6 | Image built and bumped by `release.yml` | **MERGED**; tag at time of writing `cb3b372f527a` (`values-prod.yaml`), which contains the SL8 hardening | Re-check that the tag at the time of the final step contains every selection-list commit you rely on: `git merge-base --is-ancestor <commit> <tag-commit>`. UNVERIFIED that the image exists in GHCR: `docker manifest inspect ghcr.io/izzywdev/fuzefront-selection-list-service:<tag>` |

### 2.3 Open decisions and known gaps (owner call before the first ramp step)

| # | Item | Why it matters |
|---|---|---|
| D1 | **No FuzeFront-issued token carries an org claim the service reads** (authz review **I-1**). The session JWT carries `tid`; the service reads `orgId` / `organization_id` / `organizationId`. The shell UI client sets no `Authorization` header (re-check whether the shell injects one). Until an org-scoped token path exists, every route answers 401 | Fails closed, but it means the ramp cannot work for real users. UI visible + API 401 is the symptom. Decide the org-scoped token (Authentik `organization_id` claim vs a FuzeFront org-session token) before enabling |
| D2 | Authz review **M-2** (last-owner guard counts the mirror, not the Security API; deleted users and purged lists keep stale grants) and **M-4** (`user_lists` / `list_locales` quotas not enforced; no rate limiting) are **open** | Accept for a closed pilot or fix first; record the decision |
| D3 | `POST /tenants` and `GET /tenants` on the Security API are still open to any authenticated caller (residual of authz review C-1) | Platform-wide, not specific to this service |
| D4 | The MCP gateway (`selectionListsMcp.enabled: false`) points at host `selection-list-service` but the Service is named `fuzefront-selection-list-service` (authz review I-1c) | Keep the gateway **off** until fixed |
| D5 | `selection_list_access` mirror lags a Security-API-only grant; app-seeded lists get no owner grant | seeding runbook section 6 |

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
| Pinned tag is a real, recent build containing the hardening | `values-prod.yaml` `tag: cb3b372f527a` contains #1289 (`git merge-base --is-ancestor 37ed4c5e cb3b372f`) | VERIFIED (read); registry presence UNVERIFIED |
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
| `SELECTION_LIST_SERVICE_CLIENT_ID` / `_SECRET` | today `selection-list-secrets/SERVICE_CLIENT_ID|SECRET` (`optional`); **P2** moves them to `selection-list-s2s` | wired; credential missing until **P2** |
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

Structured pino logging with a per-request `reqId`; `/metrics` (above). **No dashboards or alerts** exist for this service (UNVERIFIED in the live cluster). Interim ramp signals: pod status/restarts, `kubectl logs` for `level>=50`, ingress 5xx for `app.fuzefront.com/api/v1/selection-lists`, `knex_migrations` row count = the number of migrations (10 at the time of writing).

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

## 10. Shared lists (SL9): data jobs to run BEFORE turning `fuzefront.selection-lists.shared-lists` on

This section applies to the second flag (`fuzefront.selection-lists.shared-lists`, design record
`docs/planning/selection-lists-shared-and-fork.md`, section 9). That flag has never been ON in production, so the audit
below is expected to return **no rows** and the data jobs are expected to find only the seeded lists. Run them anyway:
with the flag ON the service treats the bare-UUID and the `org_…` rendering of one organization id as the same
organization, and the database constraint `UNIQUE (organization_id, key)` does not (it compares the stored text).

### 10.0 The four jobs: what they are, the order, how to run them

Four jobs ship in the service image (`services/selection-list-service/src/rollout/`). They are the **only** supported way
to touch this data in production: each one is idempotent, **flag-independent** (it reads and writes data, never an Unleash
flag), has a **dry run that prints a report and writes nothing**, and is safe while the service is serving (every change
takes the same per-organization outbox lock every writer takes, re-reads under it, and writes its domain event through the
outbox in the same transaction).

| Step | Job | What it does | Design record | Section |
|---|---|---|---|---|
| 1 | `audit` | Read-only: the same key, or the same fork of a common list, held by one org under both renderings of its id (bare UUID and `org_…` TypeID) | 10 (pre-flag audit) | 10.1 |
| 2 | `reconcile-duplicates` | Keeps the winner (active, then oldest, then smallest id), **renames + archives** every other row, never deletes | 10 | 10.2 |
| 3 | `visibility-org` | `private` → `org` for every **seeded** list, so members can pick the default lists; nobody gains a write | 9.4 | 10.4 |
| 4 | `retro-forks` | The existing per-org copies of the platform pack lists become **forks** of the published common lists | 9.6 | 10.5 |

**Order:** `audit` → `reconcile-duplicates` → `audit` (0 findings) → `visibility-org` → *(design 9.3 and 9.5, not these
jobs: flag ON for an internal org, publish the common lists)* → `retro-forks` → flag ON broadly. Each job: **dry run
first, read it, then `--apply`.** `retro-forks --apply` refuses (exit 3) while the audit is not clean.

**The command** (the service image, working directory `/app/services/selection-list-service`; it needs only the service's
own `DB_*` environment, no Kafka, no Security API, no Unleash):

```bash
node dist/rollout/cli.js <audit|reconcile-duplicates|visibility-org|retro-forks> [--dry-run | --apply] [--json]
```

- **No mode flag = `--dry-run`.** A dry run executes in a `READ ONLY` transaction: Postgres refuses any write, it takes no
  lock and enqueues no event. `--apply` is explicit. `audit` is always read-only and has no `--apply`.
- `--json` prints the report as one JSON object on one line — the **last** line of stdout, after the structured log lines
  (`rollout job start` / `rollout job end` with `elapsedMs`); the text report is the default. Set `LOG_LEVEL=warn` to drop the log lines.
- Local / any shell with the service's environment: `npm run rollout -- <job> [--apply]` in `services/selection-list-service`.
- **Exit codes:** `0` done or nothing to do · `1` unexpected error or bad usage · `2` findings (`audit` found a duplicate)
  or an `--apply` that left a **BLOCKED** item for an operator · `3` a precondition is not met, nothing was written
  (for example `retro-forks` without a confirmed platform organization).
- Every event a run enqueues carries the correlation id `rollout:<job>:<runId>` (the run id is in the report's first line),
  so one run's events and changes can be found again.

**In production (GitOps; nobody has a shell in the cluster).** The chart renders one Job per run, only when
`selectionListService.rolloutJob.enabled` is `true` (default `false`: nothing renders, and with it `false` the rendered
manifests for `values.yaml`, `values-local.yaml` and `values-prod.yaml` are byte-identical to before the Job existed).
One reviewed values change per run, merged like any other deploy:

```yaml
# deploy/helm/fuzefront/values-prod.yaml
selectionListService:
  rolloutJob:
    enabled: true
    job: "audit"          # audit | reconcile-duplicates | visibility-org | retro-forks
    mode: "dry-run"       # dry-run | apply   (audit has no apply; anything else fails the render)
```

Argo runs the Job as a post-sync hook (`fuzefront-selection-list-rollout-<job>-<mode>`, one try, no automatic retry, killed
after `activeDeadlineSeconds`, kept for `ttlSecondsAfterFinished`). Read the report, then set `enabled: false` again in the
next change (the hook would otherwise re-run on every sync):

```bash
gh workflow run cluster-query.yml --repo izzywdev/FuzeInfra \
  -f kubectl_args='-n fuzefront logs job/fuzefront-selection-list-rollout-audit-dry-run'
gh workflow run cluster-query.yml --repo izzywdev/FuzeInfra \
  -f kubectl_args='-n fuzefront get job fuzefront-selection-list-rollout-audit-dry-run'   # exit code: COMPLETIONS 1/1 = 0, Failed = 1/2/3
```

A Failed Job with exit code 2 or 3 is an **answer**, not an outage: the report in its logs says what needs a decision.
Do not set `mode: apply` in the same change as the first `dry-run` of that job: review the dry-run report first.

### 10.1 Pre-enable audit (read-only): the same key under two renderings of one org

Creating or renaming a list is refused (409) when the key already exists for the same org under ANY rendering of its id,
whatever the shared-lists flag says, so duplicates can only exist in data written before that rule (or by hand). The audit
finds them; at read time, with the flag ON, exactly one is effective (the one the caller can read: active, the
caller's own rendering, oldest, smallest id).

**Job:** `audit` (`rolloutJob.job: "audit"`, `mode: "dry-run"`). It loads every list once in a `REPEATABLE READ, READ ONLY`
snapshot and pairs two stored ids as one organization when their canonical `org_…` TypeIDs are equal (the identity codec),
so it also pairs organizations that are **not** in the org projection, which the SQL below cannot. Expected output when
clean, exit code 0:

```
=== selection-lists rollout: audit run 01a1798f-7027-7edd-8983-ce95ab0a38c6 ===
READ ONLY: the audit never writes anything.
  lists: 5
  keyDuplicateGroups: 0
  forkDuplicateGroups: 0
  unrecognisedOrgIds: 0
exit code: 0
```

With a finding (exit code 2) each group is printed under `DUPLICATES (run reconcile-duplicates)` with the org, the key (or the
forked common list), every stored rendering, and the ids **winner first**. `unrecognisedOrgIds` counts organization ids that
are neither a UUID nor a TypeID (legacy data): they cannot be paired with anything, are listed under `LEFT ALONE`, and are never
touched; they are informational, not a finding.

Rollback: nothing to roll back (read-only).

**The same check by hand** (psql against the service database, `selection_list_svc`, read access is enough — for staging or
when the Job cannot run). It groups rows by the organization's **UUID** (taken from the org projection, which stores both
renderings of every org it has seen) and reports every group with more than one row for a key **and** more than one stored
rendering. The job and the SQL agree on every org the projection knows; a test runs this exact SQL against the job:

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

-- B. forks of the same common list held by one org under two renderings, MORE THAN ONE of them active (expect 0 rows)
WITH rows AS (
  SELECT l.id, l.organization_id, l.forked_from_list_id, l.status, l.created_at,
         COALESCE(r.entity_id, l.organization_id) AS org_uuid
    FROM selection_lists l
    LEFT JOIN selection_list_ref_index r
           ON r.entity_type = 'organization'
          AND (r.wire_id = l.organization_id OR r.entity_id = l.organization_id)
   WHERE l.forked_from_list_id IS NOT NULL
)
SELECT org_uuid, forked_from_list_id,
       array_agg(id ORDER BY (status = 'active') DESC, created_at, id) AS fork_ids_winner_first
  FROM rows
 GROUP BY org_uuid, forked_from_list_id
HAVING count(*) > 1 AND count(DISTINCT organization_id) > 1
   AND count(*) FILTER (WHERE status = 'active') > 1;

-- C. organizations whose renderings this SQL cannot pair (not in the org projection): informational.
--    A TypeID cannot be decoded in SQL. The `audit` job pairs these through the identity codec; by hand, decode them with
--    the identity package (`toUuid('<org_…>')`) and re-run A/B for those orgs.
SELECT DISTINCT l.organization_id
  FROM selection_lists l
 WHERE NOT EXISTS (SELECT 1 FROM selection_list_ref_index r
                    WHERE r.entity_type = 'organization' AND (r.wire_id = l.organization_id OR r.entity_id = l.organization_id));
```

(B counts a pair of forks only when **more than one is active**: an archived fork beside an active one is not ambiguous —
the service ignores the archived one — and an archived loser keeps its provenance after reconciliation, so counting it would
make the check impossible to clear. The earlier version of this query did count it; that was the runbook's mistake, and the
audit job and this SQL now agree.)

If A, B and the `audit` job report nothing, there is nothing to reconcile: go on with 10.4.

### 10.2 Reconciliation (only if the audit found a group)

**Which row wins** — the same function the service applies at read time (`lib/renderingWinner.ts`, shared by the read path
and the job, so they cannot disagree), so reconciling changes nothing a user can see: an **active** row beats an archived
one; then the **oldest** (`created_at`), then the smallest `id`. (At read time an exact match of the caller's claim also
outranks age; there is no caller here, and after reconciliation there is only one row, so that no longer matters.) The
winner keeps its key, its id, its items, translations and grants and is **not written at all**. **Stored values elsewhere
point at ids, so no id is ever deleted or changed.**

**What happens to the loser** — it is **renamed** to `<key>--dup-<last 8 characters of its id>` (a key longer than 50
characters is cut to 50 first, so the result is still a legal key of at most 64) and **archived**, never deleted: its ids
keep resolving, its audit trail stays. (An earlier version of this section said "first 8 characters"; every id starts
`front_sl_`, so that name would have been the same for every loser. The SQL below always used the last 8. The runbook was
wrong, the SQL and the code are right.) Two kinds of group are handled, key first and then fork, on the state the first
phase leaves: *key* (the same key under two renderings: every non-winner) and *fork* (the same common list forked twice
under two renderings with more than one active: the other active forks). A **common (`platform`) list is never
auto-archived**: archiving one changes the key lookup of every tenant, so it is reported `BLOCKED` for a decision.

**Job (preferred):** `reconcile-duplicates`. Dry run first (exit 0, writes nothing):

```
=== selection-lists rollout: reconcile-duplicates (dry-run) run 01a1798e-e1a9-7c02-abd9-111b4dba3e0f ===
DRY RUN: nothing was written. Re-run with --apply to make these changes.
  lists: 5
  keyDuplicateGroups: 1
  forkDuplicateGroups: 0
  wouldRenameAndArchive: 1
  blocked: 0
WOULD CHANGE (1):
  - rename+archive (key duplicate) front_sl_01m5wrx6npfhxv6qtxez9yvwsc (org org_01jpmf4z1yf88rpb9z9sd6pw01) {"org":"org_01jpmf4z1yf88rpb9z9sd6pw01","from":"yes-no","to":"yes-no--dup-ez9yvwsc","winner":"front_sl_01m5wrx6nffz9ba214qsfw2xna","wasActive":true}
exit code: 0
```

Then `mode: "apply"` (`--apply`): the same lines under `CHANGED`, `renamedAndArchived: 1`. Per group, in one transaction: the
organization outbox lock, the group's rows re-read under it (so a writer that got there first makes it a no-op), the rename +
archive, and `selection-lists.list.updated` (`previousKey`) and, for a loser that was active, `selection-lists.list.archived`
through the outbox. **Re-run = no-op** (`renamedAndArchived: 0`, no event). Then re-run `audit`: it must report 0 groups.
`BLOCKED` entries (a common list; a rename target key that is already taken; legacy data whose event the contract
refuses) leave the group untouched, are listed with a reason, and make the apply exit 2.

**Rollback:** there is no automatic one — nothing was deleted and the report is the undo log (`from` → `to`, `winner`,
`wasActive`). To give a loser its key back it must be free: first rename or archive the winner, then
`PATCH /v1/selection-lists/{loserId}` with `{"key": "<from>", "status": "active"}`. Decide which row should win before
doing that; the rule above is the one the service already uses to show users one row.

**Alternative without the job** — per loser, preferred over SQL because it emits `list.updated` through the outbox, needs a
`list-owner`/admin token of that org: `PATCH /v1/selection-lists/{loserId}` with
`{"key": "<key>--dup-<last 8 chars of the id>", "status": "archived"}`.

Last-resort fallback when no token can be produced, **with the shared-lists flag still OFF**, in one transaction, losers
taken from query A (`ids_winner_first` without its first element) — it bypasses the outbox, so downstream projections learn
the new key only from the next change of that list. A test runs this exact statement and checks it yields the job's name:

```sql
BEGIN;
UPDATE selection_lists
   SET key = rtrim(left(key, 50), '-') || '--dup-' || right(id, 8),
       status = 'archived',
       updated_at = now()
 WHERE id IN ('<loser id>', '<loser id>');
-- re-run query A: it must now return 0 rows
COMMIT;
```

For B (duplicate forks): the job handles them (phase 2); by hand keep the winner (same rule), archive the loser fork and
rename its key as above; then confirm `POST /v1/resolve` of one of the org's stored common ids returns one
`effective_item_id`.

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

### 10.4 Seeded lists become readable by their organization: `visibility-org` (design record 9.4)

Closes the "seeded lists are invisible" gap without common lists: every list with `seed_source IS NOT NULL` that is still
`private` becomes `org` (every member of the owning organization can read it; **nobody gains a write** — visibility widens
reading only). All seed sources (the platform pack and every app pack) and all statuses are included, as the design record
says. The pack content change that makes **new** orgs seed `org` (pack version 2 with identical content + `visibility`) is a
separate, later change; this job only converts what already exists.

**Run it once, before the shared-lists flag is ON for any organization.** While the flag is OFF every seeded list is `private`
because nobody could choose otherwise (PATCH ignores `visibility`), so "seeded and private" means "never chosen". Once an owner
can set a seeded list back to `private` on purpose, a later run would undo that choice. Two guards: the dry run names **every**
list it would change (read it), and a list with a `selection-lists.visibility.changed` event by a **user** is left alone (best
effort: delivered outbox rows are kept `OUTBOX_SENT_RETENTION_HOURS`, 168 h by default).

**Job:** `visibility-org`. Dry run (`mode: "dry-run"`, exit 0, writes nothing):

```
=== selection-lists rollout: visibility-org (dry-run) run 01a1798f-5505-7216-9a17-3e1a54c1c2b5 ===
DRY RUN: nothing was written. Re-run with --apply to make these changes.
  seededListsTotal: 5
  seededPrivateAtStart: 4
  seededOrgAtStart: 0
  seededPlatformAtStart: 1
  wouldChange: 4
  leftAlone: 0
WOULD CHANGE (4):
  - visibility private -> org front_sl_01m5wrx6nffz9ba214qsfw2xna (org 0195a8f2-7c3e-7a11-8b2d-3f4e5a6b7001) {"key":"yes-no"}
  ...
exit code: 0
```

`seededListsTotal` / `…AtStart` is the census by visibility before the run. Then `mode: "apply"`: the same lines under
`CHANGED` (`changed: N`). Per organization, in chunks of 200 lists per transaction: the organization outbox lock, the candidates
re-read under it (a list a writer already changed meanwhile is skipped), the update, and one
`selection-lists.visibility.changed` (previous `private`, now `org`, the service as actor) per list through the outbox in the same
transaction. **Re-run = no-op** (`seededPrivateAtStart: 0`, `changed: 0`, no event). `LEFT ALONE` lists a user's deliberate
choice and an organization id with no `org_` TypeID form (its event cannot be written). A list whose event the contract refuses
(legacy data, for example a one-character key) is `BLOCKED` and left `private`; the rest convert and the apply exits 2.

**Rollback** of one run (nothing else changes; the run id is in the report's first line). It bypasses the outbox, so
projections keep reading `org` for those lists until their next change; prefer `PATCH /v1/selection-lists/{id}`
`{"visibility": "private"}` per list with an owner token once the flag is ON for that org:

```sql
-- ROLLBACK visibility-org: replace <runId>
BEGIN;
UPDATE selection_lists SET visibility = 'private', updated_at = now()
 WHERE visibility = 'org'
   AND id IN (SELECT payload->>'listId' FROM event_outbox
               WHERE topic = 'selection-lists.visibility.changed'
                 AND correlation_id = 'rollout:visibility-org:<runId>');
COMMIT;
```

(The outbox keeps delivered rows 168 h by default; after that take the ids from the saved `--json` report.)

### 10.5 Existing per-org copies become forks of the common lists: `retro-forks` (design record 9.6)

After the common lists exist (design 9.5: the platform pack lists published once into the platform organization as `platform`
lists — **not one of these jobs**), the per-org copies the platform pack seeded earlier are made **forks** of them: the copy
gets `forked_from_*` (the common list, its owner, its current revision, now) and each of its items whose `code` also exists in
the common list gets `origin_item_id` (codes are immutable and list-unique, so the mapping is exact). The copy keeps its id,
its items, its edits, its visibility and keeps shadowing the common list for its org (precedence is unchanged for its users);
a stored common item id now resolves to the copy's item (`effective_item_id`).

Which copies: matched by **seed provenance** (`seed_source = 'platform'` and, when the common list was itself seeded, the same
`seed_key` and `seed_list_key`) **and the same current key** — the `list.forked` contract says a fork keeps its source key, so
a copy a user renamed cannot be announced as a fork and is reported, not converted. A list a user authored by hand with the
same key is not a copy and is never touched.

**Prerequisites:** `SELECTION_LIST_PLATFORM_ORG_ID` set (the Job gets it from `selectionListService.platformOrgId`) and the org
projection showing it as an active organization of type `platform` — otherwise the job exits **3** and writes nothing; at
least one active common list (otherwise it says so and does nothing); and, for `--apply`, a clean audit (exit 3 otherwise:
run `reconcile-duplicates` first).

**Job:** `retro-forks`. Dry run (exit 0, writes nothing):

```
=== selection-lists rollout: retro-forks (dry-run) run 01a1798f-57a6-7970-a8cf-09efe83afb36 ===
DRY RUN: nothing was written. Re-run with --apply to make these changes.
  commonLists: 1
  candidateCopies: 2
  wouldFork: 2
  leftAlone: 1
WOULD CHANGE (2):
  - make a fork of the common list front_sl_01m5wrx6nffz9ba214qsfw2xna (org 0195a8f2-7c3e-7a11-8b2d-3f4e5a6b7001) {"key":"yes-no","common":"front_sl_01m5wrx6n0fbtrwsep844h0gb1","itemsMapped":2}
  ...
LEFT ALONE (1):
  - renamed copy: its key differs from the common list, and a fork must keep its source key (left a plain list) list front_sl_… org … {"key":"…","seedListKey":"yes-no"}
exit code: 0
```

Then `mode: "apply"` (`forked: N`). Per copy, one transaction: the copy's organization outbox lock, the copy and the common list
re-read under it (the common list `FOR SHARE`, like the fork endpoint), the update, and one synthetic
`selection-lists.list.forked` (the service as actor; `source`, and the `itemMap` of matched items) through the outbox in the
same transaction. **Re-run = no-op** (`candidateCopies: 0`, no event). `LEFT ALONE` (with its reason): a renamed copy; a loser of
`reconcile-duplicates`; an org that already holds a fork of that common list (any rendering); a copy held under two
renderings (only the winner converts); an org id with no `org_` form; a different seed pack; more than 5000 items to map.

**Rollback** of one run. It bypasses the outbox, so projections keep `forkedFrom` for those lists until their next change:

```sql
-- ROLLBACK retro-forks: replace <runId>
BEGIN;
UPDATE selection_list_items SET origin_item_id = NULL
 WHERE list_id IN (SELECT payload->>'listId' FROM event_outbox
                    WHERE topic = 'selection-lists.list.forked'
                      AND correlation_id = 'rollout:retro-forks:<runId>');
UPDATE selection_lists
   SET forked_from_list_id = NULL, forked_from_org_id = NULL, forked_from_revision = NULL, forked_at = NULL, updated_at = now()
 WHERE id IN (SELECT payload->>'listId' FROM event_outbox
               WHERE topic = 'selection-lists.list.forked'
                 AND correlation_id = 'rollout:retro-forks:<runId>');
COMMIT;
```

The optional later "collapse untouched forks" job of the design record (archive a fork so the org falls through to the common
list, after migrating consumers' stored values with the `itemMap`) is **not** built and not scheduled: an owner decision.
