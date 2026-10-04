# Runbook — selection-lists production rollout readiness

**Status: PREPARED, NOT ENABLED.** Nothing here enables the feature. Enabling in
prod is **BLOCKED** on (1) the independent authz review (`claude/sl3-authz-review`)
returning go, and (2) the open blockers in section 2 of this document.

This runbook is the readiness checklist plus the exact enable / ramp / rollback
procedure. It complements `docs/runbooks/selection-lists-flag-rollout.md` (the flag
record, what the flag gates, and both-state test coverage); read that first for the
flag semantics.

## Evidence legend

| Tag | Meaning |
|---|---|
| **VERIFIED** | Read from a repo artifact (file:line quoted) or a command run in this session (output quoted). |
| **UNVERIFIED** | Needs live-cluster, GHCR, Unleash, or Permit state this session could not read. A command that would settle it is given. Cluster reads were attempted via the FuzeInfra `cluster-query` workflow and were **denied by the session's permission classifier**, so **every claim about live cluster state below is UNVERIFIED**. |

File:line references are against branch `claude/sl3-rollout-prep` (base `origin/master`
`c446e4e3`, which contains #1234).

---

## 1. Two kinds of "on" — do not conflate them

| Switch | Where | Effect |
|---|---|---|
| Helm `selectionListService.enabled` | `deploy/helm/fuzefront/values-prod.yaml:981` (GitOps; merge = deploy) | Creates the Deployment/Service/Ingress/NetworkPolicy. Feature is **still dark**: the API answers 404 and the shell hides the UI until the flag is on. |
| Unleash flag `fuzefront.selection-lists.service` | Unleash prod, via `prod-unleash-ops` | Turns the feature on for the targeted % of orgs/users: API stops 404ing, shell sidebar entry + `/settings/selection-lists*` routes appear. |

Order is always: **workload first (flag OFF), verify it is healthy and 404s, then ramp the flag.**

## 2. Blockers found (all must be closed before the first ramp step)

| # | Blocker | Evidence | Owner | Status |
|---|---|---|---|---|
| B1 | **`SelectionList` Permit resource / actions / roles do not exist in the policy-as-code.** The service checks `SelectionList` with actions `read, add_value, update, delete, update_value, remove_value, translate, manage_access` (`services/selection-list-service/src/routes/lists.ts:193,382,612,785`, `items.ts:286,440,694`, `translations.ts:159`, `access.ts:110`). `backend/security/src/permit/schema.ts` defines only `Organization, App, UserManagement, Docs, Chat, DevPortalCatalog, DevPortalPlayground` (`grep -c SelectionList backend/security/src/permit/schema.ts` -> `0`; `backend/security/src/permit/products/` holds only fuzefinance/fuzemarket/mendys-datasets policies). The Security API `/authz/check` returns `{allow:false}` on any deny or error (`backend/security/src/routes/authz.ts:150-185`). | VERIFIED (repo) | `backend-engineer` (schema.ts) + authz review | **OPEN** |
| B2 | **Authz is pass-through by default.** `requireAuthzCheck` reads `FUZEFRONT_SELECTION_LIST_AUTHZ_ENABLED`; unset/`false` -> `next()` with a warning log and **no Security API call** (`src/middleware/authz.ts:193-201`, env read at `src/middleware/authz.flags.ts:45-54`, flag key at `:23`). Before this branch the Deployment never set it (so prod would run with authz OFF). With B1 open, setting it `true` makes every request 403/404. So today the choice is "no authz" or "no access". | VERIFIED (repo) | authz review decides; then set `selectionListService.authzEnabled: true` (declared `false` in `values.yaml`) after B1 | **OPEN, decision** |
| B3 | **`selection-list-secrets` SealedSecret does not exist.** `deploy/contabo/sealed/` contains only `selection-list-service-secrets.yaml.template` (placeholders `<REPLACE_WITH_KUBESEAL_OUTPUT>`), no real `selection-list-service-secrets.yaml`. The Deployment's `DATABASE_URL` and `JWT_SECRET` are non-optional `secretKeyRef`s into it (`templates/selection-list-service-deployment.yaml:38-47`) -> pod would sit in `CreateContainerConfigError`. Argo's `fuzefront-sealed` app syncs `deploy/contabo/sealed` (`deploy/argocd/applications/fuzefront-sealed.yaml:16`). | VERIFIED (repo); whether the Secret exists in-cluster out-of-band is UNVERIFIED (`-n fuzefront get secret selection-list-secrets`) | repo owner (needs plaintext DB password + kubeseal) | **OPEN** |
| B4 | **Service-side flag evaluation can never turn ON in prod.** `src/flags.ts:68` does `require('@fuzefront/feature-flags')` in a try/catch that returns `null` on failure, and `null` => fail-safe OFF (`src/flags.ts:125`). The package is **not** in `services/selection-list-service/package.json` dependencies, is **not** built/copied into the production image (`Dockerfile` only copies its `package.json`), and nothing in the service calls the package's `init()` (`grep -rn "init(" services/selection-list-service/src` -> only `db`/migrations). Even if resolvable, no Unleash provider is ever installed, so the OpenFeature default no-op provider returns the default `false`. Effect: after enabling the workload **and** setting the Unleash flag to 100%, the API still 404s for everyone while the shell UI (which reads the flag through the backend, which *does* init Unleash) shows the menu entry -> UI visible, API 404. Fails safe (never exposes the feature) but the ramp cannot work. | VERIFIED (repo) | `backend-engineer` (add dependency, copy into image, call `init()` at startup). Deploy half is done on this branch: `UNLEASH_*` env wired, see 3(c). | **OPEN** |
| B5 | **Pinned prod image tag predates #1234.** `values-prod.yaml:984` pins `848485db4f8c` (= #1235's merge commit, which is *before* #1234 `433b20fd`). The release run for `433b20fd` (run `37201963117`) was `in_progress` when checked; its GitOps bump commit will move the tag. The enable commit must be rebased onto master **after** that bump so the service that ships contains #1234 (authed `/resolve`, pino, id prefixes). | VERIFIED (run status at 2026-10-04); final tag UNVERIFIED | devops (rebase) | **OPEN until bump lands** |
| B6 | **DB: dedicated database was never created by the chart.** `knexfile.ts:6-8` says "the bootstrap Job creates them" (role `selection_list_svc`, db `fuzefront_selection_list`), but no template did (`ls templates | grep bootstrap` -> billing/config/db/ only). Fixed on this branch for the **database** (commit `fdb6951d`: appended to `EXTRA_DATABASES`). The **role** `selection_list_svc` is still not provisioned; the DB is owned by the shared `fuzefront_user` role (same as devportal/chat/notification). Decision needed, see 3(b). | VERIFIED (repo) | owner decision | **OPEN, decision** |
| B7 | **Kafka org-deleted handler queries columns that do not exist.** `src/events/org-deleted.handler.ts:27,38,40,53,56,62` query `selection_lists.org_id` / `selection_list_org_quota.org_id` / `is_active`; the migrations define `organization_id` (`migrations/20260810_000001_core_tables.ts:21`, `..._000003:42`) and a `status` column, and **no `is_active` column exists anywhere** (`grep -rn is_active src/db/migrations` -> empty). Every `identity.org.deleted` event would throw -> DLQ. No test covers the handlers (`tests/` has none). Does not block the ramp (data-hygiene on org deletion) but must be fixed before GA. | VERIFIED (repo) | `backend-engineer` | **OPEN, non-blocking for 10%** |

## 3. Readiness checklist

### (a) Container image

| Check | Evidence | Status |
|---|---|---|
| Image is built by `release.yml` | Step "Build & push selection-list-service" at `.github/workflows/release.yml:307` (`ghcr.io/izzywdev/fuzefront-selection-list-service:<sha>` + `:latest`); `continue-on-error: true` with a real-outcome gate (`id: selection_list_image`). Path filter `services/selection-list-service/**` at `:60`. | VERIFIED |
| Image is in the GitOps tag-bump | awk anchor at `release.yml:579` (`selection_list == 1 && /repository: ghcr\.io\/izzywdev\/fuzefront-selection-list-service/`); expected-count arithmetic includes `SELECTION_LIST_OK` at `:516`. | VERIFIED |
| values-prod pins a real tag | `values-prod.yaml:983-984`: `repository: ghcr.io/izzywdev/fuzefront-selection-list-service` / `tag: 848485db4f8c` (tag line immediately follows repository, as the bump requires). | VERIFIED |
| That tag was actually pushed | Release run `37198168271` (head `848485db4f8c`, conclusion `success`): step 17 "Build & push selection-list-service" `success`, step 26 "Bump image tags in values-prod.yaml (GitOps)" `success`. (Run `37198502114`, a later `workflow_dispatch` for the same SHA, was `cancelled` - irrelevant, the push run is the one that bumped.) | VERIFIED (workflow log); registry presence of the tag UNVERIFIED (`gh api` to GHCR denied by the session; check `docker manifest inspect ghcr.io/izzywdev/fuzefront-selection-list-service:<tag>`) |
| Tag contains the latest code | No: pinned tag predates #1234. See **B5**. | VERIFIED |
| Image can boot | `Dockerfile` ships `@fuzefront/auth` with its `jose` runtime dep (`COPY --from=base /app/packages/auth/node_modules`) - the exact crash-loop config-service hit. Not verified by running it. | VERIFIED (read); runtime UNVERIFIED |

### (b) Database

| Check | Evidence | Status |
|---|---|---|
| How migrations run | **In-process at app start**, not an initContainer/Job: `src/index.ts` calls `runMigrations()` (`db.migrate.latest()`) before `app.listen`; on failure logs fatal and `process.exit(1)` (-> CrashLoopBackOff, never serves a half-migrated schema). `src/db/migrate.ts:2-6` comment mentions a "pre-install/pre-upgrade hook Job", but **no such Job template exists** in the chart. | VERIFIED |
| Idempotent | knex tracks `knex_migrations`; all 5 migrations use `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` (`src/db/migrations/20260810_00000{1..5}_*.ts`). Multiple replicas starting together rely on knex's migration lock. | VERIFIED |
| Prod DB connection | `knexfile.ts:42-47`: `DATABASE_URL` if set, else `DB_*`; `ssl: process.env.DB_SSL === 'false' ? false : true`. The Deployment does **not** set `DB_SSL`, so prod connects with TLS **required**. Whether the FuzeInfra Postgres serves TLS is **UNVERIFIED**; `devportal-service` has the identical knexfile line and no `DB_SSL` either, and is enabled in prod, which is circumstantial precedent only. | VERIFIED (code); TLS support UNVERIFIED |
| Database creation | **Fixed on this branch** (commit `fdb6951d`): `templates/db-bootstrap-job.yaml` appends `selectionListService.dbName` (`fuzefront_selection_list`, declared in `values.yaml`) to `EXTRA_DATABASES` when the service is enabled. The bootstrap Job is a `pre-install,pre-upgrade` hook running `backend`'s `dist/scripts/db-bootstrap.js` as the FuzeInfra Postgres superuser (`templates/db-bootstrap-job.yaml:6-16`); `backend/src/scripts/db-bootstrap.ts:151-176` creates each extra DB if absent, `GRANT CONNECT`, and `ALTER DATABASE ... OWNER TO` the shared app role. Rendered check: prod `EXTRA_DATABASES` = `authentik,fuzefront_chat,fuzefront_notification,fuzefront_devportal,fuzefront_selection_list` once enabled. | VERIFIED (render); execution in-cluster UNVERIFIED |
| Role | **Not provisioned.** `selection_list_svc` (named in `knexfile.ts:6-8` and the sealed-secret template) does not exist anywhere in the chart. Because the bootstrap makes the shared `fuzefront_user` the DB owner, the sealed `DATABASE_URL` must use `fuzefront_user` (or the owner approves adding a per-service role Job like `billing-db-bootstrap-job.yaml`). | VERIFIED (repo) - **decision B6** |
| FuzeInfra-owned pieces | **None required of FuzeInfra.** DB/role creation is this chart's own hook using the existing superuser (`DB_SUPERUSER_PASSWORD` in `fuzefront-secrets`, already needed by every other service). `deploy/terraform/node-requests.json` only declares a worker node (`fuzefront-worker-2`, `V92`, EU) and `grep -rn infra-request` shows only the terraform contract/dispatch files - **there is no DB or secret infra-request and none is needed.** Sealed-secrets controller is FuzeInfra shared infra (`deploy/argocd/applications/fuzefront-sealed.yaml:9-11`) and is already in use by other secrets. | VERIFIED |

**Option A (documented design, needs a human to seal):** keep `selection-list-secrets`;
`DATABASE_URL = postgresql://fuzefront_user:<DB_PASSWORD from fuzefront-secrets>@postgres.fuzeinfra.svc.cluster.local:5432/fuzefront_selection_list`,
`JWT_SECRET` = same value as `fuzefront-secrets` `JWT_SECRET`. Seal per
`deploy/contabo/sealed/selection-list-service-secrets.yaml.template` (cert:
`https://sealed-secrets.prod.fuzefront.com/v1/cert.pem` or `deploy/sealed-secrets/sealing-cert.pem`)
and commit it as `deploy/contabo/sealed/selection-list-service-secrets.yaml`. Requires the plaintext
`DB_PASSWORD`; `rotate-sealed-secret` generates *new* random values so it cannot reuse the existing one.

**Option B (zero new secrets, mirrors `devportal-service.yaml:39-61`, recommended):** in the Deployment replace
`DATABASE_URL` with `DB_HOST`/`DB_PORT` (`.Values.fuzeinfra.postgres.*`), `DB_NAME` (`.Values.selectionListService.dbName`),
`DB_USER` (`.Values.database.user`), and read `DB_PASSWORD` + `JWT_SECRET` from `{{ include "fuzefront.secretName" . }}`.
`knexfile.ts` already falls back to those env vars. Not applied on this branch because it changes the documented secret
design - owner decision.

### (c) Secrets / env wired in the Deployment

| Env | Source in `templates/selection-list-service-deployment.yaml` | Status |
|---|---|---|
| `DATABASE_URL` | secretKeyRef `selection-list-secrets/DATABASE_URL` (`:38`) | VERIFIED wired; Secret **missing**, see B3 |
| `JWT_SECRET` | secretKeyRef `selection-list-secrets/JWT_SECRET` (`:43`); `index.ts` refuses to start without it | VERIFIED wired; Secret missing, B3 |
| `SECURITY_SERVICE_URL` | `http://fuzefront-security:{{ securityService.port }}` (`:48`) -> `http://fuzefront-security:3002` rendered | VERIFIED |
| `KAFKA_BROKERS` | `selectionListService.kafkaBrokers` (`:59`); default changed in `fdb6951d` from `kafka.fuzeinfra...` to `fuzeinfra-kafka.fuzeinfra.svc.cluster.local:9092` (the host used by chat/applications/`kafkaTopics.bootstrapServer`, and described as "verified reachable" at `values-prod.yaml:865`). Which hostname actually resolves was **not** verified against the cluster. Note `notificationService.kafkaBrokers` (`values.yaml:960`) still uses the old `kafka.fuzeinfra...` name - out of scope, flagged. | VERIFIED render; resolution UNVERIFIED (`-n fuzeinfra get svc`) |
| `FUZEFRONT_SELECTION_LIST_AUTHZ_ENABLED` | **Added in `fdb6951d`** from `selectionListService.authzEnabled` (`:68`), declared **`false`** in `values.yaml` (= the in-code default; rendered `"false"`). Prod before this branch: env absent -> same behaviour. **The authz review must say whether it must be `true` in prod; see B1/B2 - it must NOT be flipped to true before the Permit schema contains `SelectionList`.** | VERIFIED |
| `UNLEASH_URL` / `UNLEASH_APP_NAME` / `UNLEASH_CLIENT_TOKEN` | **Added in `fdb6951d`** behind `selectionListService.featureFlags.unleashUrl` (`:75`); prod values point at `http://fuzefront-unleash.fuzefront.svc.cluster.local:4242/api` and the Unleash chart's own `unleash-secrets/UNLEASH_CLIENT_TOKEN` (`optional: true`) - same wiring as chat/applications/security. **Inert until B4 is fixed** (code never calls `init()`). | VERIFIED render; token presence UNVERIFIED |
| Permit PDP / API keys | **Intentionally absent.** Authorization goes through the Security API (`SECURITY_SERVICE_URL`); the service holds no Permit key (template comment `:49-58`, `src/middleware/authz.ts`). Permit lives behind `fuzefront-security`. | VERIFIED |
| Placement / limits | Prod elastic-pool affinity + toleration added in `fdb6951d` (`<<: *elasticPlacement`); limits `500m/512Mi`, requests `100m/128Mi`; `replicas: 1`. | VERIFIED render |

### (d) Kafka consumers

| Check | Evidence | Status |
|---|---|---|
| Topics consumed | `identity.org.deleted` and `identity.user.deleted` (`shared/src/kafka/types.ts:9,12`; subscribed at `src/events/consumer.ts:46,55`). DLQ `<topic>.dlq` on handler failure. | VERIFIED |
| Consumer group ids | `selection-list-service-group-org-deleted`, `selection-list-service-group-user-deleted` (`consumer.ts:37,44,53`); `KAFKA_GROUP_ID` env not set by the chart, so the default applies. | VERIFIED |
| Topics exist | Declared in `values.yaml` `kafkaTopics.topics` (`identity.user.deleted`, `.dlq`, `identity.org.deleted`, `.dlq`), **but `kafkaTopics.enabled: false` in prod** (`values-prod.yaml:866-880`, deliberate: the hook wedged every sync). Topics rely on broker auto-create. Whether they exist in the live cluster is UNVERIFIED. A consumer start failure is non-fatal (`index.ts:51-61`), so a Kafka problem cannot take the API down. | VERIFIED (config); live existence UNVERIFIED (`kafka-topics.sh --list` via infra) |
| Handler correctness | Org-deleted handler is broken against the schema - **B7**. User-deleted handler uses `created_by` (a real column). | VERIFIED |

### (e) Health, readiness, NetworkPolicy

| Check | Evidence | Status |
|---|---|---|
| Probes | Readiness + liveness both `GET /health` on the service port (`deployment.yaml:86-98`), initial 10s/30s. `/health` is unauthenticated and returns `{status:'ok'}` **unconditionally** (`src/routes/health.ts`) - it does **not** check the DB, so a pod with a dead DB pool still reports Ready. | VERIFIED (weakness noted; backend can add a DB ping) |
| NetworkPolicy | `fuzefront-selection-list-service-ingress`: allows TCP 3008 from namespace `kube-system` (Traefik) and from any pod in the release namespace. Port declared explicitly in values (`values.yaml` `networkPolicy.port: 3008`), no cast. Rendered with valid port 3008. | VERIFIED render |
| Prometheus scrape | Pod has `prometheus.io/scrape: "true"`, port 3008, path `/metrics` (prod `observability.metrics.enabled: true`), but the service has **no `/metrics` endpoint** (`grep -rn "metrics\|prom-client" services/selection-list-service/src package.json` -> empty) and the NetworkPolicy does not admit the monitoring namespace. So the scrape target will 404/time out. No dashboards or alerts exist for this service. | VERIFIED |

### (f) Permit resource / role definitions

**NOT PRESENT.** See B1. `backend/security/src/permit/schema.ts` is the policy-as-code applied to Permit by the `permit-schema-sync` post-sync Job (`templates/permit-schema-job.yaml`, gated by `permit.enabled`). Nothing in it, nor in `permit/products/*`, defines `SelectionList`, its actions, or roles; `docs/planning/epics/EPIC-17-selection-lists.md:158,219` plans a `SelectionList` ReBAC resource with relation `organization: 'Organization'` but it was never added. Applied-state in Permit cloud: UNVERIFIED (Permit dashboard / `permit.api.resources.list`).

### (g) Shell sidebar entry and routes gated by the flag

| Check | Evidence | Status |
|---|---|---|
| Sidebar entry | `frontend/src/components/SidePanel.tsx:62` `useFlag('fuzefront.selection-lists.service', false)`; entry rendered only when true (`:439`). | VERIFIED |
| Routes | `frontend/src/App.tsx:518` `SELECTION_LISTS_FLAG`, `:528` `useFlagState(..., false)`; OFF redirects to `/dashboard`; routes at `:401-405`. Deep links wait for the flag to load (#1234). | VERIFIED |
| Browser can see the flag | Key is in `WEB_EXPOSED_FLAGS` (`packages/feature-flags/src/catalog.ts:245` array, entry at `:251`; backend serves `GET /api/flags`, backend has Unleash wired at `values-prod.yaml:95-99`). | VERIFIED |
| Server gate | Router-level `requireSelectionListsFlag` mounted before all `/v1/selection-lists/*` routers (`src/app.ts:42`), fail-closed on evaluation error (`middleware/flagGate.ts`); `/v1/resolve` has its own check (`routes/resolve.ts:53-59`). | VERIFIED (blocked by B4 from ever being ON) |
| Edge route | Ingress `fuzefront-selection-list-service` (Traefik) publishes only `/api/v1/selection-lists` and `/api/v1/resolve` on `app.fuzefront.com`, with a stripPrefix `/api` Middleware (`templates/ingress.yaml:340-430`); rendered in prod once enabled. No auth added at the edge. | VERIFIED render |

### (h) Observability

| Item | Evidence | Status |
|---|---|---|
| Logging | Structured **pino** (`src/lib/logger.ts`, `requestLogger` first middleware `src/app.ts:28` binding `reqId` + request-scoped child logger; `LOG_LEVEL` env, default level in `logger.ts:79`). Authz pass-through is logged at `warn` with the flag name (`authz.ts:196`) - useful to **prove** the posture in prod logs. | VERIFIED |
| Metrics | None emitted (see (e)). | VERIFIED (gap) |
| Dashboards / alerts | None for this service. `observability.dashboards/alerts` ConfigMaps in the chart do not include selection-list. | VERIFIED (gap) |
| Interim ramp signals | Pod status/restarts, `kubectl logs` for `level>=50` and `"authz-enabled flag is OFF"` lines, ingress 5xx for host `app.fuzefront.com` path `/api/v1/selection-lists` (Traefik access metrics, if scraped), `knex_migrations` row count = 5. | UNVERIFIED (live) |

### (i) Rollback

| Layer | Action | Effect |
|---|---|---|
| Flag (fast, seconds, no deploy) | Dispatch `prod-unleash-ops` with `flags=selection-lists`, `action=disable` (see section 5). | API routes answer **404** for everyone (flag OFF, fail-closed also on Unleash error); shell sidebar entry + `/settings/selection-lists*` routes disappear on next `/api/flags` read. Strategy is kept, so re-enable returns to the same %. |
| Workload (deploy) | `git revert` the enable commit (single line, `selectionListService.enabled: true -> false`) and merge in a deploy window. | Argo prunes Deployment/Service/Ingress/Middleware/NetworkPolicy. `fuzefront_selection_list` database and its data are **not** dropped (the bootstrap only creates). |
| Data | **Forward-only.** Lists/items/translations/grants created while ON stay in the DB. A data rollback is a separate migration, never a toggle. Migrations are not reversed by disabling. |

## 4. Deploy sequence (once B1-B5 are closed and the authz review is go)

1. Merge `fdb6951d` (chart prerequisites, inert while disabled) if not already merged. Render is byte-identical while disabled.
2. Close B3 (secret, Option A or B) and merge it **first**; wait for Argo `fuzefront-sealed` Synced (UNVERIFIED until checked).
3. Wait for the release bump of the tag for a build containing #1234 and the B4 fix; rebase `2de7f312` on master (it only touches `selectionListService.enabled`).
4. Merge the enable commit **in a deploy window** (merge = prod deploy; never hand-deploy).
5. Verify the workload with the flag still OFF (section 6, "workload gate").
6. Ramp the flag (section 5).

To use the staged commit: `git fetch origin claude/sl3-rollout-prep && git cherry-pick 2de7f312` onto a fresh branch from master, then open a PR with the `auto-merge` label **only** at step 4. To discard: `git revert 2de7f312`.

`selectionListsMcp` **stays `false`** (base default, not set in `values-prod.yaml`): the MCP gateway forwards callers' bearer tokens to an API whose authz posture is under review, and it adds a second ingress-adjacent surface. Enable separately after GA.

## 5. Unleash ramp procedure

Source: `.claude/skills/unleash-flag-enable/SKILL.md` and `.github/workflows/prod-unleash-ops.yml`. Runs on the in-cluster `fuzefront` runner (no CF-Access session, no token handling); reads the admin token from `unleash-secrets`. Each step is idempotent: an existing `flexibleRollout` strategy is PATCHed, never duplicated; `stickiness: default` + fixed `groupId` keep a user in the same bucket as the % grows. (Do **not** run any of this before the section 2 blockers are closed. This runbook only documents it.)

Preconditions from the skill: flag is default-OFF and tested both ways (done, see the flag runbook); an owner decision (who, target %, date) is recorded on the requesting PR/issue; the flag is in `WEB_EXPOSED_FLAGS` (it is).

```
gh workflow run prod-unleash-ops.yml --repo izzywdev/FuzeFront \
  -f flags=selection-lists -f action=enable -f rollout=10     # then 25, 50, 100
# rollback / disable:
gh workflow run prod-unleash-ops.yml --repo izzywdev/FuzeFront \
  -f flags=selection-lists -f action=disable
```

Caveat on the workflow's own verification: its **Verify** step only prints the **environment** state (`ON`/`OFF`) and exits 0 silently if the admin token cannot be read; it does **not** print the rollout percentage or prove evaluation. Do the explicit both-state checks below at every step.

### Verifying BOTH states at each step

| State | Check | Expected |
|---|---|---|
| Flag ON for a bucketed user | Signed-in user in the rollout: `GET https://app.fuzefront.com/api/flags` | `"fuzefront.selection-lists.service": true`; sidebar shows "Selection Lists"; `/settings/selection-lists` renders; `GET /api/v1/selection-lists` returns 200, not 404. |
| Flag OFF (not in bucket, or after `disable`) | Same calls as a user outside the %, or after rollback | `/api/flags` shows `false` / key absent; no sidebar entry; `/settings/selection-lists` redirects to `/dashboard`; `GET /api/v1/selection-lists` returns **404** `{"code":"NOT_FOUND"}`. |
| Unleash unreachable | (Do not induce in prod.) In-code fail-safe | Release flag evaluates OFF everywhere (404 / UI hidden), never ON. |
| UI/API agree | For the same user, the UI entry and the API both on, or both off | A visible menu with an API 404 is exactly the **B4** failure mode - treat as a no-go. |
| Authz posture | Pod logs | With `authzEnabled: false`: `authz-enabled flag is OFF - passing through` warnings present. With `true`: `authz decision:` lines, no pass-through warnings. Record which posture the review approved. |

Console-clean check (`ui-runtime-validation` skill) on `/settings/selection-lists` for a bucketed user at each step.

### Go / no-go criteria per stage

| Stage | Gate to START | Soak | Go (advance) when | No-go / rollback when |
|---|---|---|---|---|
| 0 - workload live, flag OFF | B1-B5 closed; authz review go; secret synced; enable commit merged in a deploy window | until pod stable | Pod `Running`, 0 restarts, readiness green; `knex_migrations` has 5 rows (`pino` line `Applied migration(s)` / `DB schema up to date`); Kafka consumers started log line (non-fatal if absent); `GET /api/v1/selection-lists` returns 404 for everyone; NetworkPolicy/Ingress present; `app.fuzefront.com` unaffected. | CrashLoop/ImagePullBackOff/CreateContainerConfigError; any non-404 from the API with the flag OFF (flag gate broken: **disable workload**); regression on other routes under `/api`. |
| 1 - 10% | stage 0 go; owner decision recorded | >= 1 day | Zero 5xx / `INTERNAL_ERROR` on `/api/v1/selection-lists/*`; both-state checks pass; console clean; authz posture matches the review (no unexpected 403s if enforcement is ON; no pass-through warnings if ON); no pod restarts; UI/API agree. | Any 5xx burst, authz denial for a legitimate org admin, cross-org data in any response (**immediate `action=disable`**, page security), UI/API disagree, restart loop. |
| 2 - 25% | stage 1 go | >= 1 day | Same as stage 1; quota endpoint (`GET /v1/selection-lists/quota`) sane; p95 latency acceptable (UNVERIFIED - no metrics exist, use ingress/pod logs). | Same as stage 1. |
| 3 - 50% | stage 2 go | >= 1 day | Same as stage 1; DB connections/CPU/memory within limits (`kubectl top pod`, UNVERIFIED); Kafka DLQ for `identity.*.deleted` empty or understood (B7 fixed before this stage is advisable). | Same as stage 1; OOMKilled; CPU throttling sustained. |
| 4 - 100% | stage 3 go; B7 closed | stable one release cycle | Same as stage 1. Then schedule flag removal per the flag record (delete the flag, the `SidePanel`/`App.tsx` guards, `src/flags.ts`, `middleware/flagGate.ts` in one PR). | Same as stage 1. |

## 6. Verification commands (read-only; use the FuzeInfra `cluster-query` workflow for prod cluster reads)

```
# workload gate (stage 0)
gh workflow run cluster-query.yml --repo izzywdev/FuzeInfra -f kubectl_args='-n fuzefront get pods -l app=fuzefront-selection-list-service -o wide'
gh workflow run cluster-query.yml --repo izzywdev/FuzeInfra -f kubectl_args='-n fuzefront logs deploy/fuzefront-selection-list-service --tail=100'
gh workflow run cluster-query.yml --repo izzywdev/FuzeInfra -f kubectl_args='-n fuzefront get secret selection-list-secrets'
gh workflow run cluster-query.yml --repo izzywdev/FuzeInfra -f kubectl_args='-n fuzeinfra get svc'      # Kafka/Postgres service names
```

Edge probe (not cluster): `curl -s -o /dev/null -w '%{http_code}\n' https://app.fuzefront.com/api/v1/selection-lists` -> `401` unauthenticated (auth middleware runs before the flag gate, `src/app.ts:36-42`), `404` authenticated with the flag OFF.

## 7. Drafted delegations (NOT SENT)

**To `@fuze` backend-engineer (FuzeFront) - B1 + B4 + B7 + health:**
> selection-list-service cannot be rolled out: (1) add a `SelectionList` resource to `backend/security/src/permit/schema.ts` with actions `read, add_value, update, delete, update_value, remove_value, translate, manage_access`, `relations: { organization: 'Organization' }` (ReBAC, per EPIC-17 s.219) and roles/permission grants for admin/editor/viewer matching `services/selection-list-service/openapi.yaml` `x-permit-action`; add a test pinning the schema. (2) Add `@fuzefront/feature-flags` to the service's `package.json`, build and copy it (plus its runtime deps) into the production image like `packages/auth`, and call `init({url: UNLEASH_URL, clientToken: UNLEASH_CLIENT_TOKEN, appName: UNLEASH_APP_NAME})` at startup (mirror `services/chat-service/src/utils/feature-flags.ts`); today `src/flags.ts:68` always returns null in prod so the flag can never turn ON. (3) Fix `src/events/org-deleted.handler.ts` to use `organization_id` / `status` instead of `org_id` / `is_active`, and add handler tests. (4) Make `/health` (or add `/ready`) check the DB pool, and add a `/metrics` endpoint (or drop the scrape annotation). The chart side (UNLEASH env, `authzEnabled`) is already on `claude/sl3-rollout-prep`.

**To repo owner (needs plaintext + kubeseal) - B3/B6:** choose Option A (seal `selection-list-secrets`, `DATABASE_URL` using `fuzefront_user` + `fuzefront-secrets` `DB_PASSWORD`, db `fuzefront_selection_list`; commit as `deploy/contabo/sealed/selection-list-service-secrets.yaml`) or Option B (devops switches the Deployment to `DB_*` + `fuzefront-secrets`, no new secret).

**To `@fuze` FuzeInfra - nothing required.** Optional read-only confirmations that this session could not run (permission classifier denied `cluster-query`): `-n fuzeinfra get svc` (confirm `fuzeinfra-kafka` vs `kafka` Service name), Postgres TLS support (for `DB_SSL`), and that topics `identity.user.deleted` / `identity.org.deleted` (+ `.dlq`) exist. Draft: "FuzeFront selection-list-service is about to be enabled in prod. Please confirm (read-only): (a) the Kafka bootstrap Service DNS name in `fuzeinfra`; (b) whether `postgres.fuzeinfra` accepts TLS connections; (c) topics `identity.org.deleted`, `identity.user.deleted` and their `.dlq` exist."

## 8. Out of scope for this runbook

App code / API / authz policy (`backend-engineer`, authz review), the shell UI and `@fuzefront/selection-lists-ui` (`frontend-engineer`), tests (`test-engineer`, `frontend-test-engineer`), org-wide hardening policy (`platform-governance`), and the shared cluster (FuzeInfra).
