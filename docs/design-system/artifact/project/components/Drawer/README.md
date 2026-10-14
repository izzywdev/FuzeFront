Slide-in navigation drawer for mobile (<768px). Opens from the left at
`--drawer-width` (280px). The header slot carries the fuse-seam bottom
border matching the desktop SidePanel identity. Focus is trapped inside;
Escape and backdrop tap call `onClose`.

**Props**

- `open` — When false the drawer is unmounted entirely.
- `onClose?` — Called when user taps the backdrop or presses Escape.
- `header?` — Content rendered in the drawer header (e.g. BrandMark + org name). The fuse-seam gradient replaces the header's bottom border.
- `footer?` — Content pinned to the bottom of the drawer (e.g. user avatar + email). Receives `padding-bottom: env(safe-area-inset-bottom)` automatically.

See `components/index.d.ts` for the full prop contract.
