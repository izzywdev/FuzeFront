---
name: design-system-conformance
description: Use when creating or reviewing UI / a design system. Enforces tokens-only (no raw hex/px/font), reuse-over-reinvent, and detecting code that should be EXTRACTED into a new DS primitive. The procedure behind gate-ds-conformance.
---

# design-system-conformance

Use when building or reviewing **any** UI. Pairs with `design-system-inheritance`: inheritance says *extend the base, don't fork*; conformance says *use the tokens, don't reinvent, extract the duplicates*. This is the procedure behind the CI gate `gate-ds-conformance` (CLAUDE.baseline.md §6).

## Tokens-only rule
Feature code carries **no raw design values**. The gate hard-fails, in any UI file outside the DS package:
- raw color literals: `#hex`, `rgb()/rgba()`, `hsl()/hsla()`
- hard-coded spacing/sizing/type in `px` outside the token scale (`padding/margin/gap/width/height/font-size/line-height/border-radius: 12px`)
- raw `font-family` strings

Every color/spacing/type/radius comes from a **DS token** (`var(--ds-*)`, `tokens.*`, `theme.*`, `$token`, `@apply`). Two carve-outs the gate honors:
- The **DS package itself is excluded** (`design-system/`, `packages/design-system/`, `tokens/`) — that is where token *definitions* legitimately live.
- A rare, justified literal can be exempted with an inline escape comment containing `ds-conformance-disable` (also `-ignore`/`-allow`). Use sparingly; it is a documented exception, not an off-switch.

## Reuse over reinvent
Before writing a styled block, **search the DS for an existing primitive** and compose/extend it. Do not hand-roll a parallel button/card/field next to one the DS already ships. If what you need is missing, it belongs *in the DS* — see extraction below, not a one-off in feature code.

## Detecting EXTRACTION candidates
When the same ad-hoc styled block recurs across **>1 feature file** (≥ threshold, default 3), it should become a DS primitive. The gate fingerprints normalized styled blocks (whitespace/numbers stripped, so `p-4` and `p-6` collapse) and, on push to the default branch with `--emit-issues`, opens **one idempotent GitHub issue per candidate**:
- label `ds-extraction`, stable marker `ds-fp:<hash>` (de-dupes across open+closed issues), mentions `@claude`
- includes the recurring locations and a **proposed component spec**: props/variants/states/tokens + acceptance criteria.

**Responding to such an issue:** `frontend-engineer` (the **sole** editor of `design-system/`) adds the primitive to the DS package, **tokens-only**, with a11y + RTL + a unit test, then refactors every listed call site to consume it. Extraction is design work — the gate only signals it.

## CI gate
`gate-ds-conformance` **hard-fails** raw values (exit 1); extraction issues are **advisory** (non-fatal — exit 0). First pass per repo is report-only (`|| true`); ratchet to enforcing once feature code is clean. See `verification-protocol` for proving the gate actually ran green.

## Onboarding an existing repo into the Fuse design system (bidirectional)
When bringing an **already-built** repo onto the family DS, the model is **bidirectional** — the repo-local DS *extends* the base (down) **and** worthy local primitives *graduate* to the base (up). Owned by the repo's `frontend-engineer` (sole DS owner). Baseline §6.2.

1. **Build a repo-local DS if none exists.** Derive it from the repo's existing UI: harvest recurring colors/spacing/type into tokens and repeated blocks into components — run `gate_ds_conformance.py` (it surfaces both raw-value hotspots and the duplicated-block extraction candidates) to seed the inventory. This package becomes the repo's single styling source of truth.
2. **Up-propagate (graduate to the base).** For each local primitive that should be a **global Fuze-family primitive**, open a promotion candidate using the **same `@claude` extraction-issue mechanism** (`ds-extraction` label + `ds-fp` fingerprint, idempotent) — one issue per candidate — routed to **FuzeFront's** frontend-engineer to land it in the base `@fuzefront/design-system` via PR. (Drive this manually or by pointing the gate's detector at the repo; the issue body's proposed-spec format is identical.)
3. **Down-project (the base into the repo).** Make the repo-local DS **import and re-export / compose** the base tokens+primitives so the repo inherits the canonical look (unified Fuse experience) and keeps only its product-specific layer on top. Never copy or redefine a base primitive locally.
4. **Graduation contract — what graduates vs stays local:**
   - **Graduates** when generic/cross-product, free of product-specific business logic, and plausibly reused by ≥2 family repos (Button, Field, Modal, color/spacing/type tokens).
   - **Stays local** when product-specific (domain widget, one-app layout, app-branded composition). When in doubt, keep it local until a second consumer appears, then graduate.
   - `gate-ds-conformance` enforces **extends-not-forks**: shadowing/redefining a base primitive locally is a violation, not an extension — fix it upstream in the base or compose it, don't fork.

Net steady state: **repo-local = base (inherited, down-projected) + thin product layer; worthy product primitives graduate up to the base.** Keep the inheritance layering explicit so a base upgrade flows through without a fork to reconcile.

## Done checklist
- [ ] No raw `#hex` / `rgb()` / `hsl()` / `px` spacing-size-type / `font-family` in feature code — all values are DS tokens.
- [ ] Each escape (`ds-conformance-disable`) is a justified, documented exception — not a blanket bypass.
- [ ] Reused existing DS primitives; no parallel hand-rolled component beside one the DS already has.
- [ ] Any open `ds-extraction` issue triggered by this code is addressed (primitive added to DS + call sites refactored) or explicitly deferred.
- [ ] `gate-ds-conformance` is green (no hard violations); confirmed via the actual run, not assumed.
