#!/usr/bin/env bash
#
# check-sealed-key-regression.sh — fail if any committed SealedSecret DROPS an
# encryptedData key that exists on the base ref.
#
# WHY THIS EXISTS (issue #500): on 2026-07-28 commit 50b01ab re-sealed
# fuzefront-secrets FROM SCRATCH (`kubeseal -o json` on a fresh `kubectl create
# secret`) instead of `seal-secret.sh --merge-into`, silently dropping 5 keys —
# SMTP_USER/SMTP_PASS (→ email-service wedged in CreateContainerConfigError, #500),
# plus TURNSTILE_SECRET_KEY, TURNSTILE_SITE_KEY, MENDYS_DATASETS_CLIENT_SECRET.
# The chart's helm guards check `smtp.host`, never the SealedSecret's key SET, so
# nothing caught it until the pod wedged in prod. This gate is that missing check.
#
# It compares the encryptedData key SET (names only — never values) of each
# deploy/contabo/sealed/*.yaml against the base ref, and fails on any key that
# disappeared. Intentional removals: set ALLOW_SEALED_KEY_REMOVAL=1 (CI wires this
# to the `allow-secret-key-removal` PR label).
#
# Usage: check-sealed-key-regression.sh [BASE_REF]   (default: origin/master)
set -euo pipefail

BASE="${1:-origin/master}"
DIR="deploy/contabo/sealed"

# Extract the UPPER_SNAKE encryptedData key names from a SealedSecret on stdin.
# Works for BOTH the YAML form (`    SMTP_USER: Ag...`) and the JSON form that a
# from-scratch `kubeseal -o json` produces (`"SMTP_USER": "Ag..."`). SealedSecret
# scaffolding (apiVersion/kind/metadata/template/annotations/type) is all
# lowercase, and base64 ciphertext contains no `:` or `"`, so an all-caps
# key-before-colon match isolates exactly the secret keys.
extract_keys() {
  grep -oE '(^[[:space:]]+[A-Z0-9_]+[[:space:]]*:|"[A-Z0-9_]+"[[:space:]]*:)' \
    | grep -oE '[A-Z0-9_]+' | sort -u
}

fail=0
shopt -s nullglob
for f in "$DIR"/*.yaml; do
  if ! git cat-file -e "$BASE:$f" 2>/dev/null; then
    echo "· $f: new on this branch (no base version) — skipping"
    continue
  fi
  base_keys=$(git show "$BASE:$f" | extract_keys || true)
  head_keys=$(extract_keys < "$f" || true)
  dropped=$(comm -23 <(printf '%s\n' "$base_keys") <(printf '%s\n' "$head_keys") | grep -v '^$' || true)
  if [ -n "$dropped" ]; then
    echo "::error file=$f::SealedSecret key regression — $f drops key(s) present on $BASE: $(echo $dropped | tr '\n' ' ')"
    fail=1
  else
    echo "· $f: OK ($(printf '%s\n' "$head_keys" | grep -c . ) keys, none dropped)"
  fi
done

if [ "$fail" = 1 ]; then
  if [ "${ALLOW_SEALED_KEY_REMOVAL:-0}" = 1 ]; then
    echo "::warning::Key regression detected, but ALLOW_SEALED_KEY_REMOVAL=1 (the 'allow-secret-key-removal' label is set) — passing."
    exit 0
  fi
  echo ""
  echo "A previously-sealed key disappeared from a SealedSecret."
  echo "  • If UNINTENTIONAL (the usual case): you re-sealed from scratch and dropped keys."
  echo "    Re-add each with:  deploy/scripts/seal-secret.sh <KEY> --scope <ns>/<name> \\"
  echo "                         --manifest <file>   (ALWAYS --merge-into; NEVER 'kubeseal -o json' from scratch)."
  echo "  • If INTENTIONAL (rotating a key out): add the 'allow-secret-key-removal' label to this PR."
  exit 1
fi

echo "All SealedSecrets retain their base-ref keys. No regression."
