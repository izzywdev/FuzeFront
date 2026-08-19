#!/usr/bin/env bash
# Generate a NEW release keystore for the Shopify Navigator APK.
# Only needed if you rotate the signing key — the current fingerprint is
# already baked into ../.well-known/assetlinks.json and twa-manifest.json.
#
# After rotating you MUST update, in lockstep:
#   1. shopify-nav/.well-known/assetlinks.json   (sha256_cert_fingerprints)
#   2. shopify-nav/android/twa-manifest.json     (fingerprints[0].value)
#   3. GitHub secrets: SHOPIFY_NAV_KEYSTORE_B64,
#      SHOPIFY_NAV_KEYSTORE_STORE_PASSWORD, SHOPIFY_NAV_KEYSTORE_KEY_PASSWORD
set -euo pipefail

# Always write into this script's directory (shopify-nav/android/), which is
# gitignored — running from the repo root would otherwise drop an UN-ignored
# keystore into the CWD.
cd "$(dirname "$0")"
mkdir -p keystore
OUT=keystore/shopify-nav-release.keystore
ALIAS=shopifynav

read -rsp "New keystore password: " PW; echo

keytool -genkeypair -v \
  -keystore "$OUT" \
  -alias "$ALIAS" \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass "$PW" -keypass "$PW" \
  -dname "CN=Shopify Navigator, OU=Apps, O=FuzeFront, C=IL"

echo ""
echo "== SHA-256 fingerprint (for assetlinks.json + twa-manifest.json) =="
keytool -list -v -keystore "$OUT" -alias "$ALIAS" -storepass "$PW" | grep "SHA256:"

echo ""
echo "== Base64 for the SHOPIFY_NAV_KEYSTORE_B64 GitHub secret =="
base64 -w0 "$OUT"
echo ""
echo ""
echo "NEVER commit $OUT — it is gitignored."
