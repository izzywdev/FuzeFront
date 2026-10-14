# FuzeFront Design System — the "Fuse Seam"

FuzeFront publishes the base design system for the whole Fuze family — the single source
of truth for color, spacing, type and primitives. This page is the entry point to it.

- **Source of truth (code):** [`design-system/`](../../design-system/) — the `@fuzefront/design-system`
  package (tokens as CSS custom properties, components as token-styled React).
- **Published artifact:** <https://claude.ai/artifact/THhAZqv58N16ehQrq1xSXk> — the
  navigable "FuzeFront Fuse Seam" design system (Anthropic Design System artifact type).
  *Private — ask the owner for access.*
- **Committed mirror:** [`artifact/project/`](./artifact/project/) — the exact file set
  that backs the published artifact, generated from the code and kept in sync by CI.

## How it stays honest

The artifact is a **derived view of the code**, not a parallel document. A producer
regenerates it from `design-system/`, and a CI gate fails any PR whose committed mirror
has drifted from what the producer renders:

```
design-system/tokens/*.css  ─┐
design-system/components/**  ─┤ node design-system/producer/build-artifact.mjs
                              └─▶ docs/design-system/artifact/project/**  ──▶ published artifact
                                        ▲
                     gate-ds-artifact (CI): regenerate + diff, fail on drift
```

| Piece | Where |
|---|---|
| Producer | [`design-system/producer/build-artifact.mjs`](../../design-system/producer/) (+ its `README.md`) |
| Commands | `npm run ds:artifact` (write) · `npm run check:ds-artifact` (drift check) |
| CI gate | [`.github/workflows/gate-ds-artifact.yml`](../../.github/workflows/gate-ds-artifact.yml) — every PR + push to master |
| Post-merge | [`ds-propagate.yml`](../../.github/workflows/ds-propagate.yml) — on master changes to `design-system/**` |

### When regeneration happens (SDLC points)

1. **Authoring** — change a token or component in `design-system/`, run
   `npm run ds:artifact`, commit the regenerated mirror in the same PR.
2. **Pre-merge** — `gate-ds-artifact` runs `check:ds-artifact` on every PR; drift cannot
   merge, so `master` is always correct.
3. **Publish** — a maintainer pushes `docs/design-system/artifact/project/**` to the
   artifact URL above (needs claude.ai artifact write access).

> Only `frontend-engineer` edits `design-system/` (per `CLAUDE.md`). The mirror under
> `artifact/` is **generated** — never hand-edit it; change the source and re-run the
> producer. To make the gate a hard block, an org owner adds `gate-ds-artifact` to the
> "Protect Master" ruleset and `governance/required-check-triggers.json`.

## What's inside

67 primitives across 13 groups (brand, core, shell, launcher, feedback, forms, access,
data, layout, mobile, navigation, overlay, billing), the full token system (color in
`dark`/`light` themes, type, spacing, radius, shadow, z-index), and the brand book. See
[`artifact/project/README.md`](./artifact/project/README.md).
