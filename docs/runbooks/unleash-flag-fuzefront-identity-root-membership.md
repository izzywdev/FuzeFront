# Flag — `fuzefront.identity.root-membership` (FF-EPIC-17-S1/S2)

> **SUPERSEDED (rollout strategy only) — 2026-08-17.** The owner decided to
> take all four FF-EPIC-17 identity flags straight to GA (100%, no segment)
> rather than the staged `developers`-segment → percentage-ramp plan below.
> Apply **`docs/runbooks/unleash-enable-ff-epic-17-flags.md`** instead for
> the actual Unleash steps. This document's flag-record metadata (owner,
> context contract, consumers, removal criterion) remains authoritative —
> only the "Rollout strategy — three stages" section is superseded.

**Status of this document: AUTHORED, NOT YET APPLIED.** The live Unleash admin API
(`unleash.prod.fuzefront.com`, Cloudflare-Access-gated; in-cluster
`fuzefront-unleash:4242`) is not reachable from this environment — no `kubectl`,
no cluster network route, and the CF-Access host correctly 403s without an
authenticated session. This file is the version-controlled flag definition +
the exact, idempotent-as-noted steps to apply it, following the same
executable pattern already used in
`docs/runbooks/unleash-launcher-and-developer-flags.md`. Coordinate with
`devops-engineer` (wiring `UNLEASH_URL`/`UNLEASH_CLIENT_TOKEN` into
`backend/security` in parallel — that is deploy plumbing, this is flag
administration) and apply this the next time an agent/human has live Unleash
admin access (e.g. via the same port-forward or CF-Access session used in the
launcher runbook).

## Flag record

