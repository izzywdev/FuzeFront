# Production Readiness Checklist (for external adopters)

This is a pre-flight checklist for a team evaluating FuzeFront for a **real
workload** — not the local evaluation loop in the
[Adoption Quickstart](ADOPTION_QUICKSTART.md). It does not duplicate the
deployment docs; it tells you which doc to read for each decision, what is
**required** before you let real users or real data near it, and what is only
**recommended**. Nothing here replaces reading the linked docs — they contain
the actual commands and config.

Audience: a CTO or platform engineer deciding whether, and how, to adopt
FuzeFront, and what has to be true in their own environment before they do.

**Reference deployment.** The concrete commands linked below describe
FuzeFront's own production reference: a single-node **Contabo VPS running
k3s**, GitOps'd with **Argo CD**. The checklist items themselves are written
to be infrastructure-neutral — every "Required" item is a property your
deployment needs, not a mandate to use Contabo/k3s. Where a linked doc is
Contabo/k3s-specific, that is called out so you know which parts to adapt for
EKS, a managed Kubernetes offering, or another VPS provider.

---

## 1. Authentication & authorization

- [ ] **(Required)** Decide your identity provider path before go-live.
  FuzeFront's Helm chart ships **local JWT auth only** today; **Authentik
  (OIDC) is not yet in the Helm chart** — it currently runs only as an interim
  step from the legacy root `docker-compose.yml`. If you need OIDC/SSO in
  Kubernetes, you are either waiting on that chart work or wiring it yourself.
  See the status note at the top of
  [`AUTHENTICATION_SETUP.md`](AUTHENTICATION_SETUP.md).
- [ ] **(Required)** Authorization is ReBAC/ABAC via **Permit**, evaluated
  against real roles/resources — plan your policy model, don't rely on
  JWT claims alone. Read
  [`consumers/authn-authz-integration.md`](consumers/authn-authz-integration.md)
  for the trust model and
  [`consumers/onboarding-authn-authz.md`](consumers/onboarding-authn-authz.md)
  for the integration steps if you're attaching your own product.
- [ ] **(Required)** Your product must be served **same-origin** with the
  platform (`/api/v1/security/*` resolves without a cross-origin base URL).
  Hard-coding an absolute API host is a documented footgun — see the
  Prerequisites section of
  [`consumers/onboarding-authn-authz.md`](consumers/onboarding-authn-authz.md).
- [ ] **(Recommended)** Review [`SECURITY.md`](SECURITY.md) for the
  vulnerability-disclosure process before you depend on timely security fixes.

## 2. Secrets

