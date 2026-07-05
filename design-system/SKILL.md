---
name: fuzefront-design
description: Use this skill to generate well-branded interfaces and assets for FuzeFront (the Module-Federation host shell / dashboard), for production or throwaway prototypes/mocks. Contains design guidelines, colors, type, fonts, tokens, and a component library for prototyping.
user-invocable: true
---

Read the `readme.md` file within this skill, and explore the other available files.

This is the design system for **FuzeFront** — a Module-Federation **host shell** that fuses remote micro-frontends into one dark-default dashboard at runtime.

- **Brand concept — "the fuse seam":** a glowing indigo→cyan gradient (`--seam`) marks where the shell joins hosted content (top-bar underline, active nav edge, app-card hover, the `"Fuze"` wordmark). Electric indigo `#6e5cff` + cyan `#29d3e6`. Dark is the default; light is a cool override.
- **Foundations:** `styles.css` is the single entry point (links the `tokens/` CSS — colors, type, spacing, fonts, base). Type: Space Grotesk (display/brand), Inter (body), JetBrains Mono (technical data — IDs, scopes, remoteEntry URLs). The semantic tokens match the FuzeFront app 1:1.
- **Components:** `components/<group>/<Name>.jsx` with a `.d.ts` contract and `.prompt.md` usage note (groups: brand, core, shell, launcher, feedback, forms, access). Styled entirely with tokens, no app imports. Public surface is the generated `index.js`.
- **Guidelines & specimens:** `guidelines/*.card.html` and `components/<group>/<group>.card.html` are standalone HTML cards demonstrating colors, type, spacing and every component — open them in a browser.
- **Build:** `node design-system/build.mjs` regenerates `_ds_manifest.json` and `index.js` (and `_ds_bundle.js` if esbuild is installed).

When designing: never hardcode colors, px or fonts — use the tokens (`var(--…)`). Set technical data in `--font-mono`. Reach for the seam where the runtime fabric "joins". Keep the dark theme primary.

If creating visual artifacts (slides, mocks, throwaway prototypes), produce static HTML files that link `styles.css` for the user to view. If working on production code, follow the rules here and reuse the components to design fluently in the brand.

If the user invokes this skill without other guidance, ask them what they want to build, ask a few clarifying questions, and act as an expert designer who outputs HTML artifacts *or* production code, depending on the need.
