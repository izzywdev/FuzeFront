---
title: Design System
description: How to build on the FuzeFront "fuse seam" design system with tokens and primitives, and what to do when one is missing.
audience: developer
order: 4
owner: "@izzywdev"
lastReviewed: 2026-10-26
status: published
---

# Design System

FuzeFront publishes the **"fuse seam" design system** as `@fuzefront/design-system`. It is the single source of truth for color, spacing, type, and primitives across the whole Fuze family. Your app extends it; it does not fork or redefine it.

## What it contains

The package lives in `design-system/` in the repository. Its public surface is `index.js` plus `styles.css`, with token files under `tokens/`:

| File | Defines |
|---|---|
| `tokens/colors.css` | Brand ramps and semantic tokens (`--bg-primary`, `--text-primary`, `--accent-color`, `--border-color`, ...) for dark (default) and light themes |
| `tokens/spacing.css` | Spacing scale (`--space-1` through `--space-24`), radii, shadows, layout and motion tokens |
| `tokens/typography.css` | Font families, scale, weights, line heights |
| `tokens/fonts.css` | Space Grotesk, Inter, JetBrains Mono |
| `tokens/base.css` | Element defaults, focus ring, reduced-motion handling |

Components are grouped as `brand`, `core` (Button, Badge, Avatar, IconButton), `shell`, `launcher`, `feedback`, `forms`, and `access`. See `design-system/readme.md` for the full list.

## Use it

Install the package from GitHub Packages (see [Overview](overview.md) for the scoped `.npmrc`). It declares `react` and `react-dom` `^19.0.0` as peers, so React 18 will not resolve. Import the stylesheet once, and import components from the public surface only:

```tsx
import '@fuzefront/design-system/styles.css'
import { Button } from '@fuzefront/design-system'

export default function Panel() {
  return <Button>Save</Button>
}
```

Do not import from component internals; they are not a stable API. Theme is switched with `data-theme="dark"` or `data-theme="light"` on the document, which the shell controls.

## Rules

- **Tokens only.** No raw hex colors, no raw `px` spacing, no ad hoc font stacks in feature code. Use `var(--space-4)`, `var(--text-secondary)`, and the other tokens.
- **Compose, do not redefine.** Build screens by composing primitives. Add your own tokens or components in your repo's own design-system package, which extends the base.
- **Never restyle a primitive in place.** If `Button` almost fits, that is a gap in the base, not a reason to override it.
- **Technical values use the mono font.** App IDs, scopes, and `remoteEntry` URLs render in `--font-mono`, which signals real, addressable infrastructure.

```css
.card {
  padding: var(--space-4);
  border: var(--border-width) solid var(--border-color);
  border-radius: var(--radius-lg);
  background: var(--bg-tertiary);
  color: var(--text-primary);
}
```

## When a primitive is missing

Do not paste a one-off style. Propose the missing primitive for the base package so every product benefits. In this repo `design-system/` has a single owner (the frontend engineer role), and changes go through the design-system skill and a pull request; downstream repos should describe the primitive and the screens that need it to the platform team rather than working around the gap. A merge to `design-system/**` on master triggers propagation to dependent surfaces.

A new screen also needs an approved design before UI code is written: FuzeFront treats navigable HTML frames under `design/frames/<feature>/` as the design source of truth, and a CI gate blocks feature UI whose covering flow is not approved.

## Verify

The repository carries lint rules in `design-system/_adherence.oxlintrc.json` that flag raw hex and pixel values, off-brand fonts, and imports from component internals. The file is not shipped in the published package, so copy it into your own CI to catch drift before review.

Related: [The Module Federation contract](module-federation-contract.md). The host bundles the design system directly instead of putting it in the federation shared scope (see the comment in `frontend/vite.config.ts`), so your remote bundles its own copy of the tokens and components. Only React and React DOM are shared singletons. See also [Troubleshooting](troubleshooting.md).
