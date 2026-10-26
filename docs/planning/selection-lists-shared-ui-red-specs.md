# Selection Lists — shared lists (SL9): RED Playwright specs for the five approved UI flows

> **Status:** specs landed RED (TDD), 2026-10-26. Implementation target:
> `packages/selection-lists-ui/src/shared-lists/**` (design-record task 14). Source of truth:
> `design/frames/selection-lists-shared/` (approved per flow 2026-10-20) and
> `services/selection-list-service/openapi.yaml` 4.1.0. Pipeline step 5 of
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

## Specs that pass TODAY (and must keep passing)

Two kinds, both deliberate and labelled in their titles:

* **canary** (`…-000` / `READ-001`, `READ-020`, `VIS-001`, `PICK-000`) — the *same* session + mocks render the approved 4.0.0 index / detail /
  workbench / Access panel / picker (and, for `VIS-001`, the shell really switches to the **platform** organization). They prove
  the harness is wired, so every RED failure is "the new UI is missing", not "the setup is broken".
* **guards** — absence/regression checks that cannot be red before the UI exists: flag-OFF specs (`READ-016/038/039`, `FORK-011/028`,
  `PROV-018`, `VIS-019`, `PICK-024/037`), "no/unknown `reason` is the ordinary conflict" (`FORK-004a/b`), and 4.0.0 behaviour the frames say
  is kept (`PICK-021` 403 on lookup = error state, `PICK-033-common-archived`, `PICK-034`). They exist so the implementation cannot leak shared-lists
  UI while the flag is OFF.

## Verified RED baseline (2026-10-26, against `vite preview` of a production build of `master` f1308fc77)

`npx playwright test tests/selection-lists-shared-*.red.spec.ts --project=chromium` → **211 tests: 21 pass, 190 fail, 0 setup errors / 0 timeouts.**

* **21 pass** = 7 canaries + 14 flag-OFF/4.0.0 guards (listed above). They pass because they assert the approved 4.0.0 UI or the *absence* of the new UI.
* **190 fail**: 185 with `element(s) not found` on a frame hook (`[data-control='include-shared']`, `[data-badge='common']`,
  `[data-action='fork-to-edit']`, `[data-panel='fork-provenance']`, `[data-panel='visibility-control']`, `[data-effective-source]`, …) and 5 on a
  frame-specified state/copy the 4.0.0 UI renders differently (`SL9-READ-014` "no common lists are published", `SL9-PICK-023`/`062×3` "List unavailable").
  Every failure is "the new UI is missing", none is a harness/route/mock error — the canaries render the same session and mocks.
* Static checks on the new files: `tsc --noEmit --strict --noUnusedLocals --noUnusedParameters` clean; `eslint --max-warnings 0` (the frontend config) clean.

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
| 07 | **behind / up-to-date — `@needs-contract-revision`** (see below) | PROV-004, PROV-005 |
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

1. **`SelectionList.revision` is not in contract 4.1.0** (manifest `contractGaps`, owner `contract-designer`). `PROV-004`/`PROV-005`
   mock the *source* response with an additive `revision` and are tagged `@needs-contract-revision`. They are RED now, not skipped;
   they become satisfiable as soon as the UI reads an optional `revision`. Under 4.1.0 only the "comparison unavailable" state is reachable (`PROV-003`).
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
5. **`GET …/access` body shape.** The contract says `{items, page}`; the existing client (`getAccessGrants`) and the existing access spec use a bare
   array. The visibility specs follow the existing harness (bare array); only the status code (200 vs 403) matters to `VisibilityControl`.
6. **Org name in the fork dialog title** ("Fork “Priority” for Globex Freight", `FORK-020`) comes from the shell's active organization; the
   package is host-agnostic, so the host must inject it. If that is not wanted, `FORK-020` is the one place to renegotiate.
7. **Frame copy asserted verbatim** only where the frame makes it a contract (source-neutral shadow note, `fork_exists` owner-only wording,
   conditional archive copy, "List unavailable", "Unknown value"). Everything else is asserted by hook/role, not by copy.

## Not covered here (named so nobody assumes it is)

* Post-production smoke against the live app and the Chrome-DevTools-MCP console/network pass over the **built** UI: impossible until the UI exists.
  The specs carry runtime gates (`expectRuntimeClean`: 0 uncaught exceptions, 0 console errors on success paths, same-origin API) that run with every spec.
* Playwright against the static frames (`file://`) — a separate verification phase; the frames' own `gate-frames-*` checks are unchanged.
* Real-device/webkit profiles (only Chromium is installed in CI for this job).
* The 4.0.0 mobile frames 15–18 (shell drawer, list-management/workbench/access/picker at 375 px) belong to the 4.0.0 flows, not SL9.
