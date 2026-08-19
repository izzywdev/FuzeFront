# Runbook — Enable ALL FOUR FF-EPIC-17 flags to GA (100%, production)

**Status of this document: AUTHORED, NOT YET APPLIED.** The live Unleash
admin API (`unleash.prod.fuzefront.com`, Cloudflare-Access-gated; in-cluster
`fuzefront-unleash:4242`) is **not reachable from this session** — no
`kubectl`, no cluster network route, and the CF-Access host correctly 403s
without an authenticated session. This file is the exact, copy-paste-ready
administration for an operator with live Unleash admin access to apply in
**one pass**. It reuses the executable access pattern from
`docs/runbooks/unleash-launcher-and-developer-flags.md` ("Executable
version") and the per-flag runbook
`docs/runbooks/unleash-flag-fuzefront-identity-root-membership.md`.

## Owner decision this runbook implements

The owner has decided to turn all four FF-EPIC-17 identity flags **fully
ON** in production now, rather than the staged
`developers`-segment → percentage-ramp rollout each flag's own creation
plan describes. **This is a deliberate skip of the staged ramp** — see
"Supersession" below. Target end state for each flag:

> **GA = `flexibleRollout` strategy, `rollout: 100`, NO segment**, production
> environment enabled.

This is a plain 100% rollout (matching the `ops-kill-switch` strategy shape
in the `feature-flags` skill, even though these are `release`-type flags) —
once a release flag is at 100% for everyone, a `developers`-segment overlay
strategy is redundant, so it is deliberately **not** added on top.

## The four flags

| # | Key | Type | In-code default (unchanged) | PR(s) | Story |
|---|---|---|---|---|---|
| 1 | `fuzefront.identity.root-membership` | release | OFF | #615 | S1/S2 |
| 2 | `fuzefront.identity.personal-context` | release | OFF | #656 | S4 |
| 3 | `fuzefront.identity.member-directory` | release | OFF | #671 (API) / #672 (UI) | S5 |
| 4 | `fuzefront.identity.employee-console` | release | OFF | #655 (role) / #673 (console UI) | S8/S9 |

All four are recorded in `packages/feature-flags/flag-registry.yaml` (owner,
default, removal criterion, gates). **No in-code default changes** — every
flag's fail-safe value (used when Unleash is unreachable) stays `false`, per
the taxonomy's non-negotiable release-flag rule. Only the Unleash-side
toggle moves.

## Order / coupling — read before applying

Apply in this order. Only flag 1 has a **data-path behavior change**; the
other three are UI/endpoint visibility gates with no state-mutation
difference.

1. **`fuzefront.identity.root-membership` FIRST.** This is the only flag of
   the four that changes what a request *does*: with it ON, `signup` and the
   auth self-heal path upsert a root `organization_memberships(role='member')`
   row instead of creating a `type='personal'` org
   (`backend/security/src/services/organizationProvisioning.ts`,
   `backend/src/services/organizationProvisioning.ts`). Migration 022
   (`backend/src/migrations/022_root_membership_backfill_and_personal_org_reclassify.ts`)
   and its security-service mirror, migration 015, have already run — this
   runbook assumes that DoD is met, per the per-flag runbook. Turning this ON
   changes future signups' data shape; turning it OFF later does not undo
   rows already written (release flags gate the write path going forward,
   they are not a data toggle).
2. **`fuzefront.identity.personal-context`** next — the context-switcher UI
   reads whichever `user_role` the org list actually returns, so it is safe
   to enable once root-membership is live (root now resolves `MEMBER`
   instead of `GUEST`), but it degrades gracefully even if applied first
   (it just keeps showing the pre-epic role until root-membership catches
   up). No hard ordering dependency, but do it second to match the shipped
   UX (the switcher tree is boring/wrong without root membership under it).
3. **`fuzefront.identity.member-directory`** — purely additive endpoint + UI
   (the endpoint didn't exist before this story; flag OFF was a 404, not a
   modified response). No ordering dependency on the other three, but the
   directory is materially more useful once root-membership is populated
   (everyone shows up as a root member).
4. **`fuzefront.identity.employee-console`** — widens the root org-admin
   grant trigger and surfaces the `/staff` console. Independent of the other
   three; the legacy implicit `roles ~ admin` trigger is unaffected and
   always active regardless of this flag's state.

None of the four are mutually blocking — you may enable them in a single
pass in the order above without waiting between steps, since (unlike the
per-flag runbook's staged ramp) there is no soak period in this owner-directed
GA push.

## PRE-FLIGHT BLOCKER — 3 of 4 flags are not yet in the browser-exposed catalog

**Discovered while preparing this runbook (verification-before-completion):**
the browser reads flags through `GET /api/flags`
(`backend/src/routes/flags.ts`), which only returns keys listed in
`packages/feature-flags/src/catalog.ts`'s `WEB_EXPOSED_FLAGS`. The frontend's
`useFlag()` hook (`frontend/src/platform/featureFlags.tsx:97-101`) returns the
caller's hardcoded default whenever the key is **not present** in that
response — `key in flags ? flags[key] : defaultValue` — so an unlisted key
behaves as permanently OFF in the browser **no matter what Unleash says**.

Checked `packages/feature-flags/src/catalog.ts` as of this writing:
`WEB_EXPOSED_FLAGS` contains `ACCOUNT_SECURITY_HUB`, `BILLING_INVOICE_HISTORY`,
`SELECTION_LISTS_SERVICE`, `PORTALS_DIRECTORY` — **none of the three
frontend-visible FF-EPIC-17 flags** (`personal-context`, `member-directory`,
`employee-console`) are in it, even though `flag-registry.yaml` already
records all three as `web_exposed: true` and the frontend already calls
`useFlag('fuzefront.identity.personal-context', ...)` /
`useFlag('fuzefront.identity.member-directory', ...)` /
`useFlag('fuzefront.identity.employee-console', ...)` in
`frontend/src/components/UserMenu.tsx`, `frontend/src/App.tsx`,
`frontend/src/pages/OrganizationDetailPage.tsx`,
`frontend/src/components/SidePanel.tsx`, `frontend/src/pages/EmployeeConsolePage.tsx`.

**Practical effect:** applying this runbook's Unleash steps for
`personal-context`, `member-directory`, and `employee-console` will correctly
flip them ON in Unleash and in server-side evaluation, but the **frontend
UI for those three will stay dark** until
`packages/feature-flags/src/catalog.ts`'s `FLAG_KEYS` / `WEB_EXPOSED_FLAGS`
is updated to include them. That file is the `@fuzefront/feature-flags`
**client package build**, owned by `backend-engineer` — out of this agent's
scope to edit (flag administration only, per `CLAUDE.md`'s agent ownership
split). **`fuzefront.identity.root-membership` is unaffected** — it is
server-only (`web_exposed: false`) and its consumers call
`getClient().getBooleanValue(...)` directly, not through the catalog, so it
takes effect on the Unleash flip alone.

**Action for the operator:** file/confirm a `backend-engineer` task to add
the three keys to `WEB_EXPOSED_FLAGS` (and `FLAG_KEYS`) in
`packages/feature-flags/src/catalog.ts`, merge + deploy it, **before or
alongside** applying this runbook's Unleash steps for those three flags —
otherwise the Unleash toggle will be green but the UI will look unchanged,
which will read as "the flag isn't working" when it actually is (server-side
gates and API responses ARE correctly gated; only the three `useFlag()`
call sites are affected).

## Exact steps to apply (Unleash Admin API)

```bash
# Reach the admin API — either the CF-Access-gated prod host with an
# authenticated session, or an in-cluster port-forward:
#   kubectl -n fuzefront port-forward svc/fuzefront-unleash 4242:4242
UNLEASH="http://localhost:4242"          # or https://unleash.prod.fuzefront.com
TOKEN="$INIT_ADMIN_API_TOKEN"            # from the unleash-secrets INIT_ADMIN_API_TOKENS
PROJECT="default"
ENVIRONMENT="production"
```

### Reusable per-flag function (idempotent-as-noted)

Rather than four hand-copied blocks that drift, define the function once and
call it per flag. `create` (step 1) is idempotent: Unleash returns `409` for
an existing flag name, which the function tolerates. `strategies` POST
(step 3) is **not** idempotent — re-running it creates a duplicate strategy,
same caveat as the launcher runbook. If a flag already carries the Stage 0 /
Stage 1 strategies from its own per-flag runbook (only `root-membership` has
one today, and it has not been applied yet per this session's constraints),
**PATCH that existing `flexibleRollout` strategy's `rollout` to `100` and
remove its `segments` array** instead of POSTing a new strategy — see the
"If a partial rollout already exists" note below each block.

```bash
enable_flag_ga() {
  local FLAG="$1" DESCRIPTION="$2"

  echo "=== $FLAG ==="

  # 1. Create if absent (release type; description records owner + removal
  #    criterion inline so it is visible in the Unleash UI, not just this doc
  #    and flag-registry.yaml). Tolerate 409 (already exists).
  curl -sS -o /tmp/create_resp.json -w '%{http_code}' -X POST \
    "$UNLEASH/api/admin/projects/$PROJECT/features" \
    -H "Authorization: $TOKEN" -H 'Content-Type: application/json' \
    -d '{"name":"'"$FLAG"'","type":"release","description":"'"$DESCRIPTION"'"}' \
    | grep -qE '^(201|409)$' && echo "  create: ok (201 created or 409 exists)" \
    || { echo "  create: FAILED"; cat /tmp/create_resp.json; return 1; }

  # 2. Enable the production environment (a distinct switch from strategies —
  #    a flag with strategies but a disabled environment still evaluates OFF)
  curl -sfX POST \
    "$UNLEASH/api/admin/projects/$PROJECT/features/$FLAG/environments/$ENVIRONMENT/on" \
    -H "Authorization: $TOKEN" \
    && echo "  environment on: ok"

  # 3. GA strategy: flexibleRollout 100%, NO segment.
  curl -sfX POST \
    "$UNLEASH/api/admin/projects/$PROJECT/features/$FLAG/environments/$ENVIRONMENT/strategies" \
    -H "Authorization: $TOKEN" -H 'Content-Type: application/json' \
    -d '{
      "name": "flexibleRollout",
      "parameters": { "rollout": "100", "stickiness": "default", "groupId": "'"$FLAG"'" }
    }' \
    && echo "  100% strategy added: ok"
}
```

### 1. `fuzefront.identity.root-membership`

```bash
enable_flag_ga "fuzefront.identity.root-membership" \
  "FF-EPIC-17-S1/S2. Owner: backend-engineer (identity). GA per owner decision 2026-08-17 (supersedes the staged developers-segment/percentage-ramp plan in unleash-flag-fuzefront-identity-root-membership.md). Signup upserts a root member row instead of a type=personal org. Removal: delete this flag + the ensurePersonalOrg OFF-path once stable at 100% with migration 022/015 verified idempotent in prod."
```

> **If Stage 0/Stage 1 strategies from the per-flag runbook were already
> applied** (developers-segment 100% + a partial percentage-rollout
> strategy), do NOT run step 3 above as a fresh POST — instead `PATCH` the
> percentage-rollout strategy (no segment) to `"rollout": "100"`, and
> optionally delete the now-redundant developers-segment strategy (a
> segment overlay on a flag already 100% for everyone is a no-op, but
> removing it keeps the flag's strategy list legible):
> ```bash
> # list existing strategies to find the ids
> curl -sf "$UNLEASH/api/admin/projects/$PROJECT/features/fuzefront.identity.root-membership/environments/$ENVIRONMENT/strategies" \
>   -H "Authorization: $TOKEN"
> # PATCH the no-segment flexibleRollout strategy's rollout to 100
> curl -sfX PUT \
>   "$UNLEASH/api/admin/projects/$PROJECT/features/fuzefront.identity.root-membership/environments/$ENVIRONMENT/strategies/<strategy-id>" \
>   -H "Authorization: $TOKEN" -H 'Content-Type: application/json' \
>   -d '{"parameters":{"rollout":"100","stickiness":"default","groupId":"fuzefront.identity.root-membership"}}'
> ```

### 2. `fuzefront.identity.personal-context`

```bash
enable_flag_ga "fuzefront.identity.personal-context" \
  "FF-EPIC-17-S4. Owner: frontend-engineer (identity). GA per owner decision 2026-08-17. Gates the reconciled ContextSwitcher (Personal + org/sub-org tree) and My orgs and sub-orgs view. Removal: delete OrganizationPage.tsx select branch once GA and enabled for 100% of users. NOTE: also requires packages/feature-flags/src/catalog.ts WEB_EXPOSED_FLAGS to include this key for the frontend to observe it -- see PRE-FLIGHT BLOCKER in this runbook."
```

### 3. `fuzefront.identity.member-directory`

```bash
enable_flag_ga "fuzefront.identity.member-directory" \
  "FF-EPIC-17-S5 (#671/#672). Owner: backend-engineer (identity). GA per owner decision 2026-08-17. Gates GET /api/organizations/:id/directory and its UI. Removal: delete once rolled out to 100% and flag-OFF path unused. NOTE: also requires packages/feature-flags/src/catalog.ts WEB_EXPOSED_FLAGS to include this key for the frontend to observe it -- see PRE-FLIGHT BLOCKER in this runbook."
```

### 4. `fuzefront.identity.employee-console`

```bash
enable_flag_ga "fuzefront.identity.employee-console" \
  "FF-EPIC-17-S8/S9 (#655/#673). Owner: backend-engineer (identity). GA per owner decision 2026-08-17. Gates the explicit employee-marker grant trigger, role-catalog entry, and /staff cross-org console. Rollout convenience only -- never replaces the ReBAC org-admin-on-root grant / a permit.check. Removal: delete once 100% rolled out and flag-OFF path unused. NOTE: also requires packages/feature-flags/src/catalog.ts WEB_EXPOSED_FLAGS to include this key for the frontend to observe it -- see PRE-FLIGHT BLOCKER in this runbook."
```

## Verification — per flag, both states, per the `feature-flags` skill's done checklist

Verify server-side via `/api/frontend` (a temporary `frontend`-type Unleash
token, revoked immediately after — same method used in the launcher and
per-flag runbooks), or through the backend's own `GET /api/flags` for the
three web-exposed flags **once the catalog fix above has shipped**.

```bash
FRONTEND_TOKEN="<temporary frontend-type Unleash token>"

for FLAG in \
  fuzefront.identity.root-membership \
  fuzefront.identity.personal-context \
  fuzefront.identity.member-directory \
  fuzefront.identity.employee-console
do
  echo "=== $FLAG ==="
  curl -sf "$UNLEASH/api/frontend" \
    -H "Authorization: $FRONTEND_TOKEN" \
    -H 'Content-Type: application/json' \
    | python3 -c "
import sys, json
data = json.load(sys.stdin)
for t in data.get('toggles', []):
    if t['name'] == '$FLAG':
        print('  enabled:', t['enabled'])
"
done
# revoke the temporary frontend token immediately after this check
```

| Expected result (GA) | All four |
|---|---|
| `enabled` | **true** for every real evaluation context (no segment constraint — everyone gets it) |
| No Unleash reachable at all (provider unset/unreachable) | **false** — in-code fail-safe unchanged (each `is*Enabled()` util still catches and returns `false`) |

Application-level "both states" coverage (already merged, both flag
directions exercised by tests, independent of the live toggle):

- `backend/security/tests/organizationProvisioning.rootMembership.test.ts`,
  `backend/tests/rootMembershipBackfillMigration.test.ts`
- `frontend/src/components/__tests__/UserMenu.organizationSwitcher.test.tsx`,
  `frontend/src/__tests__/App.organizations-flag.test.tsx`
- `backend/security/tests/organizations.directory.test.ts`,
  `frontend/src/__tests__/App.member-directory-flag.test.tsx`
- `backend/tests/root-org-admin.test.ts`,
  `frontend/src/__tests__/App.employee-console-flag.test.tsx`

## Rollback — one line per flag

Disabling the production environment is the fastest, cleanest rollback (it
does not delete the strategy, so a re-enable returns to the same 100% GA
state without re-configuring):

```bash
for FLAG in \
  fuzefront.identity.root-membership \
  fuzefront.identity.personal-context \
  fuzefront.identity.member-directory \
  fuzefront.identity.employee-console
do
  curl -sfX POST \
    "$UNLEASH/api/admin/projects/$PROJECT/features/$FLAG/environments/$ENVIRONMENT/off" \
    -H "Authorization: $TOKEN"
done
```

`fuzefront.identity.root-membership`'s rollback note: disabling the
environment stops **new** signups/self-heals from taking the root-membership
path (they revert to `type='personal'` org creation) — it does **not**
retroactively remove root-membership rows already written for users who
signed up while it was ON. That is expected release-flag behavior, not a
bug; a genuine data rollback would require a separate migration, out of
scope of a flag toggle.

## Supersession

This document **supersedes the staged rollout plan** in
`docs/runbooks/unleash-flag-fuzefront-identity-root-membership.md` for the
purpose of this GA push, per the explicit owner decision recorded here
(2026-08-17): skip the `developers`-segment → 10%/25%/50%/100% ramp and go
straight to 100%, no segment, for all four flags. The per-flag runbook
remains the historical record of the originally-planned staged approach and
its flag-record metadata (owner, context contract, consumers) is still
authoritative — only its **rollout strategy section** is superseded.
`docs/runbooks/unleash-flag-fuzefront-identity-root-membership.md` has been
cross-linked to this document (see its top-of-file note).

## Out of scope of this document

- The Unleash **deployment mechanics** (Helm/Argo/CI,
  `UNLEASH_URL`/`UNLEASH_CLIENT_TOKEN` wiring) — `devops-engineer`.
- The `@fuzefront/feature-flags` **client package build**, including the
  `WEB_EXPOSED_FLAGS` catalog fix called out above as a pre-flight blocker
  — `backend-engineer`.
- The feature logic / UI the four flags gate — already merged
  (`backend-engineer` #615/#671/#655, `frontend-engineer` #656/#672/#673).
- **The live Unleash toggle itself** — this session cannot reach
  `unleash.prod.fuzefront.com` (CF-Access 403) or the in-cluster admin API
  (no `kubectl`/cluster route). An operator with live Unleash admin access
  must run the `curl` calls above.
