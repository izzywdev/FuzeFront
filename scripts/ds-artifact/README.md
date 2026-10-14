# Design System artifact producer

`build-artifact.mjs` (in `scripts/ds-artifact/`) regenerates the **"FuzeFront Fuse Seam"**
Design System artifact from the `design-system/` package — which it reads as a read-only
input, it is not part of that published npm package — into a committed, reviewable mirror at
`docs/design-system/artifact/project/**`. That mirror is the exact file set that backs
the published artifact at
<https://claude.ai/artifact/THhAZqv58N16ehQrq1xSXk> (Anthropic "Design System" artifact
type): `tokens.json`, `README.md` (brand book), `design-system.json` (index), and a
`components/<Comp>/{README.md,preview.html}` pair for every primitive.

## Why a producer (not a hand-maintained doc)

The artifact is a **derived view of the code**. Keeping it by hand guarantees drift:
a token hex changes, a component is added or renamed, and the "design system" silently
describes something that no longer ships. The producer makes the artifact a pure
function of the source, and `gate-ds-artifact` (CI) enforces that the committed mirror
always equals the producer's output. See `CLAUDE.md` → "Design system — FuzeFront IS the
base" and "FIX is the rule".

## What is parsed vs. curated

| Output | Source | Parsed / curated |
|---|---|---|
| `tokens.json` color values | `tokens/colors.css` (`:root` + `[data-theme=dark]` / `[data-theme=light]`) | **parsed** — hex/rgba/`var()`→alias, per theme |
| `tokens.json` spacing / radius / z-index values | `tokens/spacing.css` | **parsed** |
| `tokens.json` shadow geometry | `tokens/spacing.css` | **parsed** (ink inlined — the artifact grammar bans `var()` in shadows) |
| `tokens.json` type families | `tokens/typography.css` (`--font-*`) | **parsed** |
| token **order + usage notes**, the type **groups/scale**, which tokens are public | this script | **curated** (the one place these editorial choices live) |
| `components/<Comp>/README.md` | `<Comp>.prompt.md`, else the `<Comp>.d.ts` leading JSDoc | **derived** |
| `components/<Comp>/preview.html` | `previews/<Comp>.html` (beside this script) if present, else a generated usage specimen | **override or derived** |
| `components/index.d.ts` | every component `<Comp>.d.ts` | **concatenated** |
| `components/Cover/preview.html` | `templates/cover.html` (beside this script) | **authored** |

Values track the code; prose, ordering and the type grouping are curated here so that a
reviewer sees them in the diff. Add a token to the CSS **and** its entry to the curated
list in this script; the producer throws if a listed token is missing from the CSS, so
the two cannot silently diverge.

Rich, hand-authored previews live in `scripts/ds-artifact/previews/<Comp>.html` (currently
BrandMark, SeamDivider, Button, Badge, StatusPill, Input, AppCard, HealthDot). Any
component without an override gets a static usage specimen built from its `.prompt.md`.
To upgrade a component's card, drop a `<Comp>.html` here (line 1 must be the
`<!-- @dsCard group="…" height=N -->` marker) and re-run.

## Run it

```bash
npm run ds:artifact        # regenerate docs/design-system/artifact/project/**
npm run check:ds-artifact  # CI drift gate — exits 1 if the mirror is stale
```

Zero runtime dependencies (Node ≥ 24 built-ins only), so CI runs it with bare `node`.
Output is deterministic: no wall-clock or commit SHA is embedded, and the index's
`createdOnFiles` stamp is preserved across regenerations.

## When it runs — the SDLC wiring

1. **Authoring.** `frontend-engineer` (the sole editor of `design-system/`) changes a
   token or component, runs `npm run ds:artifact`, and commits the regenerated mirror in
   the **same PR**.
2. **Pre-merge gate.** `.github/workflows/gate-ds-artifact.yml` runs `check:ds-artifact`
   on every PR and on push to master. Drift fails the PR, so it cannot merge — master's
   mirror is correct by construction. (To make it a hard block, an org owner adds the
   `gate-ds-artifact` context to the "Protect Master" ruleset and registers it in
   `governance/required-check-triggers.json`; the workflow is already unconditional, so
   that is safe.)
3. **Post-merge propagation.** `ds-propagate.yml` already fires on push to master
   touching `design-system/**`; this producer is the pre-merge half of that loop.

## Publishing to the live artifact

The committed mirror is the source for the published claude.ai artifact. To refresh it,
publish `docs/design-system/artifact/project/**` to the artifact URL above with the
Anthropic Artifact tooling (`root` = `docs/design-system/artifact`, index =
`project/design-system.json`). This step needs claude.ai artifact write access and is
run by a maintainer (or a Claude Code session), not CI.
