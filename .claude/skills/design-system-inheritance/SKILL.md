---
name: design-system-inheritance
description: Use when building or reviewing UI in a consuming app. Enforces that the app extends FuzeFront's base design system (@fuzefront/design-system) rather than forking it, and that feature code uses only inherited tokens/components.
---

# design-system-inheritance

The base "fuse seam" design system lives in FuzeFront as `@fuzefront/design-system` (single source for color/spacing/type/primitives). Consuming apps **extend**, never fork.

## Rules
- The app declares a **local DS package** (`designSystem.extendsAs` in the manifest, e.g. `@fuzex/design-system`) that **imports** base tokens and **composes** base components. It adds app-specific tokens/components; it never redefines a base primitive.
- Feature code imports from the local DS (which re-exports the base) — **never raw hex/rgb, raw px spacing, or one-off type**.
- Responsive breakpoints, a11y, and RTL come from the base.
- Only `frontend-engineer` edits `design-system/`. FuzeFront's frontend-engineer owns the base; each app's owns its extension.

## CI check
A gate fails the build if feature code (outside the DS package) contains raw design values (`#hex`, `rgb(`, hard-coded `px` spacing, raw font sizes) or imports a base primitive directly instead of via the local DS. Keep the check in the repo's CI; it is part of `sdlc-bootstrap` for apps.
