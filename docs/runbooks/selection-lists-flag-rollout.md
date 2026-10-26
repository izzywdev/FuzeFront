# Runbook — Selection Lists release-flag rollout (`fuzefront.selection-lists.service`)

**Status (updated 2026-10-26): PREPARED; no committed file enables any selection-lists flag (only
a dispatched `prod-unleash-ops` run can).**
All three flags default OFF and fail closed. The service workload itself is **deployed** in
production (`selectionListService.enabled: true` in `values-prod.yaml` since #1592; the master flag
gates its visibility), so precondition 4 below is met at chart level. What the flags are set to in the live Unleash
cannot be read from this repo (read the `prod-unleash-ops` *Verify* output); note the owner-directed `all-flags` set lists the master and `seed-defaults` flags, not `shared-lists`. Enabling a flag is a
production behaviour change and is gated on the preconditions below.

## Flag record

| Field | Value |
|---|---|
| Key | `fuzefront.selection-lists.service` |
| Type / default | `release` / **OFF** (in-code fail-safe is OFF too) |
| Owner | platform team (flag admin: `feature-flags-engineer`) |
| Removal criterion | GA at 100% of orgs and stable for one release cycle; then delete the flag, the `SidePanel`/`App.tsx` `useFlag` guards, and selection-list-service `src/flags.ts` + `middleware/flagGate.ts` + per-handler checks in ONE cleanup PR |
| Registry | `packages/feature-flags/flag-registry.yaml` |
| Unleash state | Created OFF (no strategy, environment disabled) by dispatching `prod-unleash-ops` with `flags=selection-lists-create` (create-only; idempotent; a 409 on an existing flag leaves it untouched). The sibling flags `fuzefront.selection-lists.seed-defaults` (seeding) and `fuzefront.selection-lists.shared-lists` (SL9 shared/common lists + forks, see below) are created by the same dispatch. **Not verified from this repo:** whether the flag already exists in the live Unleash, or its live state; read the dispatch's *Verify* step output. |
| Browser catalog | `WEB_EXPOSED_FLAGS` in `packages/feature-flags/src/catalog.ts` (present — without it the browser reads permanently OFF) |

## What the flag gates (all of it, server and client)

- **Server** — every `/v1/selection-lists/*` route answers `404 NOT_FOUND`
  while OFF (router-level gate `src/middleware/flagGate.ts`, mounted in
  `src/app.ts`; plus per-handler checks in lists/items/quota/translations;
  `/v1/resolve` has its own). The gate fails closed if flag evaluation throws.
  Evaluated with the caller's `organizationId` + `userId` so per-org and
  percentage targeting work.
- **Client** — the "Selection Lists" `SidePanel` entry and the
  `/settings/selection-lists*` routes (`App.tsx`: OFF redirects to `/dashboard`).
- **Not gated:** `/embed/selection-list-picker` (public picker harness) and the
  Helm `selectionListService.enabled` deployment switch (devops-owned).
- The flag is **visibility/rollout only**. Authorization is the Security API
  (`requireAuthzCheck`) — never the flag.

## Both-states test coverage

- Service: `services/selection-list-service/tests/{lists,items,translations,resolve}.test.ts`
  (OFF → 404 on every route incl. the `access` routes via the router gate and
  when flag evaluation throws; ON → normal routing; evaluation context carries
  org + user).
- Shell: `frontend/src/__tests__/App.selection-lists-flag.test.tsx` (routes OFF
  redirect / ON render) and
  `frontend/src/components/__tests__/SidePanel.selectionLists.test.tsx` (menu
  entry OFF absent / ON present).
- Catalog: `packages/feature-flags/tests/get-client.test.ts` (flag is
  web-exposed, release default OFF).

## Preconditions — ALL must hold before the first ramp step

1. `selection-list-service` **integration job green AND its gate required**
   (not `continue-on-error`/advisory). The integration run forces the flag ON
   with the offline OpenFeature provider (`FUZE_FLAGS_PROVIDER=offline`,
   non-prod only) because CI has no Unleash; a second matrix leg (`off`) runs
   with no provider and asserts the dark 404.
2. **e2e green** — `frontend/tests/selection-lists-*.spec.ts` pass against a
   deployed stack with the flag ON.
3. **UI unit tests green** (`packages/selection-lists-ui` + the shell tests above).
4. The change set is merged and **deployed to prod**: shell with the web
   catalog entry, and selection-list-service deployed (Helm
   `selectionListService.enabled: true` — set in `values-prod.yaml` by #1592 —
   and the `selection-list-secrets` SealedSecret, present under
   `deploy/contabo/sealed/`; pod health is UNVERIFIED from the repo —
   `devops-engineer`). Flipping the flag before the service is
   deployed makes the UI render against a missing API.
5. Owner decision recorded (who, target %, date) in the PR/issue requesting the ramp.

## Staged ramp

Step 0 (once, before the first ramp): dispatch **`prod-unleash-ops`** with
`flags=selection-lists-create` so all three selection-list flags (`service`,
`seed-defaults`, `shared-lists`) exist in Unleash, OFF. It never enables
anything, never adds a strategy and leaves an existing flag untouched.

Then, via the dispatchable workflow **`prod-unleash-ops`**
(`.github/workflows/prod-unleash-ops.yml`, runs on the in-cluster runner, so no
CF-Access session or token handling is needed). Each step is idempotent: the
existing `flexibleRollout` strategy is PATCHed, never duplicated; stickiness is
`default` with a fixed `groupId`, so a user's bucket is stable as the % grows.

