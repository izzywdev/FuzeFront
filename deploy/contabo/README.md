# FuzeFront on Contabo (k3s + Argo CD)

End-to-end bring-up for the platform on a single Contabo VPS. See the design in
[`docs/deployment/CONTABO_DEPLOYMENT.md`](../../docs/deployment/CONTABO_DEPLOYMENT.md).

## Prerequisites
- Contabo VPS (Ubuntu 22.04, ~8 vCPU / 30 GB RAM), root SSH.
- Domain `fuzefront.com` on **Cloudflare**.
- A GHCR pull token (GitHub PAT with `read:packages`).
- `kubeseal` installed on your laptop (to seal secrets).

## 1. DNS (Cloudflare)
Point these A records at the VPS public IP (DNS-only / grey-cloud is simplest
for HTTP-01 TLS; you can enable the proxy later):
```
app.fuzefront.com      A  <VPS_IP>
argocd.fuzefront.com   A  <VPS_IP>
grafana.fuzefront.com  A  <VPS_IP>
```

## 2. Bootstrap the cluster (on the VPS)
```bash
# clone the repo (with submodules) on the VPS, then:
sudo bash deploy/contabo/bootstrap.sh      # edit cluster-issuer.yaml email first
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
```
Installs k3s (no Traefik) + ingress-nginx + cert-manager (+ letsencrypt-prod) +
sealed-secrets + Argo CD.

## 3. Seal the secrets (laptop, against the cluster's key)
```bash
# Private GHCR pull secret
kubectl create secret docker-registry ghcr-pull -n fuzefront \
  --docker-server=ghcr.io --docker-username=izzywdev --docker-password=$GHCR_TOKEN \
  --dry-run=client -o yaml | kubeseal -o yaml > deploy/contabo/sealed/ghcr-pull.yaml

# FuzeFront app secret (JWT/session/db/permit)
kubectl create secret generic fuzefront-secrets -n fuzefront \
  --from-literal=JWT_SECRET=... --from-literal=SESSION_SECRET=... \
  --from-literal=DB_PASSWORD=... --from-literal=PERMIT_API_KEY=... \
  --dry-run=client -o yaml | kubeseal -o yaml > deploy/contabo/sealed/fuzefront-secrets.yaml

# FuzeInfra Postgres creds (consumed by the chart + the backup job)
kubectl create secret generic fuzeinfra-secrets -n fuzeinfra \
  --from-literal=POSTGRES_USER=... --from-literal=POSTGRES_PASSWORD=... ... \
  --dry-run=client -o yaml | kubeseal -o yaml > deploy/contabo/sealed/fuzeinfra-secrets.yaml

# Backup target (Contabo Object Storage, S3-compatible)
kubectl create secret generic backup-s3 -n fuzeinfra \
  --from-literal=AWS_ACCESS_KEY_ID=... --from-literal=AWS_SECRET_ACCESS_KEY=... \
  --from-literal=S3_ENDPOINT=https://eu2.contabostorage.com --from-literal=S3_BUCKET=fuzefront-backups \
  --dry-run=client -o yaml | kubeseal -o yaml > deploy/contabo/sealed/backup-s3.yaml
```
Commit the `deploy/contabo/sealed/*.yaml` (encrypted — safe in git) and add a
SealedSecret Argo Application (or apply them directly). Plaintext never leaves
your laptop.

> Note: the FuzeInfra chart-created `Secret` currently supplies Postgres creds.
> Either set `credentials.existingSecret: fuzeinfra-secrets` in the fuzeinfra
> Argo values to use your sealed secret, or seal to match the chart's keys.

## 4. Hand the cluster to GitOps
```bash
kubectl apply -f deploy/argocd/project.yaml
kubectl apply -f deploy/argocd/app-of-apps.yaml
kubectl apply -f deploy/backup/postgres-backup-cronjob.yaml   # once secrets exist
```
Argo creates the `fuzeinfra` (Postgres + Redis + monitoring) and `fuzefront`
Applications and syncs them. cert-manager issues TLS for `app.fuzefront.com`.

## 5. Verify
```bash
kubectl -n fuzefront get pods,ingress
curl -fsS https://app.fuzefront.com/api/health
# Argo UI: https://argocd.fuzefront.com  (initial admin pw:)
kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d
```

## Day-2
- **Releases:** merge to `master` → `release.yml` builds + pushes images to GHCR
  and bumps the tag in `values-prod.yaml`; Argo rolls it out automatically.
- **Data safety:** the `fuzeinfra` Application has `prune: false` so a sync never
  deletes Postgres/Redis PVCs; nightly `pg_dump` ships to Contabo storage.
- **AWS path** (`deploy.yml`) is left intact and switchable.
