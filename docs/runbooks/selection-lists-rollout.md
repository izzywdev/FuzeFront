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
| P4 | **Both Unleash flags exist in Unleash, OFF** (`fuzefront.selection-lists.service`, `fuzefront.selection-lists.seed-defaults`) | **IN FLIGHT.** On master `prod-unleash-ops` creates and ramps only `selection-lists` (`fuzefront.selection-lists.service`) and has no entry for `seed-defaults`. A PR "feat(feature-flags): make both selection-lists flags creatable (OFF) by prod-unleash-ops" (#1296) adds creation of both, OFF. **Check the PR/merge state before relying on this.** | Unleash prod admin UI or API: both keys exist, environment `production` disabled. Never create them by hand in the UI if the workflow can. |
| P5 | **Shared-lists / fork contract** (a list that an org shares with others, and forking a shared list into an org's own copy) | **IN FLIGHT.** A contract PR was reported open but no PR for it was found when this was written, so its number is not recorded here. It changes the API contract, so it is a reason to hold a GA, not a hard blocker for a pilot of the existing contract (4.0.0). **Find the PR and check its merge state before relying on this**; if it lands before the first ramp step, re-read the authz section of this runbook, because sharing changes who can read what. | `services/selection-list-service/openapi.yaml` `info.version` and the contract changelog; `gh pr list --search "selection list shared fork"`. |

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
```

Mechanical form (does nothing if the block has already moved; check the diff is exactly one line):

```
sed -i '/^selectionListService:$/{n;s/^  enabled: false$/  enabled: true/}' deploy/helm/fuzefront/values-prod.yaml
git diff --stat   # expect: 1 file changed, 1 insertion(+), 1 deletion(-)
```

Do **not** touch `selectionListsMcp` (it stays `false`), do not change the image tag in the same commit (the release bump owns it), and do not set any flag here.

Render check performed when this was written (`helm template` with `values.yaml` + `values-prod.yaml`, `--set secret.authentikClientSecret=ci-placeholder`): flipping the one line adds exactly six resources and changes nothing else: `NetworkPolicy/fuzefront-selection-list-service-ingress`, `Service/fuzefront-selection-list-service`, `Deployment/fuzefront-selection-list-service`, `Ingress/fuzefront-selection-list-service`, `Middleware/selection-list-service-stripprefix`, and the pre-upgrade `Job/fuzefront-svcdb-selection-list-service`. If a re-render shows more or fewer (for example a register Job once **P2** merges), re-read the prerequisites. Because the Job is a pre-upgrade hook that needs **P1**, a missing Secret fails the whole sync, which is why P1 merges first.

After the merge: Argo sync green, then section 6 / stage 0, **with both flags still OFF**.

## 9. Out of scope for this runbook

App code / API / authz policy (`backend-engineer`, authz review), the shell UI and `@fuzefront/selection-lists-ui` (`frontend-engineer`), tests (`test-engineer`, `frontend-test-engineer`), org-wide hardening policy (`platform-governance`), and the shared cluster (FuzeInfra).
