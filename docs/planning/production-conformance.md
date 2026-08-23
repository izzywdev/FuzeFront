# Production conformance — measured state and the plan to close it

**Measured 2026-08-21 ~11:00Z against the Contabo k3s production cluster.**
Provenance: FuzeInfra `cluster-query` runs
[32475207623](https://github.com/izzywdev/FuzeInfra/actions/runs/32475207623) (`get pods -A -o wide`)
and [32475374902](https://github.com/izzywdev/FuzeInfra/actions/runs/32475374902) (`get svc,ingress -A -o wide`),
plus the GitHub Releases API for the Android artifact.

**Amended 2026-08-21 ~13:15Z** — §1 gained a third correction (the defective
"Private (not public)" column, now split in two), §1a, and §3c, backed by
[run 32484802532](https://github.com/izzywdev/FuzeInfra/actions/runs/32484802532)
(`get configmap coredns coredns-custom -o yaml`).

Nothing in this document is inferred from repository contents. A repo that *builds* a
thing and a cluster that *runs* it are different claims, and only the second one is
reported here as YES.

One deliberate exception, added 2026-08-21 and labelled at the point of use: **§1a reads
each repo's `registration/manifest.json`**, because a declared `remoteEntry` URL is not a
cluster fact and cannot be observed with `kubectl` — it is what the portal will hand the
browser. It is reported as a *declaration*, never as YES, and the cluster-observable half
of the same question (does the `app.fuzefront.com` mount Ingress exist) is measured
separately and marked as such.

## Reading the table

| Value | Means |
|---|---|
| **YES** | Observed in production. A pod is `Running` **and** `Ready` — its readiness probe is passing right now — behind a Service. |
| **NO** | Observed absent or broken in production. The failure mode is named in the notes. |
| **NA** | Not applicable to this repo (no such component by design). |
| **UNVERIFIED** | Could not be measured from this session. The reason and the fix are in §3. Never treat as YES. |

## 1. The table

| Repo | Backend healthy | Swagger | FE federated module | Portal reg+act+enabled | In left menu | UI loads in portal | MF remote same-origin (browser) | In-cluster S2S stays in-cluster | MCP in prod | A2A pod | Android APK |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **FuzeFront** | YES | UNVERIFIED | YES (host) | NA (is the host) | NA | NA | NA — is the host origin | NA — is the host | YES `fuzefront-mcp` | NO | **YES** `android-v423`, 2026-08-19 |
| **FuzeAgent** | **NO** — `hierarchy-api` + `orchestrator` CrashLoopBackOff; pg/rabbit/redis ContainerCreating | UNVERIFIED | container Ready (`ui`) / UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED | **NO** — MF remote, absolute `https://fuzeagent.prod.fuzefront.com/remoteEntry.js` | **NO** — cluster-wide (§3c) | YES `mcp-server` | **YES** `a2a-shared` 1/1 | NA |
| **FuzeBI** | **NO** — `Init:CreateContainerConfigError` | UNVERIFIED | **NO** — `ImagePullBackOff` | UNVERIFIED | UNVERIFIED | UNVERIFIED | NA — `integration.type: iframe` | **NO** — cluster-wide (§3c) | NO | NO | NA |
| **FuzeCall** | **NO** — no namespace in prod | NO | NA | NO | NO | NO | NA — `integration.type: spa`; nothing deployed | n/a — nothing deployed | NO | NO | NA |
| **FuzeContact** | YES (single svc :80) | UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED | **NO** — MF remote, absolute `https://fuzecontact.prod.fuzefront.com/assets/remoteEntry.js` | **NO** — cluster-wide (§3c) | NO | NO | NA |
| **FuzeDeploy** | **NO** — no namespace in prod | NO | NA | NO | NO | NO | NA — `integration.type: iframe`; nothing deployed | n/a — nothing deployed | NO | NO | NA |
| **FuzeExecutive** | **NO** — `ImagePullBackOff` | UNVERIFIED | **NO** — `ImagePullBackOff` | UNVERIFIED | UNVERIFIED | UNVERIFIED | NA — `integration.type: iframe` | **NO** — cluster-wide (§3c) | NO | NO | NA |
| **FuzeFinance** | **NO** — `ImagePullBackOff` ×2 | UNVERIFIED | **NO** — `ImagePullBackOff` ×2 | UNVERIFIED | UNVERIFIED | UNVERIFIED | NA — `integration.type: iframe` | **NO** — cluster-wide (§3c) | NO | NO | NA |
| **FuzeHub** | YES 2/2 | UNVERIFIED | container Ready 2/2 / UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED | NA — `integration.type: iframe` | **NO** — cluster-wide (§3c) | YES `fuzehub-mcp` | NO | NA |
| **FuzeInfra** | NA (platform) | NA | NA | NA | NA | NA | NA — platform, no portal remote | **NO** — cluster-wide; it owns the fix (§3c) | YES `handoff-mcp` | NO | NA |
| **FuzeKeys** | YES 2/2 | UNVERIFIED | container Ready 2/2 / UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED | **NO** — MF remote, absolute `https://keys.prod.fuzefront.com/apps/fuzekeys/remoteEntry.js` | **NO** — cluster-wide (§3c) | **NO** — `CreateContainerConfigError` | NO | NA |
| **FuzeMarket** | **NO** — `Init:CrashLoopBackOff` ×2 | UNVERIFIED | **NO** — no frontend workload in prod | UNVERIFIED | UNVERIFIED | UNVERIFIED | **NO** — MF remote, absolute `https://fuzemarket.fuze.internal/dist/remoteEntry.js` — and that host resolves nowhere | **NO** — cluster-wide (§3c) | **NO** — `CreateContainerConfigError` | NO | NA |
| **FuzeMerchandize** | **NO** — no namespace in prod | NO | NA | NO | NO | NO | NA — `integration.type: iframe`; nothing deployed | n/a — nothing deployed | NO | NO | NA |
| **FuzePicker** | YES 1/1 | UNVERIFIED | container Ready (`picker`) / UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED | **NO** — MF remote, absolute `https://picker.prod.fuzefront.com/remoteEntry.js` | **NO** — cluster-wide (§3c) | YES `fuzepicker-mcp` | NO | NA |
| **FuzePlan** | YES 2/2 | UNVERIFIED | container Ready 2/2 / UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED | NA — `integration.type: iframe` | **NO** — cluster-wide (§3c) | NO | NO | NA |
| **FuzeSales** | **PARTIAL** — `fuzesales` :80 Ready, `fuzesales-api` **ImagePullBackOff** | UNVERIFIED | container Ready / UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED | **NO** — MF remote, absolute `https://fuzesales.prod.fuzefront.com/assets/remoteEntry.js` | **NO** — cluster-wide (§3c) | YES `fuzesales-mcp` | NO | NA |
| **FuzeSDLC** | NA (governance repo) | NA | NA | NA | NA | NA | NA — governance repo | NA — governance repo | NA | NA | NA |
| **FuzeService** | **PARTIAL** — `fuzeservice` :80 Ready, `fuzeservice-api` **CrashLoopBackOff** ×2 | UNVERIFIED | container Ready / UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED | **NO** — MF remote, absolute `https://fuzeservice.prod.fuzefront.com/assets/remoteEntry.js` | **NO** — cluster-wide (§3c) | YES `fuzeservice-mcp` | NO | NA |
| **FuzeSocial** | **NO** — `ui` ImagePullBackOff, 5 workers ContainerCreating | UNVERIFIED | **NO** — `ImagePullBackOff` | UNVERIFIED | UNVERIFIED | UNVERIFIED | **NO** — MF remote, absolute `https://social.prod.fuzefront.com/_next/static/chunks/remoteEntry.js` | **NO** — cluster-wide (§3c) | NO | NO | NA |
| **FuzeX** | **NO** — no namespace in prod | NO | NA | NO | NO | NO | declared correct (`/apps/fuzex/remoteEntry.js`), **not deployed** — no mount Ingress exists | n/a — nothing deployed | NO | NO | NA |
| *FuzeQuality* (in prod, not in the 20) | YES | UNVERIFIED | YES | UNVERIFIED | UNVERIFIED | UNVERIFIED | **YES** — `/apps/fuzequality/assets/remoteEntry.js` + `fuzequality-federated-mount` Ingress on `app.fuzefront.com`, both observed | **NO** — cluster-wide (§3c) | NO | NO | NA |

> **Third correction — 2026-08-21.** The column that stood here was headed
> **"Private (not public)"** and it was defective. It recorded exactly one thing —
> *does this product have its own public hostname* — and then that one measurement was
> read as the answer to two unrelated questions. It is split above, because no single
> cell can carry both:
>
> - **Browser path.** A Module-Federation `remoteEntry.js` is fetched by the end user's
>   browser. It can *never* be served in-cluster, so "is it private" is not even a
>   coherent question about it. What matters is whether it is mounted **same-origin**
>   under `app.fuzefront.com/apps/<slug>/` — one origin, no third-party cookie/CORS
>   surface, no second public host to keep alive — rather than fetched from a separate
>   public host. That is now the **MF remote same-origin** column.
> - **In-cluster path.** Whether a *server-to-server* call from one pod to another
>   product resolves inside the cluster instead of leaving it. That is now the
>   **In-cluster S2S** column, and it is measured in §3c.
>
> Merging the two made FuzeQuality read as a near-miss ("**NO** — `quality.prod` — but
> also has the correct mount") when on the browser dimension it is the **only** full
> pass in the fleet, and it made every other row's real browser-path defect —
> an absolute cross-origin `remoteEntry` URL — invisible, because the column never
> looked at the manifest at all.
>
> The old column also asserted **"14 of 14 deployed products have their own public
> ingress"** as if that were the whole finding. It is true and it is not the finding.
> Measured against the manifests, only **10** of the 20 products are Module-Federation
> remotes in the first place; the same-origin requirement applies to those and to
> nothing else.

### 1a. The integration model is MIXED — the same-origin rule applies to MF only

Read from each repo's `registration/manifest.json` at `HEAD` on its default branch
(repository contents, **not** cluster state — labelled as such deliberately; the
`app.fuzefront.com` mount-Ingress column beside it *is* cluster-measured, from
[run 32475374902](https://github.com/izzywdev/FuzeInfra/actions/runs/32475374902)).

There are **three** integration types in the fleet, not two:

| `integration.type` | Repos | Same-origin mount required? |
|---|---|---|
| `module-federation` | FuzeAgent, FuzeContact, FuzeKeys, FuzeMarket, FuzePicker, FuzeSales, FuzeService, FuzeSocial, FuzeX, FuzeQuality | **Yes** — the host shell fetches `remoteEntry.js` into its own page |
| `iframe` | FuzeBI, FuzeDeploy, FuzeExecutive, FuzeFinance, FuzeHub, FuzeMerchandize, FuzePlan | No — a document boundary, not a shared JS runtime |
| `spa` | FuzeCall | No |

| Repo | type | declared entry | same-origin? | `app.fuzefront.com` mount Ingress observed |
|---|---|---|---|---|
| FuzeQuality | module-federation | `/apps/fuzequality/assets/remoteEntry.js` | **yes** | **yes** — `fuzequality-federated-mount` |
| FuzeX | module-federation | `/apps/fuzex/remoteEntry.js` | **yes** | no — repo has no prod namespace |
| FuzeAgent | module-federation | `https://fuzeagent.prod.fuzefront.com/remoteEntry.js` | no | no |
| FuzeContact | module-federation | `https://fuzecontact.prod.fuzefront.com/assets/remoteEntry.js` | no | no |
| FuzeKeys | module-federation | `https://keys.prod.fuzefront.com/apps/fuzekeys/remoteEntry.js` | no | no |
| FuzeMarket | module-federation | `https://fuzemarket.fuze.internal/dist/remoteEntry.js` | no | no — and `fuze.internal` is not a resolvable zone |
| FuzePicker | module-federation | `https://picker.prod.fuzefront.com/remoteEntry.js` | no | no |
| FuzeSales | module-federation | `https://fuzesales.prod.fuzefront.com/assets/remoteEntry.js` | no | no |
| FuzeService | module-federation | `https://fuzeservice.prod.fuzefront.com/assets/remoteEntry.js` | no | no |
| FuzeSocial | module-federation | `https://social.prod.fuzefront.com/_next/static/chunks/remoteEntry.js` | no | no |

**Two of ten MF remotes declare a same-origin entry. One of those is deployed.**

Two drifts fell out of this pass and are recorded rather than fixed here:

- **FuzeSocial disagrees with FuzeFront about what FuzeSocial is.** Its own
  `registration/manifest.json` says `module-federation`; this repo's seed copy,
  `services/app-registry-service/seed/fuzesocial.manifest.json`, says `iframe` with
  `builtin: true`. Whichever the portal actually loads, one of the two files is wrong,
  and nothing compares them.
- **FuzeMarket's `remoteEntry` points at `fuzemarket.fuze.internal`**, a hostname with no
  zone anywhere in the fleet. That remote cannot load for any user from any network.


## 2. What the numbers actually say

- **5 of 20 repos have no production namespace at all**: FuzeCall, FuzeDeploy, FuzeMerchandize, FuzeX, FuzeSDLC (the last correctly — it is governance, not a product).
- **Of the 15 products that ARE deployed, 6 have a fully healthy backend**: FuzeFront, FuzeContact, FuzeHub, FuzeKeys, FuzePicker, FuzePlan (+ FuzeQuality). Two more are half-up (FuzeSales, FuzeService: legacy service Ready, new `-api` down).
- **7 products are broken on an image or config problem, not on code**: `ImagePullBackOff` (FuzeBI-fe, FuzeExecutive ×2, FuzeFinance ×4, FuzeSales-api, FuzeSocial-ui) and `CreateContainerConfigError` (FuzeBI, FuzeKeys-mcp, FuzeMarket-mcp, FuzeKeys-fe, FuzePlan-be third replica). `CreateContainerConfigError` means a referenced Secret or ConfigMap key does not exist — the registration-token hand-off, most likely.
- **Exactly ONE A2A pod exists in production, fleet-wide**: `fuzeagent/a2a-shared`. Every other repo declaring an `a2a` block has no running agent.
- **MCP: 6 product gateways Ready** (FuzeFront, FuzeHub, FuzePicker, FuzeSales, FuzeService, FuzeAgent) + `handoff-mcp` on the platform. 2 are deployed-but-broken (FuzeKeys, FuzeMarket) on the same config error.
- **Public exposure is the inverse of the intent: 14 of 14 deployed products have their own public `*.fuzefront.com` ingress** ([run 32475374902](https://github.com/izzywdev/FuzeInfra/actions/runs/32475374902)). Read carefully, though — that count is a *fact about ingresses*, not a verdict on either path, and it used to be reported as both (see the third correction in §1):
  - **Browser path:** of the **10** Module-Federation remotes, **2** declare a same-origin entry (FuzeQuality, FuzeX) and exactly **1** — FuzeQuality — has the `app.fuzefront.com` mount Ingress live. The other 8 hand the browser an absolute cross-origin URL. The 7 `iframe` products and 1 `spa` product are out of scope for this rule by design.
  - **In-cluster path:** **zero** products resolve a sibling's `*.prod.fuzefront.com` name inside the cluster, because no such mapping exists in CoreDNS at all (§3c). This is one cluster-level defect, not 14 product defects.
- **Android: FuzeFront only, and it is real** — `android-v423` published 2026-08-19 from a `frontend/**` push to master. No other repo has an `android/` directory; NA rather than NO.

## 3. The dimensions that needed their own measurement

§3a and §3b are still **UNVERIFIED** — the reasons are below and they are not
"probably fine". §3c was added on 2026-08-21 and is the opposite case: it *was*
measured, and the answer is a firm NO.

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

### 3c. In-cluster server-to-server — **MEASURED 2026-08-21, and the answer is NO**

*This one is not UNVERIFIED.* Split-horizon DNS for `*.prod.fuzefront.com` is **absent**
from the production cluster. A pod calling `https://fuzesales.prod.fuzefront.com/health`
resolves that name through public DNS to a Cloudflare edge address, egresses to the
internet, and re-enters through the Cloudflare Tunnel to reach a Service that may be on
the same node — paying full WAN latency, and making an internal call depend on external
infrastructure.

Observed directly in `kube-system/coredns`
([run 32484802532](https://github.com/izzywdev/FuzeInfra/actions/runs/32484802532),
`get configmap coredns coredns-custom -o yaml`). The Corefile in full:

```
.:53 {
    errors
    health
    ready
    kubernetes cluster.local in-addr.arpa ip6.arpa {
      pods insecure
      fallthrough in-addr.arpa ip6.arpa
    }
    hosts /etc/coredns/NodeHosts { ttl 60; reload 15s; fallthrough }
    prometheus :9153
    cache 30
    loop
    reload
    loadbalance
    import /etc/coredns/custom/*.override
    forward . /etc/resolv.conf
}
import /etc/coredns/custom/*.server
```

No `rewrite`, no `template`, and the single `hosts` block reads `/etc/coredns/NodeHosts`,
which the same output shows contains ten `10.0.0.x` node entries and nothing else. There
is no rule that could match `*.prod.fuzefront.com`, so every such query falls through to
`forward . /etc/resolv.conf` — the node's upstream resolver, i.e. public DNS. The same
run reports `configmaps "coredns-custom" not found`, so no override file exists either.

Two details make this cheap to fix rather than awkward:

1. `import /etc/coredns/custom/*.override` is already **inside** the `.:53` block. k3s
   ships that import and mounts the `coredns-custom` ConfigMap optionally, so the
   extension point exists and is currently empty — creating it clobbers nothing.
2. The `coredns` ConfigMap itself is owned by the k3s Addon controller
   (`objectset.rio.cattle.io/owner-gvk: k3s.cattle.io/v1, Kind=Addon`), so editing it
   directly would be reverted. `coredns-custom` is the supported seam, not a workaround.

**This is FuzeInfra's fix, not a product repo's** — one CoreDNS override serves the whole
fleet, which is why the table above reports it once as a cluster-wide NO rather than as
14 separate product failures. Tracked in FuzeInfra (see §4 Step 5).

One honest caveat on the shape of the fix: prod terminates TLS at the Cloudflare edge and
the tunnel reaches Traefik over **plain HTTP** (`ingress.tls.enabled: false` in
`values-contabo.yaml`; every product Ingress shows `PORTS 80`). So there is no certificate
inside the cluster for `*.prod.fuzefront.com`, and pointing the name at Traefik makes
`http://` work while `https://` would fail certificate validation. Callers that want the
in-cluster path must use `http://`, or the cluster needs a real internal certificate — a
separate decision, and one that should be made explicitly rather than discovered by a
failing TLS handshake.


## 4. Plan

### Step 1 — `prod-conformance` probe (FuzeInfra) — **SHIPPED: FuzeInfra#614**
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

### Step 2b — the remaining `CreateContainerConfigError` pods — RESOLVED into Step 3b
`fuzekeys-frontend` and `fuzeplan-backend` are `secret "fuzefront-registration" not found`
(see Step 3b). `fuzebi` produced no event in the window and remains undiagnosed.

### Step 3 — `ImagePullBackOff` is NOT a missing tag — it is IPv6 egress to GHCR

> **Second correction.** This plan first said "tag never published, or never bumped".
> `get events -A --field-selector reason=Failed`
> ([run 32476193949](https://github.com/izzywdev/FuzeInfra/actions/runs/32476193949))
> disproved that too. Both of this document's initial guesses about production were wrong,
> and both were wrong in the same direction — assuming the familiar cause.

The dominant message is not `manifest unknown` or `unauthorized`. It is:

```
Failed to pull image "ghcr.io/izzywdev/fuzefront-applications-service:c6a3e7121f91":
  failed to copy: read tcp [2a02:c207:2345:8548::1]:46540
                        -> [2606:50c0:8000::154]:443: read: connection reset by peer
```

`2606:50c0:8000::154` is GitHub's package CDN over **IPv6**. The nodes resolve GHCR to an
IPv6 address, start the transfer, and the connection is reset mid-copy. The image exists
and is authorised — the pull begins and then dies on the wire.

**This is a cluster egress defect, and it is hitting FuzeFront itself**, not only the
products listed in §1: `fuzefront-applications`, `fuzefront-frontend` and
`fuzefront-db-bootstrap` all have replicas stuck this way, alongside `fuzeplan-backend`,
`fuzequality-migrations`, `mendys-mcp-server` and `mendys-wp`. Running pods are unaffected
because their layers are already on the node — which is why the fleet looks healthier than
it is, and why every NEW rollout is the thing that fails.

Fix belongs to FuzeInfra, not to any product repo: prefer IPv4 for registry egress on the
nodes (or fix the tunnel/NAT path for IPv6 to `pkg-containers.githubusercontent.com`).
Until that lands, no amount of chart or tag work in a product repo will help, and doing
that work would look like progress while changing nothing.

### Step 3b — the genuinely missing secrets, now named

Two failures in the same event dump are real config gaps, and they are NOT the pull problem:

| Pod | Event |
|---|---|
| `fuzekeys-frontend`, `fuzeplan-backend` | `Error: secret "fuzefront-registration" not found` |
| `fuzesocial-ui` | `Error: couldn't find key FUZEFRONT_API_URL in Secret fuzesocial/fuzesocial-secrets` |

The first **is** the registration-token hand-off gap — the hypothesis that was wrong for
the MCP pods is correct here. FuzeInfra's `governance/credential-handoff.json` carries 18
entries and `publish-sealed-handoff` has never been dispatched for the full set. The second
is a single missing key in an existing Secret, which the hand-off does not cover.

Not diagnosed, deliberately: FuzeExecutive, FuzeFinance and FuzeBI's `ImagePullBackOff`
pods produced no events in the window (Kubernetes events expire in about an hour), so
whether they share the IPv6 cause is **unknown**. Re-run the events query while they are
backing off before assuming they do.

### Step 4 — resolve the crash loops (FuzeAgent `hierarchy-api`/`orchestrator`, FuzeService `-api`, FuzeMarket init)
Real application failures; each needs its own log read and its own fix in its own repo.

### Step 5 — close the browser path and the in-cluster path (two jobs, not one)

These were a single line here until the 2026-08-21 correction in §1, and they are
independent: doing either one does not advance the other.

**5a — browser path: same-origin mount for the 8 non-conforming MF remotes.**
FuzeQuality's `fuzequality-federated-mount` on `app.fuzefront.com` is the pattern, and
FuzeFront's chart already generalises it (`federatedApps` in
`deploy/helm/fuzefront/values.yaml` renders the `/apps/<slug>` Ingress + Traefik
strip-prefix Middleware) — but that list is `[]` in every overlay, so the host shell
currently mounts no remotes of its own. Each product must also change its
`registration/manifest.json` `remoteEntry` from an absolute URL to `/apps/<slug>/…`;
the Ingress alone does nothing while the manifest still names a public host. Scope is
the 10 `module-federation` repos only — the 7 `iframe` and 1 `spa` products are out of
scope by design (§1a). Order matters: mount first, verify the remote loads through the
portal, remove the public host second. Removing first takes the product offline.

**5b — in-cluster path: split-horizon DNS.** One CoreDNS `coredns-custom` override in
FuzeInfra, serving the whole fleet at once (§3c). Independent of 5a and much cheaper:
no product repo has to change anything. Note that 5b does **not** let 5a be skipped —
split-horizon DNS is invisible to the end user's browser, which is on the internet and
resolves through public DNS no matter what CoreDNS says.

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

Steps 2–4 are per-repo `devops-engineer` work. Step 1 and Step 5b are FuzeInfra
(`@claude` delegation from this repo, per the overlay). Step 5a is split: the
`federatedApps` Ingress list is FuzeFront's own chart, and each `remoteEntry` rewrite is
the owning product repo's `registration/manifest.json`. Steps 6–7 need an owner decision
before any code is written.

The two drifts named at the end of §1a (FuzeSocial's manifest disagreeing with this
repo's seed copy; FuzeMarket's unresolvable `fuze.internal` remote) have **no owner and
no gate**. Nothing compares a product's `registration/manifest.json` against the seed in
`services/app-registry-service/seed/`, and nothing checks that a declared `remoteEntry`
host resolves. Both are cheap to add to the Step 1 probe and are the reason the
disagreement survived this long.
