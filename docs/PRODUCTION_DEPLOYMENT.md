# FuzeFront Production Deployment

> **Superseded:** FuzeFront no longer ships to production with Docker Compose. It is
> now deployed to Kubernetes via a Helm chart, managed by **Argo CD** (GitOps) on a
> Contabo **k3s** cluster. This document describes the current model. The old
> `docker-compose.prod.yml` / `fuzefront-prod` network approach is legacy.

## Overview

Production runs FuzeFront on a single-node k3s cluster on a Contabo VPS:

- **Orchestration:** k3s (Traefik disabled) + **ingress-nginx** controller.
- **GitOps:** Argo CD syncs the `fuzeinfra` and `fuzefront` Applications from this
  repo (app-of-apps).
- **Images:** GHCR (`ghcr.io/izzywdev/fuzefront-backend`, `…/fuzefront-frontend`),
  pulled with a sealed `ghcr-pull` secret.
- **TLS:** cert-manager with the `letsencrypt-prod` ClusterIssuer, serving
  `https://app.fuzefront.com`.
- **Secrets:** sealed-secrets (`kubeseal`) — encrypted YAML committed to git,
  decrypted only in-cluster.
- **Shared infra (FuzeInfra):** Postgres and Redis run in the `fuzeinfra` namespace
  and are reached cross-namespace via CoreDNS
  (`postgres.fuzeinfra.svc.cluster.local:5432`,
  `redis.fuzeinfra.svc.cluster.local:6379`).

The Helm chart lives at [`deploy/helm/fuzefront/`](../deploy/helm/fuzefront/); the
production overlay is
[`deploy/helm/fuzefront/values-prod.yaml`](../deploy/helm/fuzefront/values-prod.yaml).

## Architecture

```
                Cloudflare DNS (app.fuzefront.com → VPS IP)
                              │  https
                              ▼
                   ingress-nginx (k3s, host :80/:443)
                              │  Ingress `fuzefront` (TLS via cert-manager)
                              ▼
   namespace: fuzefront
     ┌──────────────────────────────────────────────┐
     │ fuzefront-frontend (svc :8080)                │
     │   in-pod nginx: serves SPA + proxies          │
     │   /api and /socket.io ─────┐                  │
     │ fuzefront-backend (svc :3001) ◀───────────────┘
     └───────────────┬──────────────────────────────┘
                     │ CoreDNS cross-namespace
                     ▼
   namespace: fuzeinfra
     postgres.fuzeinfra.svc.cluster.local:5432
     redis.fuzeinfra.svc.cluster.local:6379
```

## Prerequisites

- A Contabo VPS (Ubuntu 22.04, ~8 vCPU / 30 GB RAM), root SSH.
- Domain `fuzefront.com` on Cloudflare.
- A GHCR pull token (GitHub PAT with `read:packages`).
- `kubeseal` installed on your laptop (to seal secrets).

## Bring-up

The end-to-end bring-up is documented in
[`deploy/contabo/README.md`](../deploy/contabo/README.md). Summary:

### 1. DNS (Cloudflare)

Point A records at the VPS IP (grey-cloud / DNS-only is simplest for HTTP-01 TLS):

```
app.fuzefront.com      A  <VPS_IP>
argocd.fuzefront.com   A  <VPS_IP>
grafana.fuzefront.com  A  <VPS_IP>
```

### 2. Bootstrap the cluster (on the VPS)

```bash
# clone the repo (with submodules) on the VPS, then:
sudo bash deploy/contabo/bootstrap.sh      # edit cluster-issuer.yaml email first
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
```

Installs k3s (no Traefik) + ingress-nginx + cert-manager (+ `letsencrypt-prod`) +
sealed-secrets + Argo CD.

### 3. Seal the secrets (on your laptop)

Create the `fuzefront-secrets` (JWT/session/db/permit), `ghcr-pull`, and FuzeInfra
secrets and run them through `kubeseal`. Commit the encrypted
`deploy/contabo/sealed/*.yaml` (safe in git). Plaintext never leaves your laptop —
see [`deploy/contabo/README.md`](../deploy/contabo/README.md) for exact commands.

### 4. Hand the cluster to GitOps

```bash
kubectl apply -f deploy/argocd/project.yaml
kubectl apply -f deploy/argocd/app-of-apps.yaml
kubectl apply -f deploy/backup/postgres-backup-cronjob.yaml   # once secrets exist
```

Argo CD creates the `fuzeinfra` (Postgres + Redis + monitoring) and `fuzefront`
Applications and syncs them. cert-manager issues TLS for `app.fuzefront.com`.

### 5. Verify

```bash
kubectl -n fuzefront get pods,ingress
curl -fsS https://app.fuzefront.com/api/health

# Argo UI: https://argocd.fuzefront.com
kubectl -n argocd get secret argocd-initial-admin-secret \
  -o jsonpath='{.data.password}' | base64 -d
```

## Configuration (values-prod.yaml)

The production overlay differs from local only by GHCR images, the public host +
TLS, and the sealed secret:

```yaml
backend:
  image:
    repository: ghcr.io/izzywdev/fuzefront-backend
  replicas: 2
frontend:
  image:
    repository: ghcr.io/izzywdev/fuzefront-frontend
  replicas: 2

imagePullSecrets:
  - name: ghcr-pull

fuzeinfra:
  postgres: { host: postgres.fuzeinfra.svc.cluster.local, port: 5432 }
  redis:    { host: redis.fuzeinfra.svc.cluster.local,    port: 6379 }

database:
  name: fuzefront_platform
  user: fuzeinfra            # bootstraps as the FuzeInfra superuser for now

secret:
  existingSecret: fuzefront-secrets   # from a SealedSecret

ingress:
  enabled: true
  className: nginx
  host: app.fuzefront.com
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
  tls:
    enabled: true
    secretName: fuzefront-app-tls
```

## Releases (Day-2)

- **Image releases:** merging to `master` runs `release.yml`, which builds and
  pushes images to GHCR and bumps the image tag in `values-prod.yaml`; Argo CD then
  rolls the new tag out automatically.
- **Data safety:** the `fuzeinfra` Argo Application uses `prune: false` so a sync
  never deletes the Postgres/Redis PVCs. A nightly `pg_dump` ships to Contabo Object
  Storage (S3-compatible).
- **AWS path** (`deploy.yml`) is left intact and switchable.

## Security checklist

- [x] Secrets delivered via sealed-secrets (no plaintext in git or compose files)
- [x] TLS terminated at ingress-nginx via cert-manager `letsencrypt-prod`
- [ ] Harden the DB user from the FuzeInfra superuser (`fuzeinfra`) to a dedicated
      `fuzefront_user` with limited grants
- [ ] Configure proper CORS origins for the production host
- [ ] Review resource requests/limits and replica counts under load
- [ ] Confirm backup restore procedure periodically

## Troubleshooting

```bash
# Pods / ingress / events
kubectl -n fuzefront get pods,ingress
kubectl -n fuzefront describe ingress fuzefront
kubectl -n fuzefront logs deploy/fuzefront-backend

# Cross-namespace DB connectivity (CoreDNS)
kubectl -n fuzefront run dns-test --rm -it --image=busybox --restart=Never -- \
  nslookup postgres.fuzeinfra.svc.cluster.local

# TLS / cert-manager
kubectl -n fuzefront get certificate
kubectl -n fuzefront describe certificate fuzefront-app-tls

# Argo CD sync status
kubectl -n argocd get applications
```

See also [`docs/SERVICE_DISCOVERY_SOLUTION.md`](SERVICE_DISCOVERY_SOLUTION.md) for
how cross-namespace service discovery works under Kubernetes.
