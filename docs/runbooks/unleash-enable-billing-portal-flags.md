# Runbook — Enable billing portal flags to GA (100%, production)

**Status: AUTHORED, NOT YET APPLIED.** The live Unleash admin API
(`unleash.prod.fuzefront.com`, CF-Access-gated; in-cluster
`fuzefront-unleash:4242`) is not reachable from a remote Claude session.
This file gives an operator with live Unleash admin access the exact
copy-paste commands to apply in one pass.

## Context

PR #1044 (`feat(billing): full billing portal — plan list,
upgrade/downgrade, cancel, buy credits`) merged to master on 2026-09-14
and triggered a GitOps deploy. After deploy:

- **Plans tab** (`/billing`) — plan grid + Stripe Checkout — **not
  flag-gated**, live for all users immediately.
- **Payments tab** (`/billing/payments`) — Stripe Billing Customer
  Portal — **not flag-gated**, live for all users immediately.
- **Invoices tab** (`/billing/invoices`) — paginated Stripe invoice list
  — gated by `fuzefront.billing.invoice-history` (default OFF in code).
  This tab is hidden until the flag is enabled in Unleash.

## Flags to enable

| Key | Type | In-code default | What it gates |
|---|---|---|---|
| `fuzefront.billing.invoice-history` | release | false | Invoices tab within the billing portal |

**Do NOT** globally enable these (they are per-org, controlled by the
billing sync when a customer subscribes):
- `fuzefront.billing.plan-professional`
- `fuzefront.billing.plan-scale`
- `fuzefront.billing.plan-enterprise`
- `fuzefront.billing.sso-enabled`
- `fuzefront.billing.api-access`
- `fuzefront.billing.custom-domain`
- `fuzefront.billing.module-federation`

`fuzefront.billing.plan-starter` already defaults `true` in code
(every org gets Starter features without any Unleash action).

## Steps

```bash
UNLEASH="https://unleash.prod.fuzefront.com"   # or: kubectl -n fuzefront port-forward svc/fuzefront-unleash 4242:4242 && UNLEASH="http://localhost:4242"
TOKEN="$INIT_ADMIN_API_TOKEN"                   # from unleash-secrets / INIT_ADMIN_API_TOKENS
PROJECT="default"
ENVIRONMENT="production"
FLAG="fuzefront.billing.invoice-history"

# 1. Create the flag if it does not exist (409 = already exists, that is fine)
curl -sS -o /tmp/create_resp.json -w '%{http_code}' -X POST \
  "$UNLEASH/api/admin/projects/$PROJECT/features" \
  -H "Authorization: $TOKEN" -H 'Content-Type: application/json' \
  -d '{
    "name": "'"$FLAG"'",
    "type": "release",
    "description": "Gates the Invoices tab in the billing portal. Owner: platform team. GA per billing portal deploy 2026-09-14. Removal: once invoice history is GA and enabled for 100% of orgs for >= 2 sprints."
  }' \
  | grep -qE '^(201|409)$' \
  && echo "create: ok" || { echo "create: FAILED"; cat /tmp/create_resp.json; }

# 2. Enable the production environment
curl -sfX POST \
  "$UNLEASH/api/admin/projects/$PROJECT/features/$FLAG/environments/$ENVIRONMENT/on" \
  -H "Authorization: $TOKEN" \
  && echo "environment on: ok"

# 3. Add 100% flexibleRollout strategy (no segment)
#    NOTE: if the flag already has a flexibleRollout strategy from a prior
#    partial rollout, PATCH that strategy's rollout to "100" instead of POSTing
#    a new one (a fresh POST adds a duplicate strategy).
curl -sfX POST \
  "$UNLEASH/api/admin/projects/$PROJECT/features/$FLAG/environments/$ENVIRONMENT/strategies" \
  -H "Authorization: $TOKEN" -H 'Content-Type: application/json' \
  -d '{
    "name": "flexibleRollout",
    "parameters": { "rollout": "100", "stickiness": "default", "groupId": "'"$FLAG"'" }
  }' \
  && echo "100% strategy added: ok"
```

## Verification

```bash
# Using a temporary frontend-type Unleash token (revoke immediately after)
FRONTEND_TOKEN="<temporary frontend-type Unleash token>"
curl -sf "$UNLEASH/api/frontend" \
  -H "Authorization: $FRONTEND_TOKEN" \
  | python3 -c "
import sys, json
data = json.load(sys.stdin)
for t in data.get('toggles', []):
    if t['name'] == 'fuzefront.billing.invoice-history':
        print('enabled:', t['enabled'])
"
# Expected: enabled: True
```

Alternatively, via the backend's `GET /api/flags` (once the flag is ON in
Unleash, the backend proxies the evaluation):
```bash
# While authenticated as any user on the app
curl -s https://app.fuzefront.com/api/flags | jq '."fuzefront.billing.invoice-history"'
# Expected: true
```

## Rollback

```bash
curl -sfX POST \
  "$UNLEASH/api/admin/projects/$PROJECT/features/$FLAG/environments/$ENVIRONMENT/off" \
  -H "Authorization: $TOKEN" \
  && echo "flag disabled"
```

## Related runbooks

- `docs/runbooks/unleash-enable-ff-epic-17-flags.md` — FF-EPIC-17 identity
  flags (root-membership, personal-context, member-directory,
  employee-console) — those are also authored but not yet applied.
- `docs/runbooks/unleash-launcher-and-developer-flags.md` — general
  Unleash access patterns and token handling.
