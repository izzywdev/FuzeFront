#!/usr/bin/env bash
# =============================================================================
# Bootstrap a single Contabo VPS (Ubuntu 22.04) into a FuzeFront-ready cluster:
# k3s (no Traefik) + ingress-nginx + cert-manager + sealed-secrets + Argo CD.
# Run ON the VPS as root.  Idempotent enough to re-run.
#
# After this, seal your secrets and apply the Argo app-of-apps (see README.md).
# =============================================================================
set -euo pipefail

INGRESS_NGINX_VER="controller-v1.11.2"
CERT_MANAGER_VER="v1.15.3"
SEALED_SECRETS_VER="v0.27.1"

echo "==> Installing k3s (Traefik disabled; we use ingress-nginx)"
# k3s ships ServiceLB (klipper), so a LoadBalancer Service binds the node IP —
# ingress-nginx becomes reachable on the VPS public IP at :80/:443.
curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="--disable traefik" sh -
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
kubectl get nodes

echo "==> ingress-nginx"
kubectl apply -f "https://raw.githubusercontent.com/kubernetes/ingress-nginx/${INGRESS_NGINX_VER}/deploy/static/provider/cloud/deploy.yaml"
kubectl -n ingress-nginx rollout status deploy/ingress-nginx-controller --timeout=180s

echo "==> cert-manager"
kubectl apply -f "https://github.com/cert-manager/cert-manager/releases/download/${CERT_MANAGER_VER}/cert-manager.yaml"
kubectl -n cert-manager rollout status deploy/cert-manager-webhook --timeout=180s
# Edit the email in cluster-issuer.yaml first.
kubectl apply -f "$(dirname "$0")/cluster-issuer.yaml"

echo "==> sealed-secrets controller"
kubectl apply -f "https://github.com/bitnami-labs/sealed-secrets/releases/download/${SEALED_SECRETS_VER}/controller.yaml"

echo "==> Argo CD"
kubectl create namespace argocd --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml
kubectl -n argocd rollout status deploy/argocd-server --timeout=300s

cat <<'EOF'

==> Bootstrap complete. Next (see deploy/contabo/README.md):
  1. Seal secrets: ghcr-pull, fuzefront-secrets, fuzeinfra-secrets, backup-s3
     (kubeseal), then commit the SealedSecret manifests.
  2. kubectl apply -f deploy/argocd/project.yaml
     kubectl apply -f deploy/argocd/app-of-apps.yaml
  3. Argo syncs fuzeinfra + fuzefront; cert-manager issues TLS for app.fuzefront.com.
EOF