| Field | Value |
|---|---|
| **Key** | `fuzefront.identity.root-membership` (locked — matches `ROOT_MEMBERSHIP_FLAG` in `backend/security/src/utils/rootMembershipFlag.ts` and `backend/src/utils/rootMembershipFlag.ts`, merged in #615) |
| **Naming** | `<repo>.<domain>.<flag>` = `fuzefront` (repo) . `identity` (domain) . `root-membership` (flag) |
| **Type** | **release** — ships the "signup upserts a root `member` row instead of creating a `type='personal'` org" behavior change dark, gradually rolled out, then removed |
| **Default (in-code fail-safe, both consumers)** | **OFF** — `isRootMembershipEnabled()` returns `false` on any failure (package absent, provider unreachable, evaluation error), preserving today's personal-org behavior with zero regression |
| **Default (Unleash toggle, at creation)** | **OFF** globally; ON only for the `developers` segment (see Stage 0 below) |
| **Owner** | `backend-engineer` (identity slice) — per the doc-comment already recorded in both `rootMembershipFlag.ts` copies |
| **Removal criterion** | Delete the Unleash flag **and** the `ensurePersonalOrg`/legacy-personal-org-creation OFF-path in both `organizationProvisioning.ts` copies once: (a) the flag is at 100% rollout in production, (b) migration 022 (`backend/src/migrations/022_root_membership_backfill_and_personal_org_reclassify.ts`) / 015 (`backend/security/src/migrations/015_root_membership_backfill_and_personal_org_reclassify.ts`) has run and been verified idempotent in prod, and (c) the flag-OFF path is no longer exercised (no new personal orgs being created). One cleanup PR removes the toggle + both code branches + the dead-path tests together. |
| **Epic / stories** | FF-EPIC-17 (`docs/planning/epics/EPIC-17-personal-identity-portal-employee-reconciliation.md`), stories S1 (provisioning) + S2 (migration) |
| **Plan of record** | `/root/.claude/plans/as-you-can-see-glimmering-rabbit.md` |
| **Consumers (already merged, #615)** | `backend/security/src/utils/rootMembershipFlag.ts` → `backend/security/src/services/organizationProvisioning.ts:421`; mirrored in `backend/src/utils/rootMembershipFlag.ts` → `backend/src/services/organizationProvisioning.ts:471` |
| **Authorization note** | Rollout convenience only. `assignOrganizationRole(...)` (Permit tenant-role sync) runs on **both** the ON and OFF paths — this flag never stands in for a `permit.check`. (It is a **release** flag, not a *permission* flag, so this is belt-and-suspenders, not a taxonomy requirement — noted because the underlying change touches org membership.) |

## Evaluation context this flag keys on

Per the `@fuzefront/feature-flags` context contract and how the merged consumer
actually calls it (`isRootMembershipEnabled({ userId })` in
`organizationProvisioning.ts:421`):

| Context field | Used for | Source in the consumer |
|---|---|---|
| `environment` | `local` \| `dev` \| `prod` — Unleash environment selection | `NODE_ENV`/`FLAG_ENV`, filled by the util, not the call site |
| `userId` | Gradual-by-user percentage rollout stickiness + `developers` segment targeting (Unleash built-in `userId` field ← OpenFeature `targetingKey`) | the signing-up/logging-in user's `users.id` UUID, passed explicitly at the call site |
| `app` | Distinguishes the two provisioning copies for observability | `'fuzefront-security'` (security service) / `'fuzefront-backend'` (monolith) — filled by the util |
| `organizationId`/`tenantId` | **Not applicable to this flag** — evaluated at signup/self-heal time, before any org context exists (the whole point of the flag is deciding *whether* an org gets created); intentionally omitted, not a gap |

This matches the family contract's "never evaluate with no context in a prod
path" rule: every evaluation carries `environment` + `userId` + `app`.

## Rollout strategy — three stages

### Stage 0 — creation: `developers` segment only (apply first)

Per the flag-creation checklist (`.claude/skills/feature-flags/SKILL.md`),
every new flag gets the developer-cohort strategy at creation in the
**production** environment of the **default** project, reusing the existing
`developers` segment (**id 1**, already populated with the owner's `users.id`
UUID per `docs/runbooks/unleash-launcher-and-developer-flags.md`). Net effect:
ON for developers, OFF for everyone else.

### Stage 1 — percentage rollout (apply after Stage 0 has soaked)

A second `flexibleRollout` strategy, **no segment**, stuck on `userId` so a
given user's bucket is stable across evaluations, ramped manually as
confidence grows: **10% → 25% → 50% → 100%**. Each step is a separate,
deliberate PATCH — this is not an automatic ramp. Ramp cadence and go/no-go
between steps is `backend-engineer`'s call (they own the gated behavior and
read the migration/provisioning test signal); `feature-flags-engineer` applies
the Unleash-side change on request.

### Stage 2 — GA (100%, then retire)

Once Stage 1 reaches and holds at 100% with no regression, and migrations
022/015 have run + verified idempotent in prod (S2's DoD), the flag has
reached its **removal criterion**: delete the Unleash toggle and file the
cleanup PR removing the OFF-path (legacy `ensurePersonalOrg` personal-org
creation branch) from both `organizationProvisioning.ts` copies.

## Exact steps to apply (Unleash Admin API)

Reuses the same access pattern documented in
`docs/runbooks/unleash-launcher-and-developer-flags.md` ("Executable version").

```bash
# Reach the admin API — either the CF-Access-gated prod host with an
# authenticated session, or an in-cluster port-forward:
#   kubectl -n fuzefront port-forward svc/fuzefront-unleash 4242:4242
UNLEASH="http://localhost:4242"          # or https://unleash.prod.fuzefront.com
TOKEN="$INIT_ADMIN_API_TOKEN"            # from the unleash-secrets INIT_ADMIN_API_TOKENS
PROJECT="default"
ENVIRONMENT="production"
FLAG="fuzefront.identity.root-membership"
DEV_SEGMENT_ID=1                          # the existing `developers` segment

# 1. Create the flag (type=release; description records owner + removal
#    criterion inline so it is visible in the Unleash UI, not just this doc)
curl -sfX POST "$UNLEASH/api/admin/projects/$PROJECT/features" \
  -H "Authorization: $TOKEN" -H 'Content-Type: application/json' \
  -d '{
    "name": "'"$FLAG"'",
    "type": "release",
    "description": "FF-EPIC-17-S1/S2. Owner: backend-engineer (identity). Gates signup upserting a root member row instead of creating a type=personal org. Default OFF (fail-safe). Removal: delete this flag + the ensurePersonalOrg OFF-path once 100% rolled out and migration 022/015 verified idempotent in prod. See docs/planning/epics/EPIC-17-personal-identity-portal-employee-reconciliation.md."
  }'

# 2. Enable the production environment for this flag (a distinct switch from
#    strategies — a flag with strategies but a disabled environment still
#    evaluates OFF)
curl -sfX POST \
  "$UNLEASH/api/admin/projects/$PROJECT/features/$FLAG/environments/$ENVIRONMENT/on" \
  -H "Authorization: $TOKEN"

# 3. Stage 0 — developers-segment strategy (100% rollout, gated to segment 1)
curl -sfX POST \
  "$UNLEASH/api/admin/projects/$PROJECT/features/$FLAG/environments/$ENVIRONMENT/strategies" \
  -H "Authorization: $TOKEN" -H 'Content-Type: application/json' \
  -d '{
    "name": "flexibleRollout",
    "parameters": { "rollout": "100", "stickiness": "userId", "groupId": "'"$FLAG"'" },
    "segments": ['"$DEV_SEGMENT_ID"']
  }'

# 4. Stage 1 — percentage rollout strategy, NO segment, starts at 10%.
#    Ramp later by PATCHing this same strategy's "rollout" parameter to 25,
#    then 50, then 100 — do not create a new strategy per step.
curl -sfX POST \
  "$UNLEASH/api/admin/projects/$PROJECT/features/$FLAG/environments/$ENVIRONMENT/strategies" \
  -H "Authorization: $TOKEN" -H 'Content-Type: application/json' \
  -d '{
    "name": "flexibleRollout",
    "parameters": { "rollout": "10", "stickiness": "userId", "groupId": "'"$FLAG"'" }
  }'
# note the returned strategy "id" for the ramp PATCH, e.g.:
# curl -sfX PUT ".../strategies/<id>" -d '{"parameters":{"rollout":"25", ...}}'
```

Stage 2 (GA → retirement) is not a creation step — it is the removal PR
described above, filed once the removal criterion is met.

## Verification (both states, per the `feature-flags` skill's done checklist)

Once applied, verify server-side via `/api/frontend` (or a temporary
`frontend`-type token, revoked immediately after — same method used in the
launcher runbook) with three contexts:

| Context | Expected |
|---|---|
| `userId` = the owner's UUID (in `developers` segment) | **ON** |
| `userId` = an arbitrary real user UUID not in the segment, before any percentage ramp | **OFF** |
| No Unleash reachable at all (provider unset/unreachable) | **OFF** — in-code fail-safe (`isRootMembershipEnabled` catches and returns `false`) |

Application-level verification (both flag states exercising real code, not
just the toggle) is already covered by the merged consumer's test suites:
`backend/security/tests/organizationProvisioning.rootMembership.test.ts` and
`backend/tests/rootMembershipBackfillMigration.test.ts` /
`backend/security/tests/migrations.rootMembershipBackfill.test.ts` — flag ON
asserts the root-membership upsert + no personal org; flag OFF asserts
unchanged legacy behavior.

## Out of scope of this document

- The Unleash **deployment mechanics** (Helm/Argo/CI, `UNLEASH_URL`/
  `UNLEASH_CLIENT_TOKEN` wiring into `backend/security`) — `devops-engineer`,
  in parallel.
- The `@fuzefront/feature-flags` **client package** itself
  (`packages/feature-flags/**`) — already built (FF-EPIC-06-S4); this flag is
  a pure consumer of it.
- The feature logic the flag gates (`organizationProvisioning.ts`,
  migrations 022/015) — already merged, `backend-engineer`, #615.