- [ ] **(Required)** Never commit plaintext secrets. The reference deployment
  uses **sealed-secrets** (`kubeseal`): plaintext is built locally, sealed
  against the cluster's public cert, and only the sealed YAML is committed.
  Full key list and the rotation procedure are in
  [`deployment/CONTABO_DEPLOYMENT.md` §5](deployment/CONTABO_DEPLOYMENT.md#5-secrets--sealed-secrets-rotation).
  If you're not on sealed-secrets, replace it with an equivalent
  (your cloud's secret manager, Vault, SOPS) — the requirement is "no
  plaintext secret in git", not the specific tool.
- [ ] **(Required)** Know which secrets are load-bearing before you go live:
  `JWT_SECRET`, `SESSION_SECRET`, `DB_PASSWORD`, `PERMIT_API_KEY`,
  `INTERNAL_PROVISION_SECRET`, plus the Authentik keys if you run it. See the
  key list in
  [`deployment/CONTABO_DEPLOYMENT.md` §5](deployment/CONTABO_DEPLOYMENT.md#5-secrets--sealed-secrets-rotation).
  For GitHub Actions-side secrets (image registry, deploy tokens), see
  [`setup/SECRETS_SETUP.md`](setup/SECRETS_SETUP.md) — note some entries there
  predate the Kubernetes migration; cross-check against the Helm chart's
  `values-prod.yaml` before trusting a specific secret name.
- [ ] **(Required)** Have a rotation procedure, not just an initial secret.
  Rotating `DB_PASSWORD` also requires the database role's password to
  change — the two are coupled; see the same §5 for the exact sequence.

## 3. Ingress / TLS

- [ ] **(Required)** Decide your TLS termination path up front — it is not
  interchangeable mid-flight. The FuzeFront reference deployment terminates
  TLS at **ingress-nginx + cert-manager** (`letsencrypt-prod`, HTTP-01) — see
  [`PRODUCTION_DEPLOYMENT.md`](PRODUCTION_DEPLOYMENT.md) and
  [`deployment/CONTABO_DEPLOYMENT.md`](deployment/CONTABO_DEPLOYMENT.md). This
  is a **different ingress model** from the one FuzeInfra's own CLAUDE.md
  documents for its shared platform (Cloudflare Tunnel in front of a
  `ClusterIP`-pinned Traefik) — if you run both FuzeFront and FuzeInfra
  together, reconcile which ingress path actually terminates your traffic
  before assuming either doc is authoritative for your cluster.
- [ ] **(Required)** DNS and firewall: only 80/443 need to be public; restrict
  22 and the Kubernetes API port to admin IPs. See the "Design background"
  section of
  [`deployment/CONTABO_DEPLOYMENT.md`](deployment/CONTABO_DEPLOYMENT.md).
- [ ] **(Recommended)** If you add a second node, plan the inter-node
  firewall (k3s API, Flannel VXLAN, kubelet) and consider the WireGuard
  Flannel backend if nodes talk over public IPs — see
  [`deployment/CONTABO_DEPLOYMENT.md` §4](deployment/CONTABO_DEPLOYMENT.md#4-adding-the-2nd-node-node-2).

## 4. Database & storage

- [ ] **(Required)** Decide whether you run **FuzeInfra** (Postgres, Redis,
  and friends in the `fuzeinfra` namespace, reached cross-namespace via
  CoreDNS) or point FuzeFront at your own managed database/cache instead.
  FuzeFront does not ship a database — see §"Assumptions on the broader Fuze
  stack" below and FuzeInfra's own
  [service inventory](https://github.com/izzywdev/FuzeInfra/blob/main/CLAUDE.md#service--port-inventory).
- [ ] **(Required)** Harden the database role before go-live. The reference
  deployment currently bootstraps FuzeFront's DB access as the **FuzeInfra
  superuser** — moving to a dedicated, limited-grant `fuzefront_user` is an
  explicit open item, not done by default. See the Security checklist in
  [`PRODUCTION_DEPLOYMENT.md`](PRODUCTION_DEPLOYMENT.md#security-checklist)
  and the per-service role convention in
  [`runbooks/per-service-database-and-role.md`](runbooks/per-service-database-and-role.md).
- [ ] **(Required)** Confirm your Argo sync policy protects stateful data.
  The reference Applications set `prune: false` specifically so a chart
  change can never auto-delete the Postgres/Redis/Kafka PVCs — see
  [`deployment/CONTABO_DEPLOYMENT.md` §3](deployment/CONTABO_DEPLOYMENT.md#3-data-safety-prune-false).
  If you adopt a different GitOps tool, replicate this guarantee explicitly.

## 5. Health checks

- [ ] **(Required)** Wire your load balancer / uptime monitor to
  `GET /api/health` (and the unauthenticated `/health`), which `prod-smoke.yml`
  polls after every deploy — see the TL;DR in
  [`deployment/CONTABO_DEPLOYMENT.md`](deployment/CONTABO_DEPLOYMENT.md#0-tldr--how-a-change-ships).
- [ ] **(Required)** If you deploy via the Helm chart, verify readiness and
  liveness probes exist for every workload you enable (they're defined per
  service under `deploy/helm/fuzefront/templates/`) — a workload with no
  probe can report `Running` while failing silently.
- [ ] **(Recommended)** If you're a consumer app attaching to a FuzeFront
  deployment rather than operating it yourself, you can verify your own
  rollout read-only via FuzeInfra's
  [`cluster-query.yml`](https://github.com/izzywdev/FuzeInfra/blob/main/docs/consuming-repos/CLUSTER_QUERY.md)
  instead of asking whoever owns the cluster to relay `kubectl` output.

## 6. Observability

- [ ] **(Required)** Decide where metrics, logs, and dashboards land before
  you need them during an incident, not after. The reference deployment
  scrapes `/metrics` (prom-client) via `prometheus.io/scrape` annotations into
  FuzeInfra's Prometheus, ships dashboards/alert rules as labeled ConfigMaps,
  and routes logs to Loki via Promtail — see
  [`deployment/CONTABO_DEPLOYMENT.md` §7](deployment/CONTABO_DEPLOYMENT.md#7-observability).
  None of this exists unless the FuzeInfra monitoring stack
  (`prometheus`/`grafana`/`loki`/`promtail`) is actually deployed alongside
  FuzeFront — it is a separate `enabled` gate, not bundled with FuzeFront's
  own chart.
- [ ] **(Recommended)** Alert on the health endpoint and on Argo CD sync/health
  status, not only on pod restarts — a `Degraded` Argo Application can sit
  that way for reasons unrelated to your last deploy.

## 7. Backups

- [ ] **(Required)** Confirm a backup actually exists for every datastore you
  depend on. The reference deployment runs a nightly `pg_dump` CronJob
  (`deploy/backup/postgres-backup-cronjob.yaml`) to S3-compatible object
  storage — see
  [`deployment/CONTABO_DEPLOYMENT.md` §3](deployment/CONTABO_DEPLOYMENT.md#3-data-safety-prune-false).
  This covers Postgres only; Redis, Kafka, and any other FuzeInfra-hosted
  store are not covered by this CronJob.
- [ ] **(Required)** Test the restore path yourself. The docs say to "verify
  restores periodically" — that is guidance, not an automated or audited
  procedure in this repo. Treat an unverified backup as no backup.

## 8. Upgrade / rollback

- [ ] **(Required)** Understand the normal release path before your first
  production change: merge to `master` → `release.yml` builds images,
  pushes to GHCR by immutable SHA, and bumps `values-prod.yaml` → Argo CD
  syncs → `prod-smoke.yml` polls `/api/health`. See
  [`deployment/CONTABO_DEPLOYMENT.md` §1](deployment/CONTABO_DEPLOYMENT.md#1-release-flow-normal-change).
- [ ] **(Required)** Know the rollback procedure **before** you need it:
  `git revert` the `release:` tag-bump commit and push — Argo re-syncs to the
  prior (still-immutable, still-in-GHCR) image. See
  [`deployment/CONTABO_DEPLOYMENT.md` §2](deployment/CONTABO_DEPLOYMENT.md#2-rollback).
  There is no supported `helm rollback` / manual image-edit path; using one
  fights GitOps self-heal.
- [ ] **(Recommended)** If you fork the release pipeline for your own
  registry/CI, keep the same shape (immutable-SHA images, git as the only
  rollback mechanism) rather than inventing a parallel one.

## 9. GitOps expectations

- [ ] **(Required)** Treat git as the only way into the cluster. Argo CD's
  `selfHeal: true` means a hand-applied `kubectl patch`/`kubectl edit` against
  a live resource is reverted, typically within seconds — see
  [`deployment/CONTABO_DEPLOYMENT.md` §2](deployment/CONTABO_DEPLOYMENT.md#2-rollback)
  and, for the FuzeInfra side of the same cluster, FuzeInfra's own
  [GitOps + self-heal policy](https://github.com/izzywdev/FuzeInfra/blob/main/CLAUDE.md#gitops--self-heal-prod-is-gitops--non-negotiable).
  If you adopt FuzeFront outside Argo CD, replicate "git is authoritative,
  nothing else writes to the cluster" with whatever GitOps tool you use —
  the moment that stops being true, drift and silently-reverted fixes follow.
- [ ] **(Required)** If you deploy FuzeFront alongside FuzeInfra, FuzeInfra
  owns the Argo `AppProject`/`Application` wiring for its own namespace and
  does not expect consumer repos to self-register into it. See FuzeInfra's
  [consumer-app onboarding guide](https://github.com/izzywdev/FuzeInfra/blob/main/docs/consuming-repos/ONBOARDING_A_CONSUMER_APP.md).

---

## Assumptions this checklist depends on from the broader Fuze stack

These are not FuzeFront's to satisfy — they're prerequisites FuzeFront's own
docs assume are already true:

- **FuzeInfra is deployed and reachable.** Postgres, Redis, Kafka, the
  monitoring stack, and cross-namespace DNS resolution
  (`*.fuzeinfra.svc.cluster.local`) all come from the separate **FuzeInfra**
  platform, not from FuzeFront's own Helm chart. FuzeFront's chart assumes
  these exist; it does not create them. See FuzeInfra's
  [`CLAUDE.md`](https://github.com/izzywdev/FuzeInfra/blob/main/CLAUDE.md) for
  what it does and does not provide, and its dual delivery model
  (`docker-compose.FuzeInfra.yml` for local, `helm/fuzeinfra/` for
  kind/EKS/Contabo).
- **A GitOps controller (Argo CD in the reference deployment) is already
  managing the cluster** before you point FuzeFront's chart at it. FuzeFront's
  own "never hand-deploy" guidance only holds if that controller is actually
  running and synced.
- **Secret sealing/decryption infrastructure (sealed-secrets' controller, or
  your substitute) is already installed in-cluster.** The Helm chart
  references an `existingSecret`; nothing here provisions the secret backend
  itself.
- **DNS and a TLS issuer you control.** cert-manager needs a `ClusterIssuer`
  and a domain you can point at the cluster; neither is provided by
  FuzeFront.

## What FuzeFront does not guarantee for you

- **No SLA, no managed hosting.** `app.fuzefront.com` is FuzeFront's own
  reference deployment, not a service offered to adopters. Running FuzeFront
  in production means **you** operate the cluster, the database, the
  backups, and the on-call rotation for it.
- **The production Helm chart does not yet include OIDC/SSO (Authentik) or
  the policy engine (Permit) end-to-end.** Local JWT auth is what ships in
  the chart today; see §1. If your adoption decision depends on OIDC being
  production-ready in Kubernetes out of the box, it currently is not.
- **The documented database-hardening step (dedicated DB role) and the
  Kafka topic pre-creation Job are known, named, currently-incomplete items**
  in FuzeFront's own production deployment, not hypothetical risks — see §4
  and [`deployment/CONTABO_DEPLOYMENT.md` §6](deployment/CONTABO_DEPLOYMENT.md#6-kafka-topics).
  Don't assume either is handled for you just because the chart deploys
  cleanly.
- **No audited disaster-recovery drill.** A nightly `pg_dump` exists;
  there is no evidence in this repo of a timed, tested restore. Budget for
  running that drill yourself before you trust it.
- **No multi-region or managed-control-plane HA.** The reference deployment
  is a single-node (optionally two-node) k3s cluster. If your workload needs
  HA beyond what k3s + your cloud's load balancer provides, that is
  infrastructure you add, not something FuzeFront's chart does for you.
- **Security vulnerability response is a documented process, not a staffed
  team with contracted response times.** Read
  [`SECURITY.md`](SECURITY.md)'s reporting process and timeline expectations
  honestly before depending on them for a regulated workload — and note the
  contact address there is a placeholder (`[INSERT SECURITY EMAIL]`) rather
  than a configured inbox at the time of writing; treat the GitHub Security
  Advisories path as the reliable one until that's filled in.
- **Cost and capacity sizing are not provided.** The Contabo reference sizing
  (~8 vCPU / 30 GB per node) is what FuzeFront's own production runs on, not
  a sizing recommendation validated against your workload.

---

*Found a step here that's wrong, stale, or missing a link? This checklist is
meant to be corrected in place — open a PR against this file rather than a new
doc that duplicates it.*
