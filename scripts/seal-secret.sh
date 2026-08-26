#!/usr/bin/env bash
#
# seal-secret.sh — FuzeInfra canonical Sealed Secrets sealing tool.
#
# Seal Kubernetes secrets OFFLINE against FuzeInfra's published PUBLIC cert and
# commit only the encrypted result. You need ZERO cluster access: sealing uses
# the public key (encrypt-only); only the in-cluster controller holds the private
# key and can decrypt. See docs/SECRETS_MANAGEMENT.md for the methodology.
#
# Requirements: bash, kubeseal, curl (for cert fetch), and one of openssl/base64.
# kubectl is NOT required.
#
# ── Usage ────────────────────────────────────────────────────────────────────
#   seal-secret.sh <ns/name> KEY=VALUE [KEY=VALUE ...]   # seal literals
#   seal-secret.sh <ns/name> KEY=@file [...]             # value from a file
#   seal-secret.sh <ns/name> --env-file .env             # all KEY=VALUE lines
#   seal-secret.sh --raw <ns/name> KEY=VALUE             # print one encrypted blob
#
# <ns/name>  Explicit scope: the namespace and Secret name the SealedSecret will
#            decrypt into (strict scope — it ONLY decrypts under that ns + name).
#            Example: fuzefront/billing-secrets
#
# ── Options ──────────────────────────────────────────────────────────────────
#   --out <file>    Output manifest path (default: ./<name>-sealed.yaml).
#                   If it already exists, new keys are MERGED in (kubeseal
#                   --merge-into) — existing keys are preserved/updated in place.
#   --in <file>     Read the Secret to seal from a manifest file instead of
#                   KEY=VALUE args (still sealed offline against the cert).
#   --cert <ref>    Override the public cert: a URL or a local file path.
#                   Default: $FUZEINFRA_SEALED_CERT_URL or the published URL.
#   --raw           Print a single encrypted value (kubeseal --raw) to stdout for
#                   manual templating; requires exactly one KEY=VALUE. No manifest
#                   is written.
#   --env-file <f>  Load KEY=VALUE pairs from a dotenv-style file.
#   -h, --help      Show this help.
#
# This script NEVER prints plaintext secret values. Prefer KEY=@file / --env-file
# over KEY=VALUE on the command line, since argv is visible to other processes.
#
set -euo pipefail

# Default published public cert — single source of truth, always current, so it
# transparently handles controller key rotation. Override with --cert / env var.
DEFAULT_CERT_URL="https://sealed-secrets.prod.fuzefront.com/v1/cert.pem"
CERT_REF="${FUZEINFRA_SEALED_CERT_URL:-$DEFAULT_CERT_URL}"
# Offline fallback: the controller's PUBLIC cert, committed to the repo. Safe to
# publish — it encrypts only; solely the in-cluster controller holds the private
# key. Refresh it after a controller key rotation (see the die() message below).
REPO_CERT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/deploy/sealed-secrets/sealing-cert.pem"

die()  { echo "error: $*" >&2; exit 1; }
note() { echo "$*" >&2; }   # progress goes to stderr; never plaintext

usage() { sed -n '2,48p' "$0" | sed 's/^# \{0,1\}//'; }

command -v kubeseal >/dev/null 2>&1 || die "kubeseal not found — install from https://github.com/bitnami-labs/sealed-secrets/releases"

b64() { if command -v base64 >/dev/null 2>&1; then base64 | tr -d '\n'; else openssl base64 -A; fi; }

# ── Parse args ───────────────────────────────────────────────────────────────
RAW=0
OUT=""
IN=""
SCOPE=""
ENV_FILE=""
declare -a PAIRS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --raw)      RAW=1; shift ;;
    --out)      OUT="${2:?--out needs a path}"; shift 2 ;;
    --in)       IN="${2:?--in needs a path}"; shift 2 ;;
    --cert)     CERT_REF="${2:?--cert needs a url or path}"; shift 2 ;;
    --env-file) ENV_FILE="${2:?--env-file needs a path}"; shift 2 ;;
    --) shift; while [[ $# -gt 0 ]]; do PAIRS+=("$1"); shift; done ;;
    -*) die "unknown option: $1 (try --help)" ;;
    # A KEY=VALUE pair is recognized first — its value may itself contain '/'
    # (e.g. a URL), so it must not be mistaken for the ns/name scope.
    *=*) PAIRS+=("$1"); shift ;;
    */*) if [[ -z "$SCOPE" ]]; then SCOPE="$1"; else PAIRS+=("$1"); fi; shift ;;
    *)  PAIRS+=("$1"); shift ;;
  esac
done

[[ -n "$SCOPE" ]] || die "missing <ns/name> scope (e.g. fuzefront/billing-secrets)"
[[ "$SCOPE" == */* ]] || die "scope must be ns/name, got '$SCOPE'"
NS="${SCOPE%%/*}"
NAME="${SCOPE##*/}"
[[ -n "$NS" && -n "$NAME" && "$NAME" != *"/"* ]] || die "scope must be ns/name, got '$SCOPE'"