| Step | Dispatch inputs | Soak / exit check |
|---|---|---|
| 1 | `flags=selection-lists`, `rollout=10`, `action=enable` | 1 day: no 5xx/`INTERNAL_ERROR` on `/v1/selection-lists/*`, console clean on `/settings/selection-lists` |
| 2 | `rollout=25` | 1 day, same checks |
| 3 | `rollout=50` | 1 day, same checks |
| 4 | `rollout=100` | stable one release cycle, then schedule flag removal (see removal criterion) |

Verify after each step: the workflow's *Verify* step prints `ON`; as an
enabled user `GET /api/flags` includes `"fuzefront.selection-lists.service": true`
and the sidebar entry renders; as a non-bucketed user the API route returns 404.

## Rollback

Dispatch **`prod-unleash-ops`** with `flags=selection-lists`, `action=disable`
(turns the production environment OFF, strategy kept so re-enable returns to the
same state). Effect is immediate for new evaluations: routes 404, menu/routes
disappear on the next `/api/flags` read. Fail-safe if Unleash is unreachable is
also OFF.

Release-flag rollback is **forward-only for data**: lists/items/translations/
access grants created while ON remain in the database; disabling only stops new
requests reaching them. A data rollback is a separate migration, never a flag
toggle.

## Third flag: `fuzefront.selection-lists.shared-lists` (SL9, shared/common lists + forks)

| Field | Value |
|---|---|
| Key / type / default | `fuzefront.selection-lists.shared-lists` / release / **OFF** |
| Owner | izzywdev |
| Removal criterion | ON for all orgs for 30 consecutive days with no fork / shared-read incident; then delete the flag, `FLAG_KEYS.SELECTION_LISTS_SHARED_LISTS`, the `WEB_EXPOSED_FLAGS` entry, `isSharedListsEnabled()` and every off-path branch in selection-list-service in ONE cleanup PR |
| Registry / catalog | `packages/feature-flags/flag-registry.yaml`; `FLAG_KEYS` + `WEB_EXPOSED_FLAGS` in `packages/feature-flags/src/catalog.ts` (server **and** web: the UI gates the common badge / fork flow on it) |
| Unleash state | Created OFF (production environment disabled, no strategy) by the same `flags=selection-lists-create` dispatch. Create-only: that set never enables it, never adds a strategy and never alters an existing flag. **Not verified from this repo:** the live Unleash state; read the dispatch's *Verify* output. |
| Gates | All SL9 behaviour in selection-list-service (list `visibility`, shared read, `include_shared`, fork, `409 fork_required`, resolve redirect, `list.forked` / `visibility.changed` events, seed-list `visibility`) and the shared-list UI. OFF = the service answers as 4.0.0. Real authorization stays in Permit; the flag is never a boundary. |
| Prerequisites | Independent of, and additionally requires, the master flag `fuzefront.selection-lists.service`. Also needs, before it is turned on: the platform org **confirmed by the org projection** (a row for `org_0000000000000000000000000g` that is `active`, `is_active`, typed `platform`, not suspended; otherwise every platform feature stays disabled; check in `selection-lists-rollout.md` section 10.4), the Permit actions `read_shared` / `publish_platform` synced, the section 10.1-10.2 duplicate-key audit at 0 rows, and the broker-ACL prerequisite P6 (FuzeInfra#1394; no in-process producer authentication, an accepted residual risk until then). Needs the Helm env `SELECTION_LIST_PLATFORM_ORG_ID` (`selectionListService.platformOrgId`, **empty by default**; empty = platform features fail closed. Configurable per environment, but **production is enforced** by the `gate-platform-org-pin` CI job to the root platform org TypeID derived from the code's `ROOT_ORG_ID` (currently `org_0000000000000000000000000g`): enabling the service in `values-prod.yaml` requires that exact value, see `selection-lists-rollout.md` section 2.4). |
| Enablement | A deliberate owner step via the raw `unleash-flag-enable` procedure. **Per-org targeting is only correct for the service, not the browser:** this flag is web-exposed, and `GET /api/flags` (`backend/src/routes/flags.ts`) evaluates browser flags with a `userId` and **no `orgId`**, so an `orgId IN [org_...]` constraint turns shared lists ON in the service while the UI (common badge, fork flow) stays OFF. A user-based constraint does not fix it either: `GET /api/flags` sends the database UUID as `userId`, while `selection-list-service` canonicalizes every user to a `usr_…` TypeID, so a `developers` segment or direct-user constraint enables only one of the two paths (the opposite split). Until `/api/flags` supplies a trusted active-org context (and the web client re-evaluates when the org changes) **and** the two `userId` forms are aligned (or the segment lists both), **enable globally** — that is the only option that works on both paths. Do not use an org-only or user-only constraint. NOT part of `prod-unleash-ops` today and not part of this change. Rollback = turn the environment OFF; shared reads stop and the service reverts to 4.0.0 behaviour (data created while ON, including forks, remains; the platform-suspension and common-list purge guards and the cross-rendering key-uniqueness rule apply with the flag OFF too). |
| What is dark / not built | **Service: implemented, dark.** **UI: not built** — no shell or `@fuzeone/selection-lists-ui` code reads this flag yet (`grep shared-lists frontend/src packages/selection-lists-ui/src` is empty); the frames are approved and the implementation and RED-spec PRs were open on 2026-10-26. So turning the flag ON today changes API behaviour only (a `visibility`/`editable`-aware listing, fork, resolve redirect, events). **Fork provenance** cannot show whether a fork is behind its source: `SelectionList` has no `revision` (contract MINOR proposed, not merged). **Rollout data jobs** (set `org` on seeded lists, retro-fork per-org copies) and platform pack v2 are not built. |

## Out of scope for this runbook

Unleash/service deploy mechanics (`devops-engineer`), the
`@fuzefront/feature-flags` client build (`backend-engineer`), the feature UI
(`frontend-engineer`), and the integration/e2e suites (`test-engineer`).
