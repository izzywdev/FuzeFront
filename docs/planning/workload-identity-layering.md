# Workload identity layering — why a consumer must not be the cluster's identity provider

> **Status: analysis + guardrail landed; target architecture DELEGATED, not built.**
> Authored 2026-10-04 (devops-engineer), from the 2026-09-28 deploy freeze.
>
> **What this document changes today:** the chart's cluster-scoped surface is
> reduced to the one rule that genuinely requires cluster scope and is now
> values-gated; a CI gate (`deploy/scripts/check-cluster-scoped-whitelist.sh`)
> makes the freeze condition a red PR instead of a silent production stall.
> **What it does NOT change:** FuzeFront's security service still holds
> `tokenreviews: create` cluster-wide. Only the platform broker in §4 removes
> that, and the broker does not exist. The FuzeInfra half is delegated in
> [izzywdev/FuzeInfra#1307](https://github.com/izzywdev/FuzeInfra/issues/1307).
>
> **Three claims in the originating analysis turned out to be wrong.** They are
> corrected in §2 and §6 rather than quietly dropped, because each one would have
> led to a wrong change.

## 1. The incident, and the mechanism that made two objects stop every deploy

`deploy/helm/fuzefront/templates/workload-identity.yaml` (added by PR #1190)
rendered a `ClusterRole`/`ClusterRoleBinding` named
`{{ .Release.Name }}-workload-authenticator`, bound to the `fuzefront-security`
ServiceAccount, with two rules:

```yaml
- apiGroups: ["authentication.k8s.io"]
  resources: ["tokenreviews"]
  verbs: ["create"]
- apiGroups: [""]
  resources: ["configmaps"]
  verbs: ["get", "list"]
```

The `fuzefront` Argo AppProject permitted only `{group: '', kind: Namespace}` as a
cluster-scoped resource — deliberately. FuzeInfra#625 → #629 narrowed every
project in the fleet off `clusterResourceWhitelist: {group: "*", kind: "*"}`
precisely so a consumer could not define cluster-level security. #625's framing is
worth quoting because it anticipated this exact object: *"The object whose entire
purpose is to be the destination/security boundary can be used to modify that
boundary, including its own."*

**The amplification is the part worth internalising.** Argo CD does not skip a
resource its AppProject forbids. The sync task is marked **invalid**, and Argo
**aborts the entire sync operation**. So no resource anywhere in the `fuzefront`
Application updated — not the frontend, not the backend, not any image tag. Three
successive GitOps image bumps produced zero movement in the cluster and nothing
deployed for hours. The failure surface was "deploys silently do nothing", which
is why the cause took so long to find: nothing was *broken*, everything was
*stale*.

`helm lint` and `kubeconform` were green the whole time, and always would be.
They validate manifest **shape** against the Kubernetes API schema. An Argo
AppProject admission boundary is not in any manifest's schema. This is the same
class of gap as:

| Guard | What the schema check could not see |
|---|---|
| `check-networkpolicy-ports` | `port: 0` is a valid integer; the API server rejects it at admission (FuzeInfra#501) |
| `check-authentik-public-paths.sh` | Traefik implements `pathType: Prefix` as a plain string prefix, so `/application` matched `/applications` |
| **`check-cluster-scoped-whitelist.sh`** (new, §3) | **Argo aborts a whole sync over one unpermitted cluster-scoped kind** |

## 2. The two rules are not the same kind of thing — and only one is irreducible

Verified against `backend/security/src/services/workload-identity.ts` at
`f7173453` / branch base `b9aa77c3` (the function is `authenticateKubernetesWorkload`, reached from
`backend/security/src/routes/security.ts:619`, route
`POST /api/v1/security/tokens/workload`):

**`tokenreviews: create` — irreducibly cluster-scoped.**
`workload-identity.ts:54` posts to
`/apis/authentication.k8s.io/v1/tokenreviews`. TokenReview is a *non-namespaced
virtual resource*; RBAC for it can only be a ClusterRole. There is no namespaced
form, and no amount of scoping in this repo changes that. The only way to remove
this grant from FuzeFront is **to stop performing TokenReviews in FuzeFront.**

**`configmaps: get, list` — never needed cluster scope.**
`workload-identity.ts:69` reads
`/api/v1/namespaces/${namespace}/configmaps?labelSelector=security.fuze.dev%2Fworkload-identity%3Dtrue`
— always exactly one namespace, and that namespace is destructured from the
TokenReview result at line 65, i.e. wherever the calling workload's ServiceAccount
lives. Granted as a ClusterRole, this is "read ConfigMaps in every namespace in
the cluster" — every other product's included — to serve a lookup that is always
single-namespace. **Fixed in this change:** it is now a namespaced `Role` +
`RoleBinding` in the release namespace (§5).

> **Correction 1.** The originating analysis cited these as lines ~69 and ~65 and
> was right about both. It also implied the ConfigMap rule could be scoped "down
> to the namespaces that actually host authenticating workloads", plural. In this
> repo that set is exactly one namespace — the release namespace — because both
> registered workloads (`fuzefront-backend`, `fuzefront-chat-service`, rendered as
> labelled ConfigMaps in the same file) live there. A *genuinely* cross-namespace
> caller cannot be served from here at all: this chart may only create objects in
> AppProject destinations (`fuzefront`, `fuzequality`, `argocd`), so it cannot
> create a Role in, say, `fuzekeys`. That ceiling is not an obstacle to engineer
> around — **it is the architectural proof that cross-namespace workload identity
> is a platform function.**

## 3. The guardrail (the most valuable part of this change)

`deploy/scripts/check-cluster-scoped-whitelist.sh`, wired into
`.github/workflows/helm-validate.yml` per values overlay. It renders the chart,
extracts every cluster-scoped kind, and asserts agreement with the AppProject's
`clusterResourceWhitelist` **read out of the project file itself** — never a
hardcoded list, so the gate cannot drift from the thing it asserts about.

**Two layers, and the second is the one that makes retirement real:**

1. **rendered ⊆ whitelist.** The freeze itself. A cluster-scoped kind the project
   does not permit fails the PR.
2. **whitelist ⊆ rendered** (closed set). A grant that outlives the template
   needing it is standing permission to modify cluster-level security. So when the
   chart stops rendering a kind, the grant must go in the same change. Entries
   legitimately never rendered carry a justification in the script
   (`WHITELIST_JUSTIFIED_UNRENDERED`) — today exactly one: `Namespace`, which Argo
   creates itself via `CreateNamespace=true`.

Layer 2 is why retiring the workload-authenticator grant (§4) is an **enforced
paired change** rather than a line in a document nobody re-reads: flipping
`securityService.workloadIdentity.clusterRbac.enabled: false` without also
deleting the two RBAC entries from `deploy/argocd/project.yaml` fails CI.
Measured, not asserted:

```
$ helm template ... --set securityService.workloadIdentity.clusterRbac.enabled=false
$ ./deploy/scripts/check-cluster-scoped-whitelist.sh rendered/fuzefront/templates
::error::... grants cluster-scoped 'rbac.authorization.k8s.io/ClusterRole', but the chart renders no such resource ...
::error::... grants cluster-scoped 'rbac.authorization.k8s.io/ClusterRoleBinding', but the chart renders no such resource ...
EXIT=1
```

**It fails closed on an unclassified kind.** Kubernetes does not encode scope in a
manifest and a PR runner has no cluster to ask, so the kind→scope mapping is an
explicit table. A rendered kind in neither list is an **error**, not a pass —
because the alternative is guessing, and guessing is how a sync-freezing kind
ships green. This is not theoretical: the table was incomplete on first run
(`NetworkPolicy`), and the gate refused to pass rather than assuming.

**Self-test first, and it is proven against the real regression, not a toy.**
`--self-test` runs 8 cases before the gate is trusted on real input: the exact
2026-09-28 shape must go RED; the same render against a permitting whitelist must
go GREEN; a group mismatch (`ClusterRole` in `''` vs `rbac.authorization.k8s.io`)
must go RED, since Argo matches group *and* kind; a namespaced-only render must go
GREEN (proving namespaced `Role` is not confused with cluster-scoped
`ClusterRole`); an unused grant must go RED; an unclassified kind must go RED; an
empty/unparseable whitelist must go RED rather than read as "nothing to check";
and `*/*` must go GREEN so the wildcard is honoured rather than treated as a
literal. Per `governance/vacuous-check-policy.json`: a check only ever observed
passing is evidence of nothing.

**Strongest available evidence that this gate catches the real thing** — the
current chart run against FuzeInfra's *actual, unmodified, still-live*
`argocd/projects/fuzefront.yaml` (fetched 2026-10-04), which is the file whose
whitelist froze the cluster:

```
AppProject clusterResourceWhitelist (fuzeinfra-project.yaml):
  /Namespace
Cluster-scoped resources rendered by the chart:
  rbac.authorization.k8s.io/ClusterRole
  rbac.authorization.k8s.io/ClusterRoleBinding
::error::the chart renders cluster-scoped 'rbac.authorization.k8s.io/ClusterRole',
         which the fuzefront AppProject does NOT permit. [...] ABORTS THE WHOLE SYNC
EXIT=1
```

### Which AppProject is authoritative, and why no copy of FuzeInfra's is committed

Two definitions exist and they **disagree**:

| File | Repo | `clusterResourceWhitelist` |
|---|---|---|
| `deploy/argocd/project.yaml` | FuzeFront | Namespace + ClusterRole + ClusterRoleBinding |
| `argocd/projects/fuzefront.yaml` | FuzeInfra | **Namespace only** |

**The gate asserts against FuzeFront's copy,** because that is both the one the
owner ruled authoritative and the one the cluster holds:

- FuzeInfra#625 centralised AppProject ownership in FuzeInfra and made
  `argocd-register.yml` **skip** `kind: AppProject` from a consumer path, which
  made an in-repo `project.yaml` inert.
- **FuzeInfra#639 reversed the ownership half of that by explicit owner ruling:**
  consumers own their AppProject so they can manage their own allow-lists without
  a FuzeInfra PR per change. The skip was removed; `argocd-register.yml` now
  `kubectl apply`s every manifest under the consumer's `deploy/argocd/`, its
  AppProject included. (#625's *other* outcome — the fleet-wide narrowing in #629
  — stands and is not in question.)

Rejected alternatives, stated so they are not re-proposed: **fetching** FuzeInfra's
file at CI time would make FuzeFront PRs red on another repo's HEAD with no
FuzeFront change, and would gate against a file the owner has ruled is not
authoritative; **committing a copy** of it would be a hand-synced duplicate of
another repo's file, which is the precise failure mode this whole incident is made
of.

## 4. Target architecture — a platform identity broker

**FuzeFront's security service is asking to be an identity provider for the
cluster.** `tokenreviews: create` cluster-wide means this product can verify *any*
ServiceAccount token in the cluster. That is a platform role, not an application
role. **The AppProject blocked it correctly — the defect is the location of the
function, not the strictness of the boundary.** FuzeInfra's own
`argocd/projects/fuzefront.yaml` already states the principle it was enforcing:
*"a consumer that needs an infra service consumes it via DNS, it does not deploy
into it."*

So: **FuzeInfra owns a `workload-identity` service in the `fuzeinfra` namespace**,
holding the single `tokenreviews: create` ClusterRole and the cross-namespace
ConfigMap read — legitimately, because it *is* the platform.

```
POST /v1/verify  { token }
  -> { service, namespace, serviceAccount, scopes[], exp }
```

consumed over `workload-identity.fuzeinfra.svc.cluster.local`. Consumers hold
**zero cluster RBAC**, and every consumer AppProject keeps
`clusterResourceWhitelist: [Namespace]` **permanently**.

**Workload registration stays with the consumer** — the labelled ConfigMaps this
chart already renders in its own namespace; the broker reads them. The invariant,
and the thing to hold onto when the next product asks for a ClusterRole:

> **The consumer declares intent; the platform grants the mechanism.**

### Why this beats both tactical options

- **Widening the whitelist** fixes one consumer, and is then asked for by every
  other product — eroding #629's hardening by exception until the fleet is back at
  `*/*` without a single decision having been made to go there. It is also what
  already happened (§6): the widening landed in the *consumer's own* copy of its
  own security boundary, which is exactly the hazard #625 named.
- **Reverting #1198** breaks the FuzeKeys registration it was merged to unblock,
  and answers nothing about where the function belongs. It trades a frozen deploy
  for a broken feature.

### Honest limits — what this change does NOT fix

- **Moving ClusterRole *authorship* to FuzeInfra would fix governance, not
  privilege.** Even with FuzeInfra authoring the manifest, the consumer's
  ServiceAccount still *holds* cluster-wide TokenReview. **Only the broker removes
  the capability.** Anything short of it is bookkeeping about who typed the YAML.
- **This PR does not reduce the privilege either.** It removes the cluster-wide
  ConfigMap read (real, measurable) and gates the rest behind a flag that is
  **default ON**, because `POST /tokens/workload` is a live route and the broker
  does not exist. Turning it off today breaks workload identity and FuzeKeys
  registration. The flag exists so the eventual flip is one values line, not a
  template rewrite under pressure.
- **Nothing here detects the next freeze in production.** The gate is pre-merge
  only. A freeze caused by anything other than a FuzeFront chart change — notably
  §6's armed re-freeze — is still invisible until someone notices stale images.
  Alerting is delegated (§7), and is the single highest-value item on that list.

## 5. What changed in this repo

| File | Change |
|---|---|
| `deploy/helm/fuzefront/templates/workload-identity.yaml` | ClusterRole reduced to `tokenreviews: create` only; `configmaps: get,list` moved to a namespaced `Role`+`RoleBinding`; cluster RBAC gated on `securityService.workloadIdentity.clusterRbac.enabled` **and** `securityService.enabled` |
| `deploy/helm/fuzefront/values.yaml` | new `securityService.workloadIdentity.clusterRbac.enabled: true`, declared explicitly with a value (not a render-site `default`), per CLAUDE.md "Helm values hygiene" |
| `deploy/scripts/check-cluster-scoped-whitelist.sh` | **new** — the gate, with 8-case self-test |
| `.github/workflows/helm-validate.yml` | runs the gate per overlay; also adds the `timeout-minutes` and top-level `concurrency` that `gate-workflow-policy` was already flagging on this job |
| `deploy/argocd/project.yaml` | header corrected: ownership is #639 not #625; the two RBAC entries documented as temporary with a paired retirement procedure; armed-re-freeze warning |
| `deploy/argocd/app-of-apps.yaml` | header **corrected** — it claimed the in-repo copy "is strictly narrower than FuzeInfra's … so applying it cannot re-widen anything", which #1198 made false |

A side effect worth naming: the cluster RBAC previously rendered
**unconditionally**, so a deployment with `securityService.enabled: false` — the
base `values.yaml` default — still granted cluster-wide TokenReview to a
ServiceAccount no running pod used. It no longer does.

**Rendered-output diff, per overlay** (CLAUDE.md requires this rather than an
eyeballed YAML diff). `helm template` before vs after, for `values.yaml`,
`values-local.yaml` and `values-prod.yaml`: in all three the **only** file that
differs is `workload-identity.yaml`, and the delta is exactly — three lines
removed from the ClusterRole (`configmaps`), and a `Role` + `RoleBinding` added.
No other template, in any overlay, changed by a single byte. Verified `helm lint`
clean, and all three Python gates re-run: `gate_workflow_yaml` 0 unparseable,
`gate_vacuous_check` OK, `gate_workflow_policy` **120 → 118 findings** (the two
fixed are this workflow's own; zero new).

## 6. State as of 2026-10-04 — measured, and it corrects the brief

The symptom that prompted this (`https://www.fuzefront.com/` returning
`301 -> https://fuzefront.com/`) is real: `www` now resolves to Cloudflare
(`2606:4700:…`) rather than CloudFront, and the 301 carries origin nginx security
headers with `cf-cache-status: DYNAMIC`, so it is served **by the cluster**, not by
a Cloudflare redirect rule. Argo is therefore syncing: PR #1201's Ingress claim
(merged 2026-09-28 08:26Z) is live.

> **Correction 2 — that symptom is not evidence about the Argo freeze, and
> FuzeInfra#1278 is a different issue entirely.** #1278 is the `www` DNS /
> CloudFront brand-split request, and it is **still open**. The `www` redirect
> working tells us only that *some* sync happened after #1201; it says nothing
> about the workload-identity whitelist. The two were conflated. The freeze's
> resolution had to be established separately, below.

**How the freeze actually resolved — none of (a)/(b)/(c) as framed:**

- FuzeInfra did **not** widen its whitelist. `argocd/projects/fuzefront.yaml` still
  reads `clusterResourceWhitelist: [{group: '', kind: Namespace}]`; its last commit
  is `5af55a5d`, **2026-08-23** (#629). So possibility (a) is false as stated.
- FuzeFront did **not** stop rendering the cluster RBAC. `workload-identity.yaml`
  was unchanged since `f7173453` (#1190) until this PR. So (b) is false.
- **What happened:** PR #1198 widened **FuzeFront's own** copy
  (`deploy/argocd/project.yaml`, merged 2026-09-28 **07:54:58Z**) to permit
  ClusterRole/ClusterRoleBinding — and FuzeInfra's `argocd-register` workflow ran
  successfully **18 seconds later at 07:55:16Z**, and again at 08:40:52Z, each run
  `kubectl apply`ing that file. The cluster holds the consumer's copy.

So it *is* scenario (a) in substance — a standing cluster-RBAC grant to a consumer,
to be retired once the broker exists — but **located in the consumer's own
AppProject, not FuzeInfra's.** A consumer repo widened its own security boundary
and a platform workflow applied it, which is precisely the hazard FuzeInfra#625
named. Under #639's ownership ruling that is *permitted by design*; it is still
worth seeing clearly for what it is.

### The freeze is not fixed. It is armed.

This is the most important measured finding, and it is new:

- FuzeInfra's Namespace-only copy still exists, and FuzeInfra's `deploy-prod.yml`
  re-applies `argocd/projects/*.yaml` on **any push touching that directory**
  (path filter `argocd/projects/**`; last such push 2026-08-23).
- **Nothing reconciles the AppProject continuously.** This repo's app-of-apps
  Application watches `deploy/argocd/applications`, **not** `deploy/argocd`, so
  `project.yaml` is not self-healed by Argo. Only whichever imperative
  `kubectl apply` ran most recently is in effect.
- Therefore **the next FuzeInfra push touching `argocd/projects/**` re-applies the
  Namespace-only whitelist and re-freezes the entire `fuzefront` Application** —
  same mechanism, same silence, with no FuzeFront change involved and nothing in
  FuzeFront CI able to see it.

Deleting FuzeInfra's duplicate is step 4 of **#639's own sequencing** and has not
happened. It cannot be done from this repo.

> **Correction 3 — do NOT ask FuzeInfra to make `argocd-register` refuse
> `kind: AppProject` from a consumer path.** The brief proposed this as "#625's
> suggested item 3 [which] evidently did not land". It *did* land (PR #629
> implemented the skip) and was then **deliberately removed** by owner ruling
> **#639**. Re-adding it would reverse an explicit owner decision *and* would make
> FuzeFront's own `project.yaml` inert again — which, since the cluster would fall
> back to FuzeInfra's Namespace-only copy, **would immediately re-freeze every
> FuzeFront deploy.** The correct ask is the opposite: delete the duplicate, and
> manage AppProjects through a self-healing Argo Application so drift is
> structurally impossible rather than merely against policy. That is what the
> delegation asks for.

### Still functioning

Workload identity itself is intact: the chart renders the RBAC, the AppProject
permits it, `POST /api/v1/security/tokens/workload` is wired
(`backend/security/src/routes/security.ts:619`), and both registration ConfigMaps
still render. **Not verified from this session:** that a FuzeKeys workload
*actually completes* a token exchange end-to-end. That needs cluster access this
session does not have and must not improvise; it is named in the NOT DONE list of
the delivering PR.

## 7. Delegated to FuzeInfra — [#1307](https://github.com/izzywdev/FuzeInfra/issues/1307)

FuzeInfra is never edited from a consuming repo (CLAUDE.md). Requested there, concretely:

1. **The broker** — `workload-identity` in the `fuzeinfra` namespace, the single
   `tokenreviews: create` ClusterRole, the `/v1/verify` contract above, and the
   consequence that every consumer AppProject can stay `Namespace`-only forever.
2. **The duplicate-AppProject defect** — single owner per #639, **delete** the
   consumer-duplicating copies, and manage AppProjects via a **self-healing Argo
   Application** so last-write-wins drift becomes structurally impossible. Includes
   the armed re-freeze above, which is live right now.
3. **Alerting** — Argo `Degraded`/`OutOfSync` past a threshold, and **"desired
   image ≠ running image" age**. Nobody noticed this for hours; that is the real
   operational gap, and the second alarm catches this entire class of failure
   regardless of cause. **This is the highest-value item in the delegation** — it
   is the only one that would have shortened the incident.
4. **Retiring the grant** once the broker serves — paired with FuzeFront dropping
   the two whitelist entries and flipping the values gate.

## 8. NOT DONE

- The broker does not exist. FuzeFront still holds cluster-wide
  `tokenreviews: create`. **This PR reduces the grant; it does not remove it.**
- The armed re-freeze (§6) is **not** fixed — the fix is FuzeInfra deleting its
  duplicate, delegated in #1307. Until then a FuzeInfra push touching
  `argocd/projects/**` re-freezes FuzeFront deploys.
- No production alerting on sync health or image staleness. Delegated.
- FuzeKeys end-to-end token exchange not verified against the live cluster (no
  cluster credential in this session, and prod is GitOps).
- The gate covers **this** repo's `fuzefront` chart via `helm-validate.yml`'s
  existing `values-local`/`values-prod` matrix. `deploy/helm/unleash` and
  `FuzeQuality/deploy/helm/fuzequality` — also governed by this same AppProject —
  are **not** checked by it. Neither renders a cluster-scoped kind today
  (confirmed: the whitelist was derived from all three charts), so layer 1 has
  nothing to catch there yet; extending the gate across all three is the obvious
  next increment and is not done.
- The gate is pre-merge only. It cannot see a cluster whose AppProject was
  replaced out from under it — see §6, and item 3 of the delegation.
- Nothing enforces the kind→scope table's *correctness*, only its completeness. A
  kind misclassified as namespaced would pass layer 1 wrongly. The table is small
  and reviewed; this is a known residual.
