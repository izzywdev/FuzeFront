# FuzeFront — Cloud Deployment Design (Contabo)

Status: **design** (for review). Implementation artifacts are listed at the end;
nothing here changes the running system yet.

Goal: run the **FuzeFront platform** (not the corporate website) on Contabo with a
GitOps pipeline — push to `master` → images built/pushed → Argo CD syncs the
cluster — using the **same Helm charts** we run locally on kind, so local and
cloud differ only by a values overlay.

---

## 1. Why this shape

- **Contabo gives VPS/dedicated servers, not managed Kubernetes.** So we run a
  lightweight self-managed cluster (**k3s**) on a Contabo VPS. k3s is a single
  binary, production-capable, and speaks standard Kubernetes — our existing
  `deploy/helm/fuzefront` + the FuzeInfra Helm chart apply unchanged.
- **GitOps with Argo CD** (already added to FuzeInfra) makes git the source of
  truth: the cluster continuously reconciles to what's committed. This is what
  gives us "automated cloud redeploys" — the cloud analogue of Skaffold locally.
- **Local builds → Skaffold/kind. Cloud builds → GitHub Actions → GHCR → Argo.**
  Same charts, different image source + values.

---

## 2. Topology

```
GitHub (master)
  │  merge
  ▼
GitHub Actions ──build──▶ GHCR (ghcr.io/izzywdev/fuzefront-*)   [images, by SHA]
  │  bump image tag in values-prod.yaml + commit
  ▼
git repo (deploy manifests = source of truth)
  │  watches
  ▼
Argo CD (in-cluster on Contabo k3s)  ──sync──▶ namespaces: fuzeinfra, fuzefront
                                                   │
Cloudflare DNS ──▶ Contabo VPS public IP ──▶ ingress-nginx ──▶ frontend/backend
                                                   ▲
                                          cert-manager (Let's Encrypt TLS)
```

### Cluster components (installed once, then GitOps-managed)
| Component | Purpose | Notes |
|---|---|---|
| **k3s** | the cluster | disable bundled Traefik; we use ingress-nginx for parity with kind |
| **ingress-nginx** | ingress controller | charts already use `ingressClassName: nginx` |
| **cert-manager** | TLS certs | `ClusterIssuer` letsencrypt-prod (HTTP-01, or DNS-01 via Cloudflare for wildcards) |
| **Argo CD** | GitOps engine | app-of-apps pattern; reconciles fuzeinfra + fuzefront |
| **sealed-secrets** (Bitnami) | secrets in git, safely | encrypt secrets → commit `SealedSecret` → controller decrypts in-cluster |
| **Argo Image Updater** *(optional)* | auto-bump tags | alternative to CI committing the tag |

---

## 3. Image registry: GHCR

Move platform images off Docker Hub to **GitHub Container Registry** (free,
integrated, private-capable):
- `ghcr.io/izzywdev/fuzefront-backend`
- `ghcr.io/izzywdev/fuzefront-frontend`
- `ghcr.io/izzywdev/fuzefront-clock-app` (example)

CI tags each image with the **git SHA** (immutable) plus `latest`. The cluster
pins the **SHA** (never `latest`) so deploys are reproducible and Argo sees a
real diff to sync.

---

## 4. CI → CD flow (GitOps, git is the source of truth)

On merge to `master` (new workflow `release.yml`):
1. Build + push `backend`, `frontend`, `clock-app` to GHCR tagged `:<sha>`.
2. **Bump the tag in `deploy/helm/fuzefront/values-prod.yaml`** (`backend.image.tag`,
   `frontend.image.tag`) and commit `[skip ci]`.
3. Argo CD detects the git change and **syncs** the `fuzefront` Application →
   rolling update to the new images.

> Why CI-commits-the-tag over Argo Image Updater: git stays the single source of
> truth (auditable, revertible). Image Updater is a fine alternative if you'd
> rather not commit on every release.

---

## 5. Values overlay (prod)

New `deploy/helm/fuzefront/values-prod.yaml`:
- `backend.image.repository: ghcr.io/izzywdev/fuzefront-backend` (+ frontend), `tag: <sha>`
- `ingress.host: app.fuzefront.com`, `ingress.className: nginx`, TLS enabled
  (cert-manager annotation + tls secret)
- `secret.existingSecret: fuzefront-secrets` (provided by a SealedSecret — no
  plaintext in the chart)
- `database`: point at the in-cluster FuzeInfra Postgres
  (`postgres.fuzeinfra.svc.cluster.local`), dedicated `fuzefront_user`
- resource requests/limits sized for the VPS; `replicas: 2` for backend/frontend

