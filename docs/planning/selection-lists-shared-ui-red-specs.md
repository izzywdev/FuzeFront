# Selection Lists — shared lists (SL9): RED Playwright specs for the five approved UI flows

> **Status (2026-10-27):** the specs landed RED (TDD, 2026-10-26); all six UI stages have since merged behind the release flag
> `fuzefront.selection-lists.shared-lists` (default OFF) and the specs were run against a production build of the host
> (`vite preview`): **212 of 212 pass** (after the picker / workbench / reorder / provenance fixes of #1750; 199 of 212 before) — see [Verification against the built UI](#verification-against-the-built-ui-2026-10-27).
> The files keep the `*.red.spec.ts` name until every spec of a flow passes (the rename + the `ci.yml` list change are a separate,
> human-merged follow-up). Implementation: `packages/selection-lists-ui/src/shared-lists/**` (design-record task 14). Source of truth:
> `design/frames/selection-lists-shared/` (approved per flow 2026-10-20) and
> `services/selection-list-service/openapi.yaml` 4.2.0. Pipeline step 5 of
> [`design-first-ui-pipeline.md`](./design-first-ui-pipeline.md): *merging approved frames triggers ALL-RED specs,
> then frontend-engineers build until they go green.*

## What landed

| Path | Role |
|---|---|
| `frontend/tests/selection-lists-shared-read.red.spec.ts` | flow `shared-read` — frames 01, 02, 03, 11 |
| `frontend/tests/selection-lists-shared-fork.red.spec.ts` | flow `fork` — frames 04, 05, 06, 12 |
| `frontend/tests/selection-lists-shared-fork-provenance.red.spec.ts` | flow `fork-provenance` — frames 07, 13 |
| `frontend/tests/selection-lists-shared-visibility.red.spec.ts` | flow `visibility` — frames 08, 14 |
| `frontend/tests/selection-lists-shared-effective-picker.red.spec.ts` | flow `effective-picker` — frames 09, 10, 15 |
| `frontend/tests/support/selection-lists-shared-e2e.ts` | shared harness: contract-faithful network-layer stand-in for the service (4.1.0 list/lookup/shadowing/`include_shared`/`visibility` semantics, error shape, pagination), shell session/flag/org overrides, runtime tracker, viewport/RTL helpers. **Permanent** — it is not renamed or removed when the specs flip. |

It reuses (does not fork) `frontend/tests/support/selection-lists-e2e-session.ts` — the same harness the green
`selection-list-service-e2e` job uses — and drives the **built frontend** (`vite preview`), exactly like that job.
No backend is involved; the service is mocked with `page.route`, so specs are deterministic.

Selectors are the frames' `data-*` hooks (`manifest.json` `testHooks`) and ARIA roles only. `[data-frame=…]` is
deliberately **not** used: the 4.0.0 components the shared flows extend keep their own approved frame ids
(`01-list-index`, `03-list-detail`, …). Where a frame shows a state as either `data-state` on the panel or on a child
node, the specs accept both (`panelState()` helper).

## How RED lands without breaking required CI — and how the implementation PR flips it

**Mechanism = the repo's existing convention, not a new one:** TDD-red specs are named `*.red.spec.ts`
(skill `microservice-readiness` §5: *"Specs follow `*.red.spec.ts` naming convention until the flow is green (TDD)"*;
precedent: `account-security-hub.red.spec.ts`, `auth-experience-verify-reset.red.spec.ts`, …).

* The required check that owns these specs, `selection-list-service-e2e` (`Selection list E2E`,
  `.github/workflows/ci.yml`), runs an **explicit file list** (`selection-lists-{list-management,picker,access-control,translation-workbench}.spec.ts`).
  A new `.red.spec.ts` is **not on that list**, so it is not part of any required check. Nothing is skipped, `fixme`'d,
  tagged-out or quarantined — the specs are plain `test(...)` and they really fail until the UI exists.
* `nightly-e2e.yml` runs `npx playwright test` over the whole `frontend/tests` dir with `|| echo "::warning …"`:
  the red specs are visible there as a warning, never as a block. (Side effect worth knowing: the default config also
  has a `mobile` project, so nightly will run them under that profile too; they were written for and verified on
  `--project=chromium`, which is how CI runs this suite.)

**Flipping a flow** (done by the `frontend-engineer` PR that makes the flow green — one PR per flow is fine, specs are independent files):

```bash
git mv frontend/tests/selection-lists-shared-<flow>.red.spec.ts frontend/tests/selection-lists-shared-<flow>.spec.ts
# then add the new file name to the `Run selection-list e2e specs` list in
# .github/workflows/ci.yml (job selection-list-service-e2e), and update the header "Status" paragraph.
```

Cross-flow couplings to know when ordering the flips (a spec is green only when the flow it leans on is built):

| Spec | also needs |
|---|---|
| `SL9-FORK-030` (201 → lands on the fork with provenance "comparison unavailable") | flow `fork-provenance` |
| `SL9-FORK-031` (index refreshed after a fork) | flow `shared-read` (grouping) |
| `SL9-READ-031` ("Open your version") | the fork detail route only (4.0.0) |
| `SL9-PICK-*` | none of the others |

Run locally (what CI does):

```bash
npm run -w @fuzefront/chat-client build && npm run -w @fuzefront/chat-ui build \
  && npm run -w @fuzeone/selection-lists-ui build && npm run -w @fuzefront/telemetry build
cd frontend && npm run build && npx vite preview --port 4173 &
BASE_URL=http://localhost:4173 npx playwright test tests/selection-lists-shared-*.red.spec.ts --project=chromium
```

Committed artifacts: `frontend/playwright-report/` and `frontend/test-results/` are **tracked** in this repo and a local run rewrites them — `git checkout -- frontend/playwright-report frontend/test-results` before committing.

## Specs that pass TODAY (and must keep passing)

Two kinds, both deliberate and labelled in their titles:

* **canary** (`…-000` / `READ-001`, `READ-020`, `VIS-001`, `PICK-000`) — the *same* session + mocks render the approved 4.0.0 index / detail /
  workbench / Access panel / picker (and, for `VIS-001`, the shell really switches to the **platform** organization). They prove
  the harness is wired, so every RED failure is "the new UI is missing", not "the setup is broken".
* **guards** — absence/regression checks that cannot be red before the UI exists: flag-OFF specs (`READ-016/038/039`, `FORK-011/028`,
  `PROV-018`, `VIS-019`, `PICK-024/037`), "no/unknown `reason` is the ordinary conflict" (`FORK-004a/b`), and 4.0.0 behaviour the frames say
  is kept (`PICK-021` 403 on lookup = error state, `PICK-033-common-archived`, `PICK-034`). They exist so the implementation cannot leak shared-lists
  UI while the flag is OFF.

## Historical: verified RED baseline before the UI existed (2026-10-26, against `vite preview` of a production build of `master` 87e32a2 merged into the PR branch)

`npx playwright test tests/selection-lists-shared-*.red.spec.ts --project=chromium` → **212 tests: 21 pass, 191 fail, 0 setup errors / 0 timeouts.**

* **21 pass** = 7 canaries + 14 flag-OFF/4.0.0 guards (listed above). They pass because they assert the approved 4.0.0 UI or the *absence* of the new UI.
* **191 fail**: 186 with `element(s) not found` — 185 on a frame hook (`[data-control='include-shared']`, `[data-badge='common']`,
  `[data-action='fork-to-edit']`, `[data-panel='fork-provenance']`, `[data-panel='visibility-control']`, `[data-effective-source]`, …) plus `SL9-READ-018`, whose
  index row is missing because the shipped 4.0.0 index crashes on the real quota envelope (finding 5) — and 5 on a
  frame-specified state/copy the 4.0.0 UI renders differently (`SL9-READ-014` "no common lists are published", `SL9-PICK-023`/`062×3` "List unavailable").
  Every failure is "the new UI is missing" (or, for READ-018, the named 4.0.0 defect); none is a harness/route/mock error — the canaries render the same session and mocks.
* Static checks on the changed files: `tsc --noEmit --strict --noUnusedLocals --noUnusedParameters` clean; `eslint --max-warnings 0` (the frontend config) clean.

## Verification against the built UI (2026-10-27)

Run: production build of the host at `master` 6eccf4a0 (+ this PR), `vite preview`, Node 24.21, Playwright 1.61 driving the
environment's Chromium 141 (`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`; CI installs Playwright's own Chromium, a run on that build is still to be seen in CI), `--project=chromium --workers=4`, no retries:
`npx playwright test tests/selection-lists-shared-*.red.spec.ts` → **212 tests: first run 188 pass / 24 fail; after the triage below 199 pass / 13 fail; after the UI fixes of #1750 (picker waits for the flag, PROV-009 table, workbench on the real shapes) 212 pass / 0 fail.**

