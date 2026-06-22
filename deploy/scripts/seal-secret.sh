#!/usr/bin/env bash
#
# seal-secret.sh — seal ONE secret value into this repo's SealedSecret, offline,
# credential-free. No kubeconfig, no cluster access: FuzeInfra holds the private
# (decrypt) key; we only need the cluster's PUBLIC cert, which FuzeInfra publishes
# at a stable URL. We fetch the CURRENT public cert at seal time (so sealed-secrets
# key rotation just works), seal with kubeseal, and merge the result into the
# SealedSecret manifest IN PLACE — preserving every other key.
#
# Usage:
#   deploy/scripts/seal-secret.sh STRIPE_SECRET_KEY            # hidden prompt, paste value
#   deploy/scripts/seal-secret.sh BILLING_INTERNAL_TOKEN --in ~/.fuzefront-secrets/billing-internal-token.txt
#   deploy/scripts/seal-secret.sh STRIPE_SECRET_KEY --cert ./pub.pem      # offline: use a local cert
#   deploy/scripts/seal-secret.sh SOME_KEY --scope other-ns/other-secret  # override the hard-coded scope
#
# Then: git add the manifest, commit, push. Argo (FuzeInfra-operated) syncs it and
# the in-cluster controller decrypts it into a real Secret. Plaintext NEVER touches
# git, chat, or shell history.
# NOTE: this is an INTERIM, vendored copy. The CANONICAL seal-secret.sh + the
# secrets-management methodology + the published public-cert URL are owned by
# FuzeInfra (it runs the controller and holds the decrypt key). Tracked for
# migration to the fuzeone onboarding toolkit. Until then this copy unblocks
# FuzeFront sealing.
set -euo pipefail

# ---- per-repo defaults (this is the FuzeFront repo) ----------------------------
NS="fuzefront"
NAME="billing-secrets"
# FuzeInfra publishes the sealed-secrets public cert here (single source of truth,
# always current). Override via env if the URL differs.
CERT_URL="${FUZEINFRA_SEALED_CERT_URL:-https://sealed-secrets.fuzeinfra.fuzefront.com/v1/cert.pem}"

CERT_OVERRIDE=""; INFILE=""; KEY=""; MANIFEST=""
while [ $# -gt 0 ]; do
  case "$1" in
    --scope)    NS="${2%%/*}"; NAME="${2##*/}"; shift 2 ;;
    --cert)     CERT_OVERRIDE="$2"; shift 2 ;;
    --in)       INFILE="$2"; shift 2 ;;
    --manifest) MANIFEST="$2"; shift 2 ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "unknown flag: $1" >&2; exit 2 ;;
    *)  KEY="$1"; shift ;;
  esac
done
[ -n "$KEY" ] || { echo "usage: seal-secret.sh <DATA_KEY> [--in FILE] [--scope ns/name] [--cert PUBCERT] [--manifest PATH]" >&2; exit 2; }
MANIFEST="${MANIFEST:-deploy/contabo/sealed/${NAME}.yaml}"

command -v kubeseal >/dev/null || { echo "kubeseal not found (scoop install kubeseal / brew install kubeseal)" >&2; exit 1; }
command -v kubectl  >/dev/null || { echo "kubectl not found" >&2; exit 1; }

CERT="$(mktemp)"; VAL="$(mktemp)"; chmod 600 "$VAL"
trap 'rm -f "$CERT" "$VAL"' EXIT

# ---- get the public cert (fetch current, or use the offline override) ----------
if [ -n "$CERT_OVERRIDE" ]; then
  cp "$CERT_OVERRIDE" "$CERT"
else
  curl -fsSL "$CERT_URL" -o "$CERT" \
    || { echo "Could not fetch public cert from $CERT_URL — pass --cert <pub.pem> for offline use." >&2; exit 1; }
fi

# ---- get the value (hidden prompt, or from a file) -----------------------------
if [ -n "$INFILE" ]; then
  tr -d '\r\n' < "$INFILE" > "$VAL"
else
  printf 'Paste value for %s (hidden, will not echo): ' "$KEY" >&2
  read -rs _V; echo >&2
  printf '%s' "$_V" > "$VAL"; unset _V
fi
[ -s "$VAL" ] || { echo "empty value — aborting" >&2; exit 1; }

# ---- seal + merge into the manifest in place (preserves other keys) ------------
mkdir -p "$(dirname "$MANIFEST")"
mkseal() { kubectl create secret generic "$NAME" -n "$NS" --from-file="$KEY=$VAL" --dry-run=client -o yaml | kubeseal --cert "$CERT" -o yaml; }
if [ -f "$MANIFEST" ]; then
  kubectl create secret generic "$NAME" -n "$NS" --from-file="$KEY=$VAL" --dry-run=client -o yaml \
    | kubeseal --cert "$CERT" --merge-into "$MANIFEST"
else
  mkseal > "$MANIFEST"
fi

echo "✓ sealed '$KEY' into $MANIFEST  (namespace=$NS, name=$NAME)" >&2
echo "  next: git add $MANIFEST && git commit && git push  → Argo decrypts in-cluster" >&2