FuzeInfra gets a prod overlay too (full stack or a curated subset:
Postgres + Redis + monitoring), with persistence on.

---

## 6. Secrets (no plaintext in git)

Use **sealed-secrets**:
1. Install the controller in-cluster (generates a keypair).
2. Locally: `kubeseal` encrypts each secret (JWT, SESSION, DB passwords,
   `PERMIT_API_KEY`, Authentik secret/bootstrap, GHCR pull token) against the
   cluster's public key.
3. Commit the resulting `SealedSecret` manifests; Argo applies them; the
   controller decrypts into a real `Secret` (`fuzefront-secrets`,
   `fuzeinfra-secrets`) only inside the cluster.

This keeps the repo safe (ties into the earlier secret-hygiene work) while staying
fully GitOps.

---

## 7. Data & data-safe upgrades

- **Storage:** k3s `local-path` provisioner (VPS disk) for PVCs to start; move to
  Contabo block storage if you need to detach/grow volumes independently.
- **StatefulSets keep their PVCs** across Helm/Argo upgrades — image/config changes
  never recreate the volume. Configure the Argo Application with
  `syncOptions: [PrunePropagationPolicy=foreground]` and **exclude PVCs from
  pruning** (Argo prune ignores resources without the managed label / use
  `Prune=false` on PVCs) so a sync never deletes data.
- **Backups:** a `CronJob` runs `pg_dump` (and Redis snapshot if needed) and ships
  to **Contabo Object Storage** (S3-compatible) nightly; retain N days. Restore
  runbook documented.

---

## 8. DNS, TLS, networking

- **Cloudflare** DNS: `app.fuzefront.com` (+ `*.apps.fuzefront.com` for example
  microfrontends, `argocd.fuzefront.com`, `grafana.fuzefront.com`) → Contabo VPS IP.
- **cert-manager** issues Let's Encrypt certs per ingress host (DNS-01 via the
  Cloudflare API token enables a wildcard `*.apps.fuzefront.com` so new apps get
  TLS automatically).
- **VPS firewall:** allow 80/443 from anywhere; restrict 22 (SSH) and 6443 (k3s
  API) to your admin IP. Optionally front with Cloudflare proxy for edge DDoS/TLS.

---

## 9. Bootstrap sequence (one-time)

1. Provision Contabo VPS (Ubuntu 22.04, ~Cloud VPS L: 8 vCPU / 30 GB RAM).
2. Install k3s with Traefik disabled; fetch kubeconfig.
3. Install ingress-nginx, cert-manager (+ ClusterIssuer), sealed-secrets, Argo CD.
4. Point Cloudflare DNS at the VPS IP; create the Cloudflare API token for DNS-01.
5. Seal secrets (`kubeseal`) and commit the `SealedSecret` manifests.
6. Apply the **app-of-apps** Argo Application → it creates the `fuzeinfra` and
   `fuzefront` Applications, which sync the charts.
7. Push to `master` → `release.yml` pushes images + bumps tags → Argo rolls out.

Steps 1–4 can be codified with **Ansible** (VPS + k3s + add-ons) and, if you want
infra-as-code for the VPS itself, the community **Contabo Terraform provider**.

---

## 10. Artifacts to create at implementation time

- `deploy/helm/fuzefront/values-prod.yaml` (GHCR images, ingress host + TLS, existingSecret)
- `deploy/argocd/` — `project.yaml`, `app-of-apps.yaml`, `applications/fuzefront-prod.yaml`
  (FuzeInfra already ships `argocd/applications/*` to adapt for Contabo)
- `deploy/contabo/` — Ansible playbook (k3s + ingress-nginx + cert-manager +
  sealed-secrets + Argo), `ClusterIssuer`, firewall notes, bootstrap README
- `deploy/backup/postgres-backup-cronjob.yaml` (pg_dump → Contabo S3)
- `.github/workflows/release.yml` — build + push to GHCR + bump tag in values-prod + commit
- SealedSecret manifests for `fuzefront-secrets` / `fuzeinfra-secrets`

---

## 11. Open decisions (need your input before implementing)

1. **Domain** for the platform (e.g. `app.fuzefront.com`?) and whether to use
   Cloudflare proxy.
2. **VPS size / count** — single node to start (simplest), or 3 nodes for HA
   (needs a real storage story, e.g. Longhorn).
3. **FuzeInfra scope in prod** — full stack vs Postgres + Redis + monitoring only.
4. **Registry** — GHCR (recommended) vs Docker Hub vs Contabo-hosted.
5. **Secrets** — sealed-secrets (recommended) vs SOPS vs External Secrets.
6. Keep the existing AWS **website** deploy (`deploy.yml`) or retire it.
