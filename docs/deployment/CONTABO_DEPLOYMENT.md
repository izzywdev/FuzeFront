# FuzeFront — Contabo Production Runbook

Status: **operational**. This is the day-to-day runbook for the FuzeFront
platform running on **Contabo k3s + Argo CD** at **`app.fuzefront.com`**. The
`fuzefront.com` apex (static landing) stays on AWS CloudFront and is out of scope
here.

> Architecture/design rationale lives in the second half of this doc
> ([Design background](#design-background)). Read the runbook first.

---

## 0. TL;DR — how a change ships

```
merge PR → master
  │
  ▼
release.yml (GitHub Actions)
  ├─ build + push images to GHCR  (ghcr.io/izzywdev/fuzefront-*:<sha>)
  └─ bump image tags in deploy/helm/fuzefront/values-prod.yaml + commit "release: … [skip ci]"
  │
  ▼
git (source of truth)
  │  Argo CD watches the repo
  ▼
Argo CD on Contabo  ──sync──▶ rolling update of fuzefront Deployments
  │
  ▼
prod-smoke.yml polls https://app.fuzefront.com/api/health → expects 200
```

You do **not** `kubectl apply` or `helm upgrade` against prod by hand. Git is the
only way in. Local dev uses Helm/Skaffold on kind; prod is GitOps-only.

---

## 1. Release flow (normal change)

1. Open a PR; `helm-validate.yml` lints + kubeconforms the chart on any
   `deploy/helm/**` change.
2. Merge to `master`.
3. `release.yml` builds the changed images, pushes them to GHCR by commit SHA,
   then rewrites the `tag:` keys in `deploy/helm/fuzefront/values-prod.yaml` and
   commits `release: fuzefront images <sha> [skip ci]`.
4. Argo CD detects the git change and syncs the `fuzefront` Application
   (`syncPolicy.automated.selfHeal: true`).
5. `prod-smoke.yml` fires on that `release:` commit (it touches
   `values-prod.yaml`), waits for the rollout, and polls
   `https://app.fuzefront.com/api/health` until 200.

Check status:

```bash
# Argo app health/sync
argocd app get fuzefront            # or the Argo UI at argocd.fuzefront.com
kubectl -n fuzefront get deploy,pods
# Health over the public ingress
curl -fsS https://app.fuzefront.com/api/health | jq
```

---

## 2. Rollback

**Rollback = revert the tag-bump commit. Argo re-syncs to the previous images.**

```bash
# Find the release commit (subject starts with "release:")
git log --oneline --grep '^release:' -5
# Revert it (this re-points values-prod.yaml at the prior SHA)
git revert --no-edit <release-sha>
git push origin master
```

Argo CD picks up the revert and rolls the Deployments back to the previous image
tags. Because the images are still in GHCR (immutable by SHA), the rollback is
exact and fast. No `helm rollback`, no manual image edits.

If Argo is stuck, force a sync from the UI or `argocd app sync fuzefront`. Never
edit live resources with `kubectl edit` — `selfHeal` will revert you, and you'll
have drift from git.

---

## 3. Data safety (`prune: false`)

Both Argo Applications (`fuzefront`, `fuzeinfra`) run with:

```yaml
syncPolicy:
  automated:
    prune: false   # never auto-delete; protects FuzeInfra PVCs (Postgres/Redis/Kafka)
    selfHeal: true
```

- **Stateful data lives in FuzeInfra** (Postgres/Redis/Kafka/Chroma on k3s
  `local-path`). `prune: false` means an Argo sync never deletes a resource that
  disappears from git — so a bad chart edit can't wipe a PVC. The trade-off:
  removing a workload from the chart leaves the old object until you prune it
  **manually and deliberately** (`argocd app sync fuzefront --prune` or
  `kubectl delete`), after confirming it's not a datastore.
- StatefulSets keep their PVCs across image/config changes — upgrades never
  recreate volumes.
- **Backups**: a `pg_dump` CronJob (`deploy/backup/`) ships nightly dumps to
  Contabo Object Storage (S3-compatible). Verify restores periodically.

---

## 4. Adding the 2nd node (node-2)

The plan sizes prod for **two Contabo nodes**: node-1 (control-plane + the
DB-heavy FuzeInfra stateful pods on `local-path`) and node-2 (heavy stateless
compute: LiteLLM / chat / billing). No Longhorn yet — stateful pods stay pinned to
node-1's disk.

### Join node-2 as a k3s agent

On node-1 (server), get the join token:

```bash
sudo cat /var/lib/rancher/k3s/server/node-token
```

On node-2 (fresh Ubuntu), install the agent pointing at node-1:

```bash
curl -sfL https://get.k3s.io | \
  K3S_URL=https://<node-1-public-ip>:6443 \
  K3S_TOKEN=<token-from-above> \
  sh -
```

Firewall between nodes (open on both): **6443/TCP** (k3s API), **8472/UDP**
(Flannel VXLAN), **10250/TCP** (kubelet metrics). If the nodes talk over public
IPs, switch Flannel to the **WireGuard** backend so pod traffic is encrypted.

Verify + label node-2 so the affinity in `values-prod.yaml` matches:

```bash
kubectl get nodes -o wide
# The affinity blocks key on kubernetes.io/hostname=fuzefront-node-2.
# Either name the host accordingly at install, or relabel:
kubectl label node <node-2-name> kubernetes.io/hostname=fuzefront-node-2 --overwrite
```

`values-prod.yaml` gives `litellm`/`chatService`/`billingService` a
**preferred** (soft) nodeAffinity toward `fuzefront-node-2`, so they schedule
there when it exists and fall back to node-1 if it doesn't. Stateful FuzeInfra
pods are unaffected (they pin to node-1 via FuzeInfra's own config).

---

## 5. Secrets — sealed-secrets rotation

All FuzeFront secrets live in the SealedSecret that decrypts to the
`fuzefront-secrets` Secret in the `fuzefront` namespace (referenced via
`secret.existingSecret`). Keys include: `JWT_SECRET`, `SESSION_SECRET`,
`DB_PASSWORD`, `DB_SUPERUSER_PASSWORD`, `PERMIT_API_KEY`,
`INTERNAL_PROVISION_SECRET`, `AUTHENTIK_SECRET_KEY`,
`AUTHENTIK_BOOTSTRAP_PASSWORD`, `AUTHENTIK_BOOTSTRAP_TOKEN`,
`AUTHENTIK_CLIENT_SECRET`, and (when enabled) `SENDGRID_API_KEY` /
`TWILIO_*` / `SMS_AUTH_SECRET` / `SMTP_PASSWORD`.

### Rotate one or more keys

```bash
# 1. Fetch the cluster's sealing public cert (one-time; safe to commit/share).
kubeseal --fetch-cert \
  --controller-name sealed-secrets \
  --controller-namespace kube-system > pub-cert.pem

# 2. Build the new Secret locally (do NOT commit this plaintext).
kubectl create secret generic fuzefront-secrets \
  --namespace fuzefront \
  --from-literal=JWT_SECRET="$(openssl rand -hex 32)" \
  --from-literal=DB_PASSWORD='...' \
  ...all other keys... \
  --dry-run=client -o yaml > /tmp/fuzefront-secrets.yaml

# 3. Seal it against the cluster cert.
kubeseal --cert pub-cert.pem --format yaml \
  < /tmp/fuzefront-secrets.yaml > deploy/contabo/sealed/fuzefront-secrets.yaml

# 4. Commit ONLY the sealed file + push. Argo applies it; the controller
#    decrypts into the real Secret in-cluster.
git add deploy/contabo/sealed/fuzefront-secrets.yaml && git commit && git push

# 5. Roll the pods that read the rotated keys (they read at startup).
kubectl -n fuzefront rollout restart deploy/fuzefront-backend deploy/fuzefront-security
```

Notes:
- The sealed file is safe in git; the plaintext (`/tmp/...`) must never be
  committed — delete it after sealing.
- Rotating `DB_PASSWORD` also requires the runtime DB role's password to change;
  the `db-bootstrap` Job sets the role password to `DB_PASSWORD` on the next
  upgrade, so seal the new value and let the pre-upgrade Job reconcile it.
- A full sealing-key rotation (controller keypair) re-encrypts everything —
  follow the sealed-secrets controller's key-renewal procedure, then re-seal.

---

## 6. Kafka topics

Prod pre-creates the prefixed topics via a Helm post-install/post-upgrade Job
(`templates/kafka-topics-job.yaml`, gated by `kafkaTopics.enabled: true` in
`values-prod.yaml`) rather than relying on broker auto-create. The topic set is
reconciled from the `@fuzefront/shared` `TOPICS` constant plus the planned
billing/chat events. When that constant changes, edit `kafkaTopics.topics` in
`values.yaml`. The Job uses `--create --if-not-exists`, so it is safe to re-run on
every upgrade; it never shrinks partitions/retention.

---

## 7. Observability

- FuzeFront pods carry `prometheus.io/scrape|port|path` annotations (set when
  `observability.metrics.enabled: true`, on in prod). The backend exposes
  `/metrics` via prom-client. The FuzeInfra Prometheus auto-discovers them.
- Dashboards (`deploy/helm/fuzefront/dashboards/*.json`) and alert rules
  (`deploy/helm/fuzefront/alerts/*.yaml`) ship as ConfigMaps labeled
  `grafana_dashboard: "1"` / `prometheus_rule: "1"`. The FuzeInfra Grafana sidecar
  + Prometheus rule mount discover them (those discovery hooks are added in
  FuzeInfra separately).
- Logs flow to Loki automatically (Promtail scrapes all namespaces).

---

## Design background

<details>
<summary>Why this shape (k3s + Argo + GHCR + sealed-secrets)</summary>

- **Contabo gives VPS, not managed Kubernetes** → run lightweight **k3s** (single
  binary, production-capable, standard Kubernetes). Our `deploy/helm/fuzefront` +
  the FuzeInfra Helm chart apply unchanged.
- **Argo CD** makes git the source of truth: the cluster continuously reconciles
  to what's committed — the cloud analogue of Skaffold locally.
- **Images**: GHCR (`ghcr.io/izzywdev/fuzefront-*`), tagged by immutable git SHA;
  the cluster pins the SHA (never `latest`) so deploys are reproducible.
- **Secrets**: sealed-secrets — encrypt against the cluster's public key, commit
  the `SealedSecret`, the controller decrypts in-cluster only.
- **Cluster add-ons** (installed once, then GitOps-managed): ingress-nginx
  (parity with kind's `ingressClassName: nginx`), cert-manager (`ClusterIssuer
  letsencrypt-prod`, HTTP-01), sealed-secrets, Argo CD (app-of-apps).
- **DNS/TLS**: Cloudflare DNS `app.fuzefront.com` + `auth.fuzefront.com` →
  Contabo VPS IP; cert-manager issues Let's Encrypt certs per ingress host.
  Firewall: 80/443 open; 22 + 6443 restricted to admin IP.

</details>

<details>
<summary>Bootstrap sequence (one-time, already done on the live cluster)</summary>

1. Provision Contabo VPS (Ubuntu, ~8 vCPU / 30 GB).
2. Install k3s (Traefik disabled); fetch kubeconfig.
3. Install ingress-nginx, cert-manager (+ ClusterIssuer), sealed-secrets, Argo CD.
4. Point Cloudflare DNS at the VPS; create the Let's Encrypt account.
5. Seal secrets (`kubeseal`) and commit the `SealedSecret` manifests.
6. Apply the app-of-apps Argo Application → it creates `fuzeinfra` + `fuzefront`.
7. Push to `master` → `release.yml` pushes images + bumps tags → Argo rolls out.

Steps 1–4 are codified in `deploy/contabo/` (bootstrap script + ClusterIssuer).

</details>
