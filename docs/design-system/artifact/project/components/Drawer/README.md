`Drawer` — a FuzeFront design-system `mobile` primitive, styled entirely with tokens.

**Props**

- `open` — When false the drawer is unmounted entirely.
- `onClose?` — Called when user taps the backdrop or presses Escape.
- `header?` — Content rendered in the drawer header (e.g. BrandMark + org name). The fuse-seam gradient replaces the header's bottom border.
- `footer?` — Content pinned to the bottom of the drawer (e.g. user avatar + email). Receives `padding-bottom: env(safe-area-inset-bottom)` automatically.

See `components/index.d.ts` for the full prop contract.
