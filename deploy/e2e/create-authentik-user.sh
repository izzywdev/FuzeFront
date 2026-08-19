#!/usr/bin/env bash
# Create the E2E test user IN AUTHENTIK (the credential store).
#
# This is the ONLY place an e2e password is created. FuzeFront stores no
# passwords: there is deliberately no `password_hash` anywhere in the e2e setup.
# The previous .github/workflows/e2e.yml seeded a bcrypt row straight into
# `users.password_hash`, which the Security API will never accept as a
# credential — it brokers sign-in through Authentik. That seed was a bug, not a
# pattern to preserve.
#
# Idempotent: an existing username is adopted rather than treated as an error.
#
# Env:
#   E2E_USER_EMAIL, E2E_USER_PASSWORD, E2E_USER_USERNAME
set -euo pipefail

: "${E2E_USER_EMAIL:?E2E_USER_EMAIL is required}"
: "${E2E_USER_PASSWORD:?E2E_USER_PASSWORD is required}"
USERNAME="${E2E_USER_USERNAME:-e2e-test}"

API="http://authentik-server:9000/api/v3/core/users"
AUTH="Authorization: Bearer e2e-bootstrap-token"

# Retry: the server activates the bootstrap token during startup and it is
# occasionally not live the instant OIDC discovery comes up.
USER_PK=""
for attempt in $(seq 1 10); do
  RESPONSE=$(curl -s -X POST "$API/" \
    -H "$AUTH" -H "Content-Type: application/json" \
    -d "$(jq -n --arg u "$USERNAME" --arg e "$E2E_USER_EMAIL" \
      '{username:$u,name:"E2E Test User",email:$e,is_active:true,type:"internal"}')")
  echo "Create user attempt $attempt: $RESPONSE"
  USER_PK=$(echo "$RESPONSE" | jq -r '.pk // empty')
  if [ -n "$USER_PK" ] && [ "$USER_PK" != "null" ]; then
    break
  fi
  if echo "$RESPONSE" | jq -e '.username[]?' 2>/dev/null | grep -q "already exists"; then
    echo "User already exists — fetching pk"
    USER_PK=$(curl -s "$API/?search=${USERNAME}" -H "$AUTH" | jq -r '.results[0].pk // empty')
    break
  fi
  if [ "$attempt" -eq 10 ]; then
    echo "::error::Failed to create the Authentik e2e user after 10 attempts"
    exit 1
  fi
  echo "Retrying in 10s..."
  sleep 10
done

if [ -z "$USER_PK" ] || [ "$USER_PK" = "null" ]; then
  echo "::error::Could not obtain Authentik user pk"
  exit 1
fi

SET_PW=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$API/${USER_PK}/set_password/" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d "$(jq -n --arg p "$E2E_USER_PASSWORD" '{password:$p}')")
echo "Set password HTTP status: $SET_PW"
if [ "$SET_PW" != "204" ]; then
  echo "::error::Failed to set the e2e user password (expected 204, got $SET_PW)"
  exit 1
fi

echo "E2E test user ready in Authentik (pk=${USER_PK}, email=${E2E_USER_EMAIL})"
