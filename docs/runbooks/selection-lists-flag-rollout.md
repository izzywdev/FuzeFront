# Runbook — Selection Lists release-flag rollout (`fuzefront.selection-lists.service`)

**Status: PREPARED, NOT APPLIED.** The flag is OFF everywhere. Nothing in this
PR enables it in any environment; enabling is a production behaviour change
and is gated on the preconditions below.

## Flag record

| Field | Value |
|---|---|
| Key | `fuzefront.selection-lists.service` |
| Type / default | `release` / **OFF** (in-code fail-safe is OFF too) |
| Owner | platform team (flag admin: `feature-flags-engineer`) |
| Removal criterion | GA at 100% of orgs and stable for one release cycle; then delete the flag, the `SidePanel`/`App.tsx` `useFlag` guards, and selection-list-service `src/flags.ts` + `middleware/flagGate.ts` + per-handler checks in ONE cleanup PR |
| Registry | `packages/feature-flags/flag-registry.yaml` |
| Unleash state | Created OFF (no strategy, environment disabled) by dispatching `prod-unleash-ops` with `flags=selection-lists-create` (create-only; idempotent; a 409 on an existing flag leaves it untouched). The sibling seeding flag `fuzefront.selection-lists.seed-defaults` is created by the same dispatch. **Not verified from this repo:** whether the flag already exists in the live Unleash, or its live state; read the dispatch's *Verify* step output. |
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
   (not `continue-on-error`/advisory). The integration run uses
   `FLAGS_FORCE_ON` (non-prod only) because CI has no Unleash.
2. **e2e green** — `frontend/tests/selection-lists-*.spec.ts` pass against a
   deployed stack with the flag ON.
3. **UI unit tests green** (`packages/selection-lists-ui` + the shell tests above).
4. The change set is merged and **deployed to prod**: shell with the web
   catalog entry, and selection-list-service deployed (Helm
   `selectionListService.enabled: true`, `selection-list-secrets` SealedSecret
   provisioned — `devops-engineer`). Flipping the flag before the service is
   deployed makes the UI render against a missing API.
5. Owner decision recorded (who, target %, date) in the PR/issue requesting the ramp.

## Staged ramp

Step 0 (once, before the first ramp): dispatch **`prod-unleash-ops`** with
`flags=selection-lists-create` so both selection-list flags exist in Unleash,
OFF. It never enables anything.

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

## Out of scope for this runbook

Unleash/service deploy mechanics (`devops-engineer`), the
`@fuzefront/feature-flags` client build (`backend-engineer`), the feature UI
(`frontend-engineer`), and the integration/e2e suites (`test-engineer`).
