# `design/frames/_template/` — scaffold for a feature's approval frames

Copy this directory to `design/frames/<feature-slug>/` and replace the placeholders.
**Reference implementations:** [`design/frames/billing-invoices/`](../billing-invoices/) (smallest
complete example) and [`design/frames/password-reset/`](../password-reset/) (multi-flow, per-flow
approval). Match them; don't invent a second convention.

`_template` is scaffolding, not a feature: the leading `_` excludes it from `scripts/stamp-frames.mjs`
(`discoverFeatures()` skips `_`/`.`-prefixed directories) and from the published frames index
(`scripts/build-frames-site.mjs`), so it never appears as something awaiting review and never needs
a stamp of its own.

## Who owns this

`design/frames/<feature>/**` is authored **only** by the **`product-designer`** agent, from product
requirements and user stories. A `frontend-engineer` authoring the frames is the bias problem
`contract-designer` exists to prevent on the backend: the implementer must not write the spec they
are measured against.

Frames are always **their own PR, and its only content**.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Navigable entry point. Links every frame **and renders the build inventory**. |
| `frame.html` | Scaffold for one frame — copy to `01-<flow>.html`, `02-states.html`, … |
| `tokens.css` | fuse-seam token subset, inlined so frames are self-contained/portable. Copy verbatim — every feature on master uses byte-identical `tokens.css`. |
| `manifest.json` | The approval + build contract. |
| `manifest.schema.json` | The JSON Schema describing `manifest.json`. Reference documentation — not copied per-feature. |

A feature may add one extra stylesheet (e.g. `frame.css`, `auth.css`) for shared frame chrome when
several frames repeat the same layout — see `api-tokens/frame.css`. Feature-specific `DESIGN.md`
notes are also fine (`federated-apps`, `locked-app-mode`).

## Steps

1. `cp -r design/frames/_template design/frames/<feature-slug>` — then delete `README.md` and
   `manifest.schema.json` from the copy (the schema is referenced, not duplicated per feature).
2. Rename `frame.html` → `01-<flow>.html`, `02-states.html`, … in flow order, and update the links
   and cards in `index.html`.
3. Fill `manifest.json`: `name`, `description`, `frames[]`, `contract`, `build`.
4. **Stamp it** — `node scripts/stamp-frames.mjs --write --feature <feature-slug>` — and commit the
   stamp.
5. Open the frames-only PR. `gate-frames-stamped` must be green.

## The rules that are load-bearing

- **States are contract, not decoration.** Cover loading / empty / error *and* the real fail-closed
  cases (e.g. unlink-last-method → 409; `hasPassword: null` → "set a password first"). Frames
  showing only the happy path produce UI that only handles the happy path.
- **The build inventory is approved with the frames.** `build.flows/components/packages` is the
  architectural contract — approving the frames approves the component/package plan, so the
  implementation can't quietly build something else. Keep `index.html`'s inventory and
  `manifest.json`'s `build` in agreement.
- **Design-system-first.** Tokens only — no raw hex/spacing/type. A missing primitive gets **added
  to the design system** by `frontend-engineer`, never one-offed in a frame. Name the gap in the
  manifest (`build.designSystemAdditions`) so it becomes a foundation PR.
- **`testHooks` are the seam to QA.** The `data-*` selectors here are what Playwright drives, and
  merging approved frames triggers **RED** specs (TDD) before implementation exists. Keep the
  frame's hooks and the manifest's `testHooks` identical.
- **Feature flags default OFF** — target the **builders audience** (owner + QA synthetic accounts),
  or prod-smoke can never see the feature and its e2e can never go green.

## The stamp (why `--check` exists)

`stamp` is a content hash of `design/frames/<feature>/**`, **derived** by
`scripts/stamp-frames.mjs` — never hand-written, and stored as bare lowercase sha256 hex. It makes
an approval provably bind to the exact frames the approver saw: if the frames change afterwards, the
stamp no longer matches and the approval doesn't silently carry over to frames nobody looked at.

`gate-frames-stamped` recomputes it in CI (`node scripts/stamp-frames.mjs --check`). Without that
recomputation the stamp would be just another hand-maintained mirror — the drift pattern behind
several defects in this repo.

```bash
node scripts/stamp-frames.mjs --check                      # every feature
node scripts/stamp-frames.mjs --check --feature <feature>
node scripts/stamp-frames.mjs --write --feature <feature>
node scripts/stamp-frames.mjs --json                       # {feature: stamp}, no writes
```

Re-run `--write` after **any** edit to the feature dir, and commit the result.

The approval bookkeeping keys (`approved` / `approvedBy` / `approvedAt`) are **excluded** from the
hash at every level, so approving a flow does not change the stamp that approval binds to.

## Approval

Approval is **per flow**: `approved` / `approvedBy` / `approvedAt` live on each `build.flows[]`
entry, so approving one flow unblocks that flow's implementation while the others iterate. The
`design-approval` workflow writes them onto the **frames PR head branch, never `master`**
(`master` is deploy-on-push + review-required). Don't hand-edit them.

**Reject ≠ close** — a rejection re-dispatches `product-designer` for an improving iteration.
