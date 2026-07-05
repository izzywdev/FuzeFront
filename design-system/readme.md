# FuzeFront — Design System

**FuzeFront** is a Module-Federation **host shell**: a dark-default dashboard that discovers, mounts and fuses remote micro-frontends ("apps") into one runtime experience. This is the **brand & UI design system** for that shell — the colors, type, tokens and components needed to design and build on-brand interfaces for it.

---

## Brand concept — "runtime fabric / the fuse seam"

The product's defining act is *fusing remote modules into the shell at runtime*. The whole system is built around that idea:

- **The seam.** A glowing indigo→cyan gradient (`--seam`) marks every place the host shell joins the content it hosts: the underline beneath the top bar, the left edge of the active nav item, the top of an app card on hover, the auth-card cap, and the `"Fuze"` half of the wordmark. It is the signature motif — use it where the fabric "joins".
- **The fuse.** Electric indigo `#6e5cff` paired with a cyan signal `#29d3e6` — brand + signal, the two ends of the seam.
- **The shell.** A deep blue-graphite surface set, layered from the deepest shell (`--bg-secondary`) up through canvas, panels and raised surfaces. **Dark is the default**; light is a cool, instrument-grade override.
- **The machine's voice.** Technical data that defines this product — app IDs, scopes, `remoteEntry` URLs — is always set in **JetBrains Mono** (`--font-mono` / `.mono`). It signals "this is real, addressable infrastructure."

## Foundations

`styles.css` is the **single entry point** — link it and you get everything:

```html
<link rel="stylesheet" href="design-system/styles.css" />
```

It imports the token layers from `tokens/`:

| File | What it defines |
|---|---|
| `tokens/fonts.css` | The webfont import — Space Grotesk, Inter, JetBrains Mono (all free, Google Fonts) |
| `tokens/colors.css` | Brand primitives (indigo/cyan/graphite ramps) + the **semantic tokens** components consume, for both `dark` (default) and `light` themes |
| `tokens/typography.css` | Families, weights, the type scale, line-heights, tracking, and semantic role tokens |
| `tokens/spacing.css` | Spacing (4px base), radii, shadows, layout and motion tokens |
| `tokens/base.css` | Element defaults: body/heading fonts, `.mono`, on-brand `:focus-visible`, reduced-motion |

The semantic tokens (`--bg-tertiary`, `--accent-color`, `--text-primary`, `--seam`, …) match the FuzeFront app 1:1, so anything built here drops straight into `frontend/src`. Theme is switched on the document with `data-theme="dark"` / `data-theme="light"`.

- **Type.** Display = **Space Grotesk** (headings, hero, the wordmark; tight `-0.02em` tracking). Body/UI = **Inter**. Data = **JetBrains Mono**.

## Components

`components/<group>/<Name>.jsx` — each a self-contained React component styled entirely with tokens (inline style objects, no Tailwind, no app imports), shipped with a `.d.ts` prop contract and a `.prompt.md` usage note.

| Group | Components |
|---|---|
| `brand` | BrandMark, SeamDivider |
| `core` | Button, Badge, Avatar, IconButton |
| `shell` | TopBar, MenuItem, UserMenu, ThemeToggle |
| `launcher` | AppCard, HealthDot, IntegrationBadge |
| `feedback` | Toast, StatusPill |
| `forms` | Input, Select |
| `access` | RoleBadge |

Import from the generated surface, not component internals:

```jsx
import { Button, AppCard, BrandMark } from './design-system'
```

## Guidelines & specimens

`guidelines/*.card.html` and `components/<group>/<group>.card.html` are standalone HTML "cards" — visual specimens of the colors, type, spacing and components. Open any one directly in a browser (they link `styles.css`).

## Build

`build.mjs` regenerates the machine-readable artifacts by scanning the folder:

```bash
node design-system/build.mjs
```

It writes `_ds_manifest.json` (components, cards, tokens, css entry points) and `index.js` (the public ESM re-export surface). If `esbuild` is installed (`npm i -D esbuild`), it additionally emits `_ds_bundle.js` (an IIFE bundle with React external). Re-run it whenever you add a component or card.

`_adherence.oxlintrc.json` carries lint rules that keep usage on-brand (no raw hex/px, only the three brand fonts, import from the public surface).
