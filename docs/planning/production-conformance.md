# Production conformance — measured state and the plan to close it

**Measured 2026-08-21 ~11:00Z against the Contabo k3s production cluster.**
Provenance: FuzeInfra `cluster-query` runs
[32475207623](https://github.com/izzywdev/FuzeInfra/actions/runs/32475207623) (`get pods -A -o wide`)
and [32475374902](https://github.com/izzywdev/FuzeInfra/actions/runs/32475374902) (`get svc,ingress -A -o wide`),
plus the GitHub Releases API for the Android artifact.

Nothing in this document is inferred from repository contents. A repo that *builds* a
thing and a cluster that *runs* it are different claims, and only the second one is
reported here as YES.

## Reading the table

| Value | Means |
|---|---|
| **YES** | Observed in production. A pod is `Running` **and** `Ready` — its readiness probe is passing right now — behind a Service. |
| **NO** | Observed absent or broken in production. The failure mode is named in the notes. |
| **NA** | Not applicable to this repo (no such component by design). |
| **UNVERIFIED** | Could not be measured from this session. The reason and the fix are in §3. Never treat as YES. |

## 1. The table

| Repo | Backend healthy | Swagger | FE federated module | Portal reg+act+enabled | In left menu | UI loads in portal | Private (not public) | MCP in prod | A2A pod | Android APK |
|---|---|---|---|---|---|---|---|---|---|---|
| **FuzeFront** | YES | UNVERIFIED | YES (host) | NA (is the host) | NA | NA | **NO** — `app.fuzefront.com` (correct; it is the portal) | YES `fuzefront-mcp` | NO | **YES** `android-v423`, 2026-08-19 |
| **FuzeAgent** | **NO** — `hierarchy-api` + `orchestrator` CrashLoopBackOff; pg/rabbit/redis ContainerCreating | UNVERIFIED | container Ready (`ui`) / UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED | **NO** — `fuzeagent.prod.fuzefront.com` | YES `mcp-server` | **YES** `a2a-shared` 1/1 | NA |
| **FuzeBI** | **NO** — `Init:CreateContainerConfigError` | UNVERIFIED | **NO** — `ImagePullBackOff` | UNVERIFIED | UNVERIFIED | UNVERIFIED | **NO** — `fuzebi.prod.fuzefront.com` | NO | NO | NA |
| **FuzeCall** | **NO** — no namespace in prod | NO | NA | NO | NO | NO | n/a — nothing deployed | NO | NO | NA |
| **FuzeContact** | YES (single svc :80) | UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED | **NO** — `fuzecontact.prod.fuzefront.com` | NO | NO | NA |
| **FuzeDeploy** | **NO** — no namespace in prod | NO | NA | NO | NO | NO | n/a | NO | NO | NA |
| **FuzeExecutive** | **NO** — `ImagePullBackOff` | UNVERIFIED | **NO** — `ImagePullBackOff` | UNVERIFIED | UNVERIFIED | UNVERIFIED | **NO** — `fuzeexecutive.prod.fuzefront.com` | NO | NO | NA |
| **FuzeFinance** | **NO** — `ImagePullBackOff` ×2 | UNVERIFIED | **NO** — `ImagePullBackOff` ×2 | UNVERIFIED | UNVERIFIED | UNVERIFIED | **NO** — `fuzefinance.prod.fuzefront.com` | NO | NO | NA |
| **FuzeHub** | YES 2/2 | UNVERIFIED | container Ready 2/2 / UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED | **NO** — `fuzehub.fuzefront.com` | YES `fuzehub-mcp` | NO | NA |
| **FuzeInfra** | NA (platform) | NA | NA | NA | NA | NA | mixed — 10+ ops hosts public by design | YES `handoff-mcp` | NO | NA |
| **FuzeKeys** | YES 2/2 | UNVERIFIED | container Ready 2/2 / UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED | **NO** — `keys.prod`, `api.keys.prod` | **NO** — `CreateContainerConfigError` | NO | NA |
| **FuzeMarket** | **NO** — `Init:CrashLoopBackOff` ×2 | UNVERIFIED | **NO** — no frontend workload in prod | UNVERIFIED | UNVERIFIED | UNVERIFIED | **NO** — `fuzemarket.prod.fuzefront.com` | **NO** — `CreateContainerConfigError` | NO | NA |
| **FuzeMerchandize** | **NO** — no namespace in prod | NO | NA | NO | NO | NO | n/a | NO | NO | NA |
| **FuzePicker** | YES 1/1 | UNVERIFIED | container Ready (`picker`) / UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED | **NO** — `picker.prod`, `picker.fuzefront.com`, `api.fuzepicker.prod` | YES `fuzepicker-mcp` | NO | NA |
| **FuzePlan** | YES 2/2 | UNVERIFIED | container Ready 2/2 / UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED | **NO** — `plan.fuzefront.com` | NO | NO | NA |
| **FuzeSales** | **PARTIAL** — `fuzesales` :80 Ready, `fuzesales-api` **ImagePullBackOff** | UNVERIFIED | container Ready / UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED | **NO** — `fuzesales.prod.fuzefront.com` | YES `fuzesales-mcp` | NO | NA |
| **FuzeSDLC** | NA (governance repo) | NA | NA | NA | NA | NA | n/a | NA | NA | NA |
| **FuzeService** | **PARTIAL** — `fuzeservice` :80 Ready, `fuzeservice-api` **CrashLoopBackOff** ×2 | UNVERIFIED | container Ready / UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED | **NO** — `fuzeservice.prod.fuzefront.com` | YES `fuzeservice-mcp` | NO | NA |
| **FuzeSocial** | **NO** — `ui` ImagePullBackOff, 5 workers ContainerCreating | UNVERIFIED | **NO** — `ImagePullBackOff` | UNVERIFIED | UNVERIFIED | UNVERIFIED | **NO** — `social.prod.fuzefront.com` | NO | NO | NA |
| **FuzeX** | **NO** — no namespace in prod | NO | NA | NO | NO | NO | n/a | NO | NO | NA |
| *FuzeQuality* (in prod, not in the 20) | YES | UNVERIFIED | YES | UNVERIFIED | UNVERIFIED | UNVERIFIED | **NO** — `quality.prod` — **but also has the correct `app.fuzefront.com` federated-mount ingress** | NO | NO | NA |

## 2. What the numbers actually say

- **5 of 20 repos have no production namespace at all**: FuzeCall, FuzeDeploy, FuzeMerchandize, FuzeX, FuzeSDLC (the last correctly — it is governance, not a product).
- **Of the 15 products that ARE deployed, 6 have a fully healthy backend**: FuzeFront, FuzeContact, FuzeHub, FuzeKeys, FuzePicker, FuzePlan (+ FuzeQuality). Two more are half-up (FuzeSales, FuzeService: legacy service Ready, new `-api` down).
- **7 products are broken on an image or config problem, not on code**: `ImagePullBackOff` (FuzeBI-fe, FuzeExecutive ×2, FuzeFinance ×4, FuzeSales-api, FuzeSocial-ui) and `CreateContainerConfigError` (FuzeBI, FuzeKeys-mcp, FuzeMarket-mcp, FuzeKeys-fe, FuzePlan-be third replica). `CreateContainerConfigError` means a referenced Secret or ConfigMap key does not exist — the registration-token hand-off, most likely.
- **Exactly ONE A2A pod exists in production, fleet-wide**: `fuzeagent/a2a-shared`. Every other repo declaring an `a2a` block has no running agent.
- **MCP: 6 product gateways Ready** (FuzeFront, FuzeHub, FuzePicker, FuzeSales, FuzeService, FuzeAgent) + `handoff-mcp` on the platform. 2 are deployed-but-broken (FuzeKeys, FuzeMarket) on the same config error.
- **Public exposure is the inverse of the intent: 14 of 14 deployed products have their own public `*.fuzefront.com` ingress.** The design says in-cluster apps should be reachable only through the portal's origin. Exactly one product — FuzeQuality — additionally has the correct `app.fuzefront.com` federated-mount ingress, and even it still carries its own public host.
- **Android: FuzeFront only, and it is real** — `android-v423` published 2026-08-19 from a `frontend/**` push to master. No other repo has an `android/` directory; NA rather than NO.

## 3. The two dimensions I could not measure, and why

These are marked UNVERIFIED above. They are not "probably fine".

### 3a. Swagger / OpenAPI reachable in production
Every product hostname resolves only through the Cloudflare tunnel. This session's egress
proxy blocks all of them (`curl` returns `000` for `app.fuzefront.com`,
`fuzehub.fuzefront.com`, `keys.prod.fuzefront.com`, `plan.fuzefront.com`). FuzeInfra's
`cluster-query` can curl, but only one host per run and only `*.prod.fuzefront.com` /
`*.mendysrobotics.com` — which excludes `fuzehub.fuzefront.com`, `plan.fuzefront.com`,
`picker.fuzefront.com` and `app.fuzefront.com` outright.

### 3b. Portal registration / activation / left menu / UI actually loading
The portal's truth is the `apps` table in the applications service
(`is_active`, lifecycle `status`, `nav.section` → `nav_rank`). **Every** read path is
authenticated — `/api/apps` and `/api/v1/app-registry/apps` both sit behind
`authenticateToken` / `authenticateConsumerOrSession`, and `/portals/:id/catalog` behind
`authenticateToken`. `cluster-query` cannot exec into Postgres (exec is blocked, correctly).
So there is no unauthenticated, in-cluster, machine-readable answer to "what does the portal
actually show" — which is exactly why this question keeps being answered by a human
counting menu entries.

**This is the finding, not an excuse.** Ten production properties are asked about
routinely and nothing measures any of them. The first item in the plan is therefore the
probe, not a fix.

## 4. Plan

### Step 1 — `prod-conformance` probe (FuzeInfra) — **prerequisite for everything else**
A scheduled + dispatchable workflow on the `staging` runner (in-cluster, so it can reach
ClusterIP Services directly and needs no public hostname and no Cloudflare Access bypass):

1. Enumerate every `fuze*` namespace.
2. Per namespace, for each Service: `curl` `/health`, `/healthz`, `/api/health` on the
   ClusterIP → **backend healthy**, measured, not inferred from pod readiness.
3. For each Service with an OpenAPI contract: `curl` `/api-docs`, `/swagger.json`,
   `/openapi.json`, `/docs` → **swagger**.
4. For each frontend Service: `curl` `/assets/remoteEntry.js` and assert it parses as a
   Module-Federation container → **FE federated module**, the only check that
   distinguishes "a container is running" from "a remote the host can mount".
5. Call the applications service **in-cluster** on `fuzefront-applications:3003` with a
   scoped service token and read the app list → **registered / activated / enabled /
   nav section**. This is the piece that needs a credential; mint a read-only consumer
   token for it rather than weakening any endpoint's auth.
6. Emit a markdown table as a job summary, and fail on regressions against a committed
   baseline.

Output: this document's table, regenerated on every run instead of by hand.

### Step 2 — the MCP `CreateContainerConfigError` — ROOT CAUSE FOUND, not a missing secret

> **Correction.** An earlier draft of this plan assumed a missing registration-token
> Secret key. `describe pod` disproved it. The doc's own rule — confirm before assuming —
> is the only reason this was caught, and it is recorded rather than quietly edited away.

`kubectl describe pod -n fuzekeys fuzekeys-mcp-664cf448b5-wjc2h`
([run 32475665961](https://github.com/izzywdev/FuzeInfra/actions/runs/32475665961)):

```
Warning  Failed  17s (x12357 over 47h)  kubelet
  Error: container has runAsNonRoot and image has non-numeric user (mcp),
  cannot verify user is non-root
Normal   Pulling 18s (x14836 over 10d)
```

The image `ghcr.io/izzywdev/fuze-mcp-gateway` declares `USER mcp` — a **name**. Kubernetes
cannot resolve a username to a UID without running the image, so when the pod sets
`runAsNonRoot: true` and no numeric `runAsUser`, the kubelet refuses to start the container.
It is not a secret, not a config key, and not a pull failure — the image pulls fine, 14,836
times over 10 days.

Deployment-level evidence ([run 32475767386](https://github.com/izzywdev/FuzeInfra/actions/runs/32475767386))
explains why some MCP gateways run and two do not:

| Deployment | image tag | pod `runAsUser` | state |
|---|---|---|---|
| `fuzehub-mcp` | `12cb4f787248` | none | **Running** |
| `fuzeservice-…-mcp` | `12cb4f787248` | none | **Running** |
| `fuzepicker-mcp` | `0.1.0` | **1000** | **Running** |
| `fuzesales-mcp` | `0.1.0` | none | **Running** (chart does not set `runAsNonRoot`) |
| `fuzekeys-mcp` | `0.1.0` | none | **BROKEN** |
| `fuzemarket-mcp` | `0.1.0` | none | **BROKEN** |

So the trigger is the *combination* `runAsNonRoot: true` + no numeric `runAsUser` + an image
with a named `USER`. Charts that pin a UID (FuzePicker) or that omit `runAsNonRoot`
(FuzeSales) survive — the second by accident, and it is a weaker security posture, so it
should not be copied as the fix.

**Fix, in this order:**
1. *Immediate, per-repo:* add `runAsUser: 1000` to the MCP container's `securityContext` in
   FuzeKeys' and FuzeMarket's charts, matching FuzePicker — already proven in production.
2. *Durable, fleet-wide:* rebuild `fuze-mcp-gateway` with a **numeric** `USER 65532` and
   publish, so the failure cannot recur in the next repo that adopts the gateway. The image
   is owned by FuzeService (FuzeService#37). Tag `12cb4f787248` may already do this —
   confirm against its Dockerfile before assuming, then repoint the `0.1.0` consumers.
3. *Prevent recurrence:* a chart-lint rule rejecting `runAsNonRoot: true` without a numeric
   `runAsUser`. This class fails at admission, not at lint or kubeconform — the same gap
   documented for NetworkPolicy ports in FuzeInfra#501.

### Step 2b — the remaining `CreateContainerConfigError` pods
`fuzebi`, `fuzekeys-frontend` (third replica) and `fuzeplan-backend` (third replica) still
show `Init:CreateContainerConfigError`. These were NOT diagnosed and may or may not share
the cause above — the ones examined were the MCP pods. `describe` each before acting.

### Step 3 — resolve `ImagePullBackOff` (FuzeExecutive, FuzeFinance, FuzeSocial, FuzeBI-fe, FuzeSales-api)
Tag never published, or the tag in the chart was never bumped. Related to the fleet-wide
`GH_RELEASE_PAT` gap (images publish, tags never bump). Confirm per repo which of the two
it is before touching charts.

### Step 4 — resolve the crash loops (FuzeAgent `hierarchy-api`/`orchestrator`, FuzeService `-api`, FuzeMarket init)
Real application failures; each needs its own log read and its own fix in its own repo.

### Step 5 — federated-mount ingress for every product, and retire the public per-product hosts
FuzeQuality's `fuzequality-federated-mount` on `app.fuzefront.com` is the pattern. Every
other product needs the same, and then its `*.prod.fuzefront.com` ingress removed. Order
matters: mount first, verify the remote loads through the portal, remove the public host
second. Removing first takes the product offline.

### Step 6 — A2A: one pod fleet-wide
Decide whether `a2a-shared` is intended to serve every tenant (in which case the other
repos' `a2a` blocks are registrations against it, and the gap is registration, not
deployment) or whether each product needs its own pod. The manifests do not currently
say which, and that ambiguity is why nothing has been deployed.

### Step 7 — deploy or de-scope the 5 undeployed repos
FuzeCall, FuzeDeploy, FuzeMerchandize, FuzeX have charts but no namespace. Either they
ship or their `portal.registers` should say `false` — carrying them as "coming" in the
registry is what makes the portal count look like a shortfall rather than a decision.

## 5. Ownership

Steps 2–4 are per-repo `devops-engineer` work. Step 1 and Step 5 are FuzeInfra
(`@claude` delegation from this repo, per the overlay). Steps 6–7 need an owner decision
before any code is written.