# ── Resolve the public cert to a local file ──────────────────────────────────
CERT_FILE=""
cleanup() { [[ -n "${CERT_FILE:-}" && "${CERT_TMP:-0}" == 1 ]] && rm -f "$CERT_FILE" || true; }
trap cleanup EXIT
CERT_TMP=0
if [[ "$CERT_REF" == http://* || "$CERT_REF" == https://* ]]; then
  command -v curl >/dev/null 2>&1 || die "curl needed to fetch the cert URL"
  CERT_FILE="$(mktemp)"; CERT_TMP=1
  note "fetching public cert: $CERT_REF"
  # The published URL sits behind Cloudflare Access, which answers unauthenticated
  # requests with an HTML login page (HTTP 200), not a PEM. Treat "fetched, but not
  # a certificate" as a soft failure and fall back to the cert committed in this
  # repo, so sealing keeps working with ZERO cluster access — the whole point of
  # this script. Only fail hard if there is no usable cert anywhere.
  if ! curl -fsSL "$CERT_REF" -o "$CERT_FILE" 2>/dev/null || ! grep -q "BEGIN CERTIFICATE" "$CERT_FILE"; then
    if [[ -f "$REPO_CERT" ]]; then
      note "cert URL unusable (Cloudflare Access login page or unreachable) — falling back to $REPO_CERT"
      cp "$REPO_CERT" "$CERT_FILE"
    else
      die "could not obtain a PEM cert: $CERT_REF returned no certificate and $REPO_CERT is missing.
  Fix one of:
    * pass --cert <file|url> explicitly, or
    * refresh the committed cert:
        kubeseal --controller-namespace kube-system \
                 --controller-name sealed-secrets-controller --fetch-cert \
          > deploy/sealed-secrets/sealing-cert.pem"
    fi
  fi
else
  [[ -f "$CERT_REF" ]] || die "cert file not found: $CERT_REF"
  CERT_FILE="$CERT_REF"
fi

# ── --raw: encrypt a single value, print only the ciphertext ─────────────────
if [[ "$RAW" == 1 ]]; then
  [[ ${#PAIRS[@]} -eq 1 ]] || die "--raw needs exactly one KEY=VALUE"
  kv="${PAIRS[0]}"; key="${kv%%=*}"; val="${kv#*=}"
  [[ "$kv" == *=* && -n "$key" ]] || die "expected KEY=VALUE, got '$kv'"
  if [[ "$val" == @* ]]; then
    printf '%s' "$(cat "${val#@}")" | kubeseal --raw --scope strict --namespace "$NS" --name "$NAME" --cert "$CERT_FILE" --from-file=/dev/stdin
  else
    printf '%s' "$val" | kubeseal --raw --scope strict --namespace "$NS" --name "$NAME" --cert "$CERT_FILE" --from-file=/dev/stdin
  fi
  echo
  exit 0
fi

# ── Gather KEY=VALUE pairs from --env-file then args ─────────────────────────
if [[ -n "$ENV_FILE" ]]; then
  [[ -f "$ENV_FILE" ]] || die "env file not found: $ENV_FILE"
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ -z "$line" || "$line" == \#* ]] && continue
    [[ "$line" == export\ * ]] && line="${line#export }"
    [[ "$line" == *=* ]] || continue
    PAIRS+=("$line")
  done < "$ENV_FILE"
fi

# ── Build the plaintext Secret YAML (in-memory; never written to disk) ────────
build_secret() {
  printf 'apiVersion: v1\nkind: Secret\nmetadata:\n  name: %s\n  namespace: %s\ntype: Opaque\ndata:\n' "$NAME" "$NS"
  local kv key val
  for kv in "${PAIRS[@]}"; do
    [[ "$kv" == *=* ]] || die "expected KEY=VALUE, got '$kv'"
    key="${kv%%=*}"; val="${kv#*=}"
    [[ -n "$key" ]] || die "empty key in '$kv'"
    if [[ "$val" == @* ]]; then
      printf '  %s: %s\n' "$key" "$(b64 < "${val#@}")"
    else
      printf '  %s: %s\n' "$key" "$(printf '%s' "$val" | b64)"
    fi
  done
}

if [[ -n "$IN" ]]; then
  [[ -f "$IN" ]] || die "input manifest not found: $IN"
  SECRET_YAML="$(cat "$IN")"
else
  [[ ${#PAIRS[@]} -gt 0 ]] || die "no KEY=VALUE pairs given (or use --in / --env-file)"
  SECRET_YAML="$(build_secret)"
fi

# ── Seal: create new manifest, or merge into an existing one in place ─────────
OUT="${OUT:-./${NAME}-sealed.yaml}"
if [[ -f "$OUT" ]]; then
  note "merging into existing SealedSecret: $OUT"
  printf '%s' "$SECRET_YAML" | kubeseal --scope strict --format yaml --cert "$CERT_FILE" --merge-into "$OUT"
else
  note "writing new SealedSecret: $OUT"
  printf '%s' "$SECRET_YAML" | kubeseal --scope strict --format yaml --cert "$CERT_FILE" > "$OUT"
fi

note "sealed → $OUT  (commit this; it is safe — only the cluster controller can decrypt)"