| Flow | Tests | Pass before triage | Pass after | Still red |
|---|---:|---:|---:|---|
| `shared-read` | 42 | 35 | **42** | – |
| `fork` | 57 | 57 | **57** | – |
| `fork-provenance` | 32 | 27 | **31** | PROV-009 (fixed by #1750: the fork's value editor is an ARIA table) |
| `visibility` | 37 | 37 | **37** | – |
| `effective-picker` | 44 | 32 | **32** | PICK-001, 011, 020, 022, 030, 036, 060 ×3, 063 ×3 (fixed by #1750: the picker waits for the flag) |
| **total** | **212** | **188** | **199** | **13** (all fixed by #1750 → 212 / 212) |

### Triage of every one of the 24 first-run failures

Buckets: (a) spec/mock bug · (b) real UI defect · (c) frame/spec disagreement (frames-only PR; not edited here) · (d) design-system foundation gap.

| Spec | Failure | Bucket | Cause and what was done |
|---|---|:-:|---|
| READ-021 | `status=all` expected on the values read | a | The **implemented** service answers `400` for `status=all` on `GET …/items` (`routes/items.ts:270` accepts `active`/`archived` only), although openapi 4.2.0 lists `all`. The UI correctly reads both statuses separately. Spec now asserts active + archived are read and `all` is never sent; the mock answers 400 for `all` like the service. (Service-vs-contract gap: see finding 9.) |
| READ-032 | locale index shows an error | a | Mock answered `{locales:[…]}`; the service (and openapi) answer a top-level array of `TranslationLocaleStatus` `{locale, completeness_pct, machine_translated, source_changed}`, source locale excluded. Harness default is now the real shape. |
| READ-033 | no `fr` link / no locale view | a | Same mock; and there is **no `GET …/translations/{locale}`** in the contract or service (only `PUT`/`DELETE`) — a locale's text is read with `GET …/items?locale=`. Default handler removed; the mock resolves per-locale labels (`_labels`, new `_machine`) on the items endpoint, with the service's fallback and `is_machine`. `fr` labels added to the common fixture. |
| READ-037 | "List not found" not inside `[data-error='NOT_FOUND']` | a | Frame 03 puts the title in the state's `<h3>` and the *body line* in `[data-error='NOT_FOUND']`. Spec asserts the title on the state and the body text on the hook. |
| READ-040 ×3 | Fork CTA 133 px wide at 375 px (frame 11: 307 px, full width) | **b** | The DS `Button` sets an inline `width: auto`, which the author rule `.fz-sl-cta > * { inline-size: 100% }` cannot beat. **Fixed** in `shared-lists/browse/SharedReadStyles.tsx` (`!important`, with the reason in a comment); `@fuzeone/selection-lists-ui` 0.14.0 → 0.14.1. |
| PROV-020 ×2 | "View common list" 277 px, spec wanted ≥300 | a | Frame 13 insets the link in its card: 273 px of a 307 px card. A viewport constant was wrong; the spec now compares with the rendered card's content box (`clientWidth` − padding). The header action keeps its ≥300 px assertion (frame: 307). |
| PROV-023a ×2 | strict-mode violation: `[data-behind-state='source-gone']` matched 2 elements | a | The UI (deliberately) renders the hook on the panel *and* on the inner status line so both placements the frames use (07 inner line, 13/gallery panel) match. The spec used the unscoped locator; it now uses the file's own `behind()` helper, which accepts either placement. |
| PROV-009 | no `columnheader` "Copied from" | **b** | Frame 07 draws the fork's value editor as a `<table>` with a "Copied from" column; the shipped value editor (`SelectionListManagementFlow.tsx`, 4.0.0) renders drag-sortable `<div>` rows, so the UI shows the label under the value name (`CopiedFromLabel`, correct text and `data-origin-item` hooks) but there is no column or header. Same root cause as the 4.0.0 frame 03 table never having been built as a table. **Not fixed**: needs the 4.0.0 editor restructured (outside `shared-lists/**`, larger). Options for the owner: restructure the editor into a real table, or a frames-only PR that draws the 4.0.0-faithful row layout with a labelled "Copied from" text. Spec unchanged (no weakening). |
| PICK-001, 011, 030, 060 ×3 | 2 lookups / 2 item reads / 2 resolves instead of 1 | **b** | The public `/embed/selection-list-picker` route mounts before `GET /api/flags` settles. `useFlag` is fail-closed (OFF until loaded), so the picker first runs the 4.0.0 data path (`GET ?key=`, unrestricted `GET …/items`, `POST /resolve`) and, when the flag turns ON, the shared path again (`include_shared=true&limit=1`, `items?status=active`, resolve). The frames say ONE lookup/ONE resolve; the extra requests are real (and the 4.0.0 path also issues a lookup **without** `include_shared`). |
| PICK-020, 022, 036, 063 ×3 | no error state after `failTimes(1, …)` | **b** | Same root cause: the single injected 5xx is consumed by the *first* (4.0.0, flag-OFF) request, the shared path then succeeds. |

Bucket totals over the 24 failing tests: **(a) 8** (READ-021, 032, 033, 037; PROV-020 ×2, 023a ×2) · **(b) 16** (READ-040 ×3 — fixed; PROV-009 — open; the 12 picker specs — open) · **(c) 0** · **(d) 0**.
After the triage: 8 (a) fixed in the specs/harness, 3 (b) fixed in the UI, 13 (b) still red.

**Picker — fixed in #1750 (package level, not the host gate):** `SharedListsFeatureProvider` takes `ready` (the host passes `useFlagState(SHARED_LISTS_FLAG_KEY).ready`, which settles — OFF — even with no token or on failure, so an unauthenticated embed renders the 4.0.0 picker). `useSharedLists().ready` is `false` until then and the picker, `useEffectiveList`, `useStoredValues`, `useSharedListIndex` and the management / workbench / access flows issue no request, then one set. The 7-line `App.tsx` gate verified at triage time (render the harness only when ready) was the diagnosis aid and is not shipped; a real host that embeds `SelectionListPicker` before its own flags settle gets the same behaviour from the package.

### Harness fidelity changes made while triaging (no assertion was removed or loosened)

* `GET …/items?status=` follows the implemented service (`active` | `archived`, else 400).
* `GET …/translations` answers the contract array; `GET …/translations/{locale}` is no longer mocked (it is not an operation); item text per locale comes from `items?locale=` with `is_machine`.
* `GET /quota` answers the real `{organization_id, quotas}` envelope **by default** (the 4.0.0 client reads it since #1719; `SL9-READ-018` is now a regression guard). The `quota read refused (default world)` entry of `EXPECTED_REFUSALS` and the 403 default were deleted, as the TODO asked; `SL9-FORK-024b` still sets the 403 explicitly.
* The `LEGACY_WORKBENCH_READS` opt-in (the 4.0.0 workbench's `{locales:[…]}` / `GET …/translations/{locale}` shapes) is **deleted** (#1750): the writable workbench now reads the service's real shapes (finding 11), so the fork specs (FORK-000…011 via `saveRefused`, FORK-010) run on the harness defaults.
* PROV-004 / PROV-005 are no longer tagged `@needs-contract-revision`: contract 4.2.0 has `SelectionList.revision` and the UI reads it. Both pass against the mock; the service does not emit `revision` yet, so against the real service the UI shows "comparison unavailable" (PROV-003 pins that).

### Console / network gate

Every ready-state spec ends with `expectRuntimeClean` (0 uncaught exceptions, 0 console errors, same-origin API); all of those pass. A separate sweep (throw-away spec, not committed) of the index (toggle + filter), common detail, read-only translations + locale view, fork dialog, fork detail, visibility/Access tab and the picker, each at desktop and 375 px, logged every console message of any level and every ≥400 / failed request: after removing the backend-less preview's own noise (service-worker registration blocked by Playwright, `/socket.io` websocket, `/api/v1/notifications/stream` 404) the residue was exactly two items, both mock-answered refusals the UI is not at fault for:
`HEAD …/items/reorder` → 404 on every editable list detail (the **4.0.0** value editor's `probeReorderPermission`; HEAD is not a contract operation — a console error in the real product, finding 10; **gone with #1750**, the editor no longer probes) and `GET …/access` → 403 on the Access tab (the default world's caller holds no `manage_access`). The picker was clean at both widths. The Chrome DevTools MCP was not available in this environment; the Playwright runtime tracker (console / pageerror / request origin) plus the sweep above stand in for it and should be repeated with the MCP when the flag is switched on in a real environment.

## Inventory — per flow: spec file → test ids → frame states

Test ids are the `SL9-<FLOW>-<nnn>` prefix in each test title (`playwright test -g SL9-FORK-04`). "×3" = en-US / he-IL / ar.

### 1 · `shared-read` — `selection-lists-shared-read.red.spec.ts`

| Frame | State / rule (frame) | Test ids |
|---|---|---|
| 01 index | flag ON default request (`include_shared=true`, no `visibility`), switch ON | READ-002 |
| 01 | grouping "Your organization" / "Common lists" (client-side) | READ-003 |
| 01 | VisibilityBadge (absent ⇒ private), ForkBadge, EditableHint only when `editable` present (unknown ≠ read-only), columns | READ-004 |
| 01 | source-neutral shadow note; shadowed common list not re-added; no note without a fork row | READ-005, READ-006 |
| 01 | Load more (cursor echo, appends into groups) | READ-007 |
| 01 | visibility filter → `include_shared=true&visibility=…`, grouping off, shadowing off, no replacement claim | READ-008, READ-009a/b |
| 01 | switch OFF: filter absent, reset to Any, neither param; ON restores at Any | READ-010 |
| 01 | a11y: `role=switch` keyboard, labelled filter group | READ-011 |
| 01 | loading (group headers appear with rows) / error (filters preserved, retry) / empty ON / empty OFF | READ-012, 013, 014, 015 |
| 01 | flag OFF = 4.0.0 index (no switch/filter/groups/badges/columns/params) | READ-016 |
| 01 | console-clean on the ready index | READ-017 |
| 01 | **4.0.0 defect pin:** the index renders when `GET /quota` answers the real `{organization_id, quotas}` envelope (shipped client reads `scopes` and crashes) | READ-018 |
| 02 common detail | badge, read-only notice, owner facts, read-only table with archived value badged, `status=all` | READ-021 |
| 02 | read-only = absent (no add/drag/edit/archive/purge/Access tab; `GET …/access` never called) | READ-022 |
| 02 | single Fork CTA gated on effective-list lookup (`key`, `include_shared=true`, `limit=1`); pending / failed lookup → no CTA + quiet retry | READ-023, 024, 025 |
| 02 | `editable` absent ⇒ 4.0.0 affordances, no marker/notice/CTA | READ-026 |
| 02 | a11y (note landmark, tabs, keyboard CTA) | READ-027 |
| 03 states | org list read-only notice + owner hint from `created_by` form (user / system / deleted-user), no raw id, no directory lookup, no CTA | READ-030-user/-system/-deleted-user |
| 03 | shadowed notice + "Open your version", no CTA | READ-031 |
| 03 | read-only translations index + read-only locale view (no inputs/Save/Autofill, M badge, `dir=rtl` cell) | READ-032, READ-033 |
| 03 | loading / empty / values error / 404 "List not found" (never 403) | READ-034, 035, 036, 037 |
| 03 | flag OFF detail; member without role 404 | READ-038, READ-039 |
| 11 mobile | 375 px en/he/ar: `dir`, Fork CTA inside viewport, full width, ≥44 px, above notice, id column dropped, LTR-isolated codes/keys, localized labels, table never scrolls sideways | READ-040 ×3 |

### 2 · `fork` — `selection-lists-shared-fork.red.spec.ts`

| Frame | State / rule | Test ids |
|---|---|---|
| 04 fork_required | 409 `fork_required` → banner + CTA bound to `source_list_id`, typed text kept, never auto-forks, relative `fork_url` | FORK-001, FORK-002 |
| 04 | absolute `fork_url` ignored (same-origin API base, nothing leaves the origin) | FORK-003 |
| 04 | no/unknown `reason` = ordinary conflict; flag OFF never renders the banner | FORK-004a/b, FORK-011 |
| 04 | 403 no-create (no CTA), 403 access-on-common ("managed by the platform"), 404 | FORK-005, 006, 007 |
| 04 | banner next to the refused control: value editor, reorder, auto-fill (translation workbench: FORK-001) | FORK-008, 009, 010 |
| 05 dialog | accessible modal, summary facts, `presentation=modal`, exactly org/private radio group, initial focus, roving tabindex, keyboard | FORK-020, 021, 022 |
| 05 | focus trap, Esc/Cancel idle close + focus return | FORK-023 |
| 05 | quota preview present / absent on 403 | FORK-024a/b |
| 05 | request body `{visibility}` only | FORK-025 |
| 05 | submitting: locked options, native `disabled` on BOTH buttons, not dismissible, single request | FORK-026 |
| 05 | no client-side size pre-check; flag OFF never mounted | FORK-027, FORK-028 |
| 06 success | 201 (navigate, toast, provenance "unknown"), index cache refresh, private-draft variant, 200 existing (info, not error) | FORK-030, 031, 032, 033 |
| 06 | existing archived → Restore (editable only), restoring/native disabled, 403 QUOTA by scope (org_lists / user_lists never "you" / unknown), 403 FORBIDDEN | FORK-034, 035, 036-* |
| 06 refusals (in the open dialog, nothing navigates) | fork_exists, fork_not_applicable, key-taken (+unknown reason), quota ×4 scopes, 5000 cap (service only), forbidden, 404 | FORK-040-* (11), FORK-041…045 |
| 06 | network failure / 5xx → "couldn't confirm", Try again re-sends same body | FORK-046, FORK-047 |
| 12 mobile | 375×667 en/he/ar: bottom sheet, content visible without scrolling, stacked full-width actions, ≥44 px, LTR key; scrim/Esc only while idle | FORK-050 ×3, FORK-051 ×3 |

### 3 · `fork-provenance` — `selection-lists-shared-fork-provenance.red.spec.ts`

| Frame | State / rule | Test ids |
|---|---|---|
| 07 | provenance facts immediate, source link, badges, no CTA on a fork | PROV-001 |
| 07 | behind-source states: checking (editor never waits), unknown, source-archived, source-gone (no link/alert), error + retry | PROV-002, 003, 006, 007, 008 |
| 07 | behind / up-to-date (needs `SelectionList.revision`, contract 4.2.0; mock-driven until the service emits it) | PROV-004, PROV-005 |
| 07 | "Copied from" via `origin_item_id` (null = added; unavailable source ⇒ "copied" w/o label) | PROV-009, PROV-010 |
| 07 | header-action gate: revert / archive-fork / none | PROV-011 ×4 (+ checking/error in 002/008) |
| 07 | revert confirm (alertdialog, 3 consequences, Cancel focus, native disabled in flight), 403 not-owner | PROV-012, 013 |
| 07 | archive-fork: source archived (outright consequence) vs source gone (CONDITIONAL, never "every form"), 403 | PROV-014, 015, 016 |
| 07 | change-visibility link; flag OFF absence | PROV-017, PROV-018 |
| 13 mobile | 375 px en/he: stacked card, full-width actions ≥44 px, bidi-isolated facts, bottom-sheet confirms with initial focus, scrim only while idle, states | PROV-020 ×2, 021 ×2, 022 ×2, 023a/b ×2 |

### 4 · `visibility` — `selection-lists-shared-visibility.red.spec.ts`

| Frame | State / rule | Test ids |
|---|---|---|
| 08 | control at top of Access tab, private/org radios, no platform option for a customer org | VIS-010 |
| 08 | private→org saves directly; org→private confirm (fork-specific lines only when `forked_from`); saving/saved/403 restore | VIS-011, 012, 013, 014, 015 |
| 08 | read-only statement (no form), loading, error+retry; a11y | VIS-016, 017a/b, 018 |
| 08 | platform-operator-only option (platform org + platform-owned list), pending mark, typed-key gating (case/trim exact), publishing natively disabled, cancel/Esc, 403 | VIS-020a/b, 021, 022, 023, 024, 025 |
| 08 | locked common list; stale demotion `409 visibility_locked` + reload | VIS-026, VIS-027 |
| 08 | flag OFF = 4.0.0 Access panel | VIS-019 |
| 14 mobile | 375 px en/he/ar: radio cards ≥44 px full-width, bottom-sheet confirm + initial focus, read-only, states, publish sheet (dir=ltr, mono, autocapitalize/autocorrect/spellcheck off) | VIS-030…034 ×3 |

### 5 · `effective-picker` — `selection-lists-shared-effective-picker.red.spec.ts`

| Frame | State / rule | Test ids |
|---|---|---|
| 09 | ONE lookup, items of that list only, never merged; fork vs common; picks submit item id | PICK-001, 002, 003, 003b, 004a/b |
| 09 | opt-in caption (absent by default; own / common; no extra request; appears with options) | PICK-010, 011, 012, 013 |
| 09 | private fork / archived fork edge cases | PICK-014, 015, 016 |
| 09 | error (retry, selection kept, no fallback, 403 ≠ not-found), items error, no effective list, flag OFF, a11y | PICK-020…025 |
| 10 | redirect via `effective_item_id` (no badge/notice, value not rewritten, menu marks fork option), pick emits fork id | PICK-030, 031 |
| 10 | `onEffectiveValue` once per redirected id (**inferred harness switch**, see below) | PICK-032 |
| 10 | resolve outcome matrix (private-fork, fork-item-purged, common-archived-redirect, fork-archived, common-archived, missing) | PICK-033-*, PICK-034 |
| 10 | resolving / resolve failed / flag OFF | PICK-035, 036, 037 |
| 15 mobile | 375 px en/he/ar: one lookup/one list, inline menu, ≥44 px, caption under control, redirected value, no list, error | PICK-060…063 ×3 |

## Findings and assumptions the implementer / designer must know

1. **`SelectionList.revision` is in contract 4.2.0 but the service does not emit it yet** (optional until the implementation ships).
   `PROV-004`/`PROV-005` mock the *source* response with `revision` and pass; against the real service the UI degrades to "comparison unavailable" (`PROV-003`).
2. **Inferred picker-harness switches** (the frames do not declare a hook): `?showSource=1` (opt-in caption) and `?migrate=1`
   (records `onEffectiveValue` calls as JSON on `[data-migration='host-opt-in']@data-effective-calls`). Isolated in `PICK-010…013/060` and `PICK-032/036`.
   If `frontend-engineer` spells them differently, change those specs, not the frames.
3. **"Platform organization" signal.** Frame 08 says "the shell's active organization is the platform organization AND the list's
   `organization_id` is that org". The fixture marks the active org `type: 'platform'` with an id equal to the list's wire `organization_id`
   (`ORGS.platform`). If the host injects the signal differently, `ORGS`/`mockSharedListsSession` in the support file is the single place to adapt.
4. **Shell at 375 px is already broken today (not SL9's to fix).** On the approved 4.0.0 index with the flag OFF, `document.documentElement.scrollWidth`
   is 514 at a 375 px viewport (shell side panel overlaps content), and the shell has no `[data-action='open-drawer']`. SL9's
   `implementation.paths` do not cover the shell, so the mobile specs assert at **component level** (CTA/sheet/card boxes inside the
   375 px viewport, panels never scroll sideways, ≥44 px targets, stacked actions) and `PICK-060…` — the picker harness has no shell chrome —
   additionally asserts no document-level horizontal scroll. The shell drawer / overflow belongs to `mobile-frontend-engineer` (and 4.0.0 frame 15).
   `isMobile` emulation is deliberately **not** used: it widens the layout viewport and would make "fits the viewport" assertions pass vacuously.
5. **Mock fidelity: what follows the wire contract and the three 4.0.0 exceptions.** *(Updated 2026-10-27: see "Harness fidelity changes" above — quota and translations now answer the real shapes by default; the 4.0.0 workbench shapes are an explicit opt-in, and the paragraphs below are the original rationale.)* The harness answers `list`/`items` pages
   (`{items, page:{nextCursor,hasMore,total}}`), single lists/items, `POST /resolve`, the error envelope (`ErrorCode` + `reason`/`source_list_id`/`fork_url`/`scope`/`limit`/`current`)
   and `GET /quota` (`{organization_id, quotas:[{scope, applies_to, limit, current}]}`) exactly as `openapi.yaml` (4.1.0 at the time, 4.2.0 now) defines them
   (verified by validating every reply of a full run against the OpenAPI schemas with Ajv — list/item/page/quota/resolve/error: 0 violations).
   Three routes deliberately stay in the shape the **shipped 4.0.0 UI** consumes, because the 4.0.0 canaries and the existing green
   `selection-list-service-e2e` specs render through them; the 4.0.0 client, not the network mock, owns any normalization:
   * `GET …/access` — contract `{items, page}` of `SelectionListAccessGrant`; the client (`getAccessGrants`) wants a bare array with `is_sole_owner`.
     Only the status (200 vs 403) matters to `VisibilityControl`.
   * `GET …/translations` — contract is a bare `TranslationLocaleStatus[]` (`completeness_pct`, …); the client wants `{locales:[{is_source,translated,…}]}`.
   * `GET …/translations/{locale}` — **not an operation in the contract at all** (only `PUT`/`DELETE`); the 4.0.0 workbench calls it anyway.
   All three are pre-existing UI-vs-contract divergences, not SL9 scope; the implementation of `shared-read` (read-only translations, frame 03) will have to
   choose a contract-defined source.
   **Quota is the one where the divergence is a shipped crash:** the 4.0.0 index does `quota?.scopes.some(…)` and the service sends `quotas`, so against the real
   service the index throws a `TypeError` and does not render. `SL9-READ-018` pins it (RED for that reason, green once the client reads/normalizes the wire envelope).
   Because of it, `world.quota` defaults to `403 FORBIDDEN` (the documented "no `read_quota`" answer, which the 4.0.0 index fails open on) and only the
   specs that need the numbers opt in with `grantQuotaRead(world)` (`SL9-FORK-024a`, `SL9-READ-018`) — otherwise every index spec and the `READ-001` canary would fail for the
   quota defect instead of for the missing shared-lists UI.
   **Console-clean gate vs. these refusals:** Chromium logs every non-2xx fetch as a console error, so a ready-state page that reads the default quota (403) or runs the 4.0.0
   editor's `HEAD …/items/reorder` permission probe (the service — and the mock — answer 404; HEAD is not a contract operation) would fail an unqualified console check
   although the UI is right. `expectRuntimeClean` therefore tolerates exactly the named `EXPECTED_REFUSALS` (status + request path; quota 403, reorder-probe 404) and nothing else —
   any other console error, uncaught exception, CSP/mixed-content message or other failed request still fails. A spec that injects more refusals on a success path passes its own
   `expected` list. `EXPECTED_REFUSALS` is now **empty**: the quota entry went with the 403 default (the client reads the real envelope), and the reorder-probe entry went with the probe (#1750).
   **5xx:** the contract defines no 5xx body and no `INTERNAL` code, so server failures are `fault(5xx)` (`{error:'boom'}`, the precedent of the green specs), never an `Error`-shaped body.
   A few specs send out-of-contract values **on purpose** to probe tolerance the contract demands or implies: `reason: some_future_reason` ("treat an unknown value as a plain CONFLICT"),
   `scope: something_new`, and an absolute `fork_url` (SL9-FORK-003).
6. **Org name in the fork dialog title** ("Fork “Priority” for Globex Freight", `FORK-020`) comes from the shell's active organization; the
   package is host-agnostic, so the host must inject it. If that is not wanted, `FORK-020` is the one place to renegotiate.
7. **Hook placement follows the frames, container or child.** Where a frame puts a marker on a wrapper and the action on a child (`data-revert-gate` on the
   `sl-head__actions` wrapper around `data-action="archive-fork"`, frame 07 "Header action — source archived or gone"; `data-state` on the picker panel with
   `aria-busy` on its combo control), the specs accept the marker on the element **or** its nearest ancestor/descendant as the frame draws it (`PROV-011`, `PICK-013`, `PICK-035`).
   States whose frame draws no controls (fork dialog *Submitting*, visibility *Saving*) are asserted as "nothing operable" (absent / `disabled` / `aria-disabled`), not by an invented hook.
8. **Frame copy asserted verbatim** only where the frame makes it a contract (source-neutral shadow note, `fork_exists` owner-only wording,
   conditional archive copy, "List unavailable", "Unknown value"). Everything else is asserted by hook/role, not by copy.
9. **Service vs contract: `GET …/items?status=all`.** openapi 4.2.0 lists `all` for this parameter; the implemented route (`services/selection-list-service/src/routes/items.ts`) answers `400 VALIDATION_ERROR` for it (the *list* route does accept `all`). Clients (`useListValues`) work around it by reading `active` and `archived` separately. Owner: `backend-engineer` / `contract-designer` — either implement `all` or remove it from the contract (breaking-change rules apply).
10. **4.0.0 console error on every editable list detail:** the value editor probes reorder permission with `HEAD …/items/reorder` (`probeReorderPermission`), which is not a contract operation and answers 404, logged by the browser as a console error. **Fixed in #1750:** the probe is removed; reorder permission comes from the list's `editable` hint and the reorder PUT's own 403 (handles removed, FORBIDDEN notice). Remaining gap: the contract has no exact `update_value` signal (`editable` is a `translate` check, emitted only behind the shared-lists flag); a boolean `can_reorder` on `SelectionList` would close it.
11. **4.0.0 translation workbench vs the service:** `getLocaleIndex` reads `{locales:[…]}` (service: a top-level array) and `getLocaleEditor` calls `GET …/translations/{locale}` (not an operation). Against the real service the writable workbench showed "No locales to translate". **Fixed in #1750:** the index is built from the status array + the list + `GET /quota`, the editor reads `GET …/items?locale=`. Row-level staleness is no longer shown in the writable editor (the items read carries no `source_hash`); the index still shows a locale's `source_changed`.

## Not covered here (named so nobody assumes it is)

* Post-production smoke against the live app (the flag is OFF everywhere) and a Chrome-DevTools-MCP console/network pass (not available in the verification environment; see "Console / network gate").
  The specs carry runtime gates (`expectRuntimeClean`: 0 uncaught exceptions, 0 console errors on success paths, same-origin API) that run with every spec.
* Playwright against the static frames (`file://`) — a separate verification phase; the frames' own `gate-frames-*` checks are unchanged.
* Real-device/webkit profiles (only Chromium is installed in CI for this job).
* The 4.0.0 mobile frames 15–18 (shell drawer, list-management/workbench/access/picker at 375 px) belong to the 4.0.0 flows, not SL9.
