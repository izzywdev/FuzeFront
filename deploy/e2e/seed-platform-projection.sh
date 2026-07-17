#!/usr/bin/env bash
# Seed the platform PROJECTION of the Authentik user: a `users` row plus a
# personal org + owner membership. NO CREDENTIAL IS SEEDED HERE — the password
# lives in Authentik (see create-authentik-user.sh). This row holds identity
# projection only, deliberately with no password_hash column touched.
#
# Why it is needed: the authenticated shell sits behind WorkspaceProvisioningGate
# (frontend/src/components/WorkspaceProvisioningGate.tsx), which renders the app
# layout only once the user has a personal org. A real login provisions that org
# asynchronously (fire-and-forget self-heal), but in CI Permit is a no-op and
# Kafka is absent, so that path cannot be relied on — the gate would spin and the
# sign-in spec would fail for reasons unrelated to auth.
#
# Seeding by EMAIL is what makes this work: syncUserToDatabase matches on email
# and generates its own uuid, so the row inserted here is ADOPTED by the login
# rather than duplicated.
#
# Env:
#   E2E_USER_EMAIL
set -euo pipefail

: "${E2E_USER_EMAIL:?E2E_USER_EMAIL is required}"
COMPOSE="docker compose -f docker-compose.e2e.yml"

# Plain idempotent SQL rather than a DO block: psql does NOT interpolate :vars
# inside dollar-quoted strings, so `DO $$ ... :'email' ... $$` would silently
# never substitute the email. Guarded INSERT...SELECT gives the same idempotency
# with working interpolation.
$COMPOSE exec -T postgres \
  psql -v ON_ERROR_STOP=1 -v email="$E2E_USER_EMAIL" -U e2e -d fuzefront_platform <<'SQL'
-- 1. identity projection (no credential: the password lives in Authentik)
INSERT INTO users (id, email, first_name, last_name, roles, created_at, updated_at)
SELECT gen_random_uuid(), :'email', 'E2E', 'Test', '["user"]'::jsonb, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM users WHERE email = :'email');

-- 2. personal org owned by that user
WITH u AS (SELECT id FROM users WHERE email = :'email')
INSERT INTO organizations (id, name, slug, parent_id, owner_id, type,
                           settings, metadata, is_active, provisioning_state)
SELECT gen_random_uuid(), 'Personal', 'personal-' || u.id, NULL, u.id, 'personal',
       '{}'::jsonb, '{"personal": true}'::jsonb, true, 'active'
FROM u
WHERE NOT EXISTS (
  SELECT 1 FROM organizations o WHERE o.owner_id = u.id AND o.type = 'personal'
);

-- 3. active owner membership linking the two
WITH u AS (SELECT id FROM users WHERE email = :'email'),
     o AS (SELECT org.id FROM organizations org, u
            WHERE org.owner_id = u.id AND org.type = 'personal')
INSERT INTO organization_memberships (id, user_id, organization_id, role, status,
                                      joined_at, permissions, metadata)
SELECT gen_random_uuid(), u.id, o.id, 'owner', 'active', now(), '{}'::jsonb, '{}'::jsonb
FROM u, o
WHERE NOT EXISTS (
  SELECT 1 FROM organization_memberships m
   WHERE m.user_id = u.id AND m.organization_id = o.id
);
SQL
echo "seeded platform projection for ${E2E_USER_EMAIL}"

# Fail loudly here rather than let the sign-in spec fail opaquely at the
# provisioning gate — a missing org looks identical to broken auth.
$COMPOSE exec -T postgres \
  psql -tA -U e2e -d fuzefront_platform -v email="$E2E_USER_EMAIL" \
  -c "SELECT o.type, o.provisioning_state, m.role, m.status
        FROM users u
        JOIN organizations o ON o.owner_id = u.id AND o.type='personal'
        JOIN organization_memberships m ON m.organization_id = o.id AND m.user_id = u.id
       WHERE u.email = :'email';" | tee /tmp/seed.out

grep -q 'personal|active|owner|active' /tmp/seed.out \
  || { echo "::error::personal org/membership not seeded — the sign-in spec would hang on WorkspaceProvisioningGate"; exit 1; }
