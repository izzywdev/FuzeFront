Bottom sheet — mobile equivalent of Modal. Slides up from the bottom of the
screen, capped at `--sheet-max-h` (80dvh). The fuse-seam gradient appears
below the drag handle. Focus is trapped; Escape and backdrop tap call `onClose`.

Use on xs/sm screens (<768px). Prefer Modal on md+.

**Props**

- `open` — When false the sheet is unmounted entirely.
- `onClose?` — Called when user taps the backdrop or presses Escape.
- `title?` — Sheet heading — wired to `aria-labelledby`.

See `components/index.d.ts` for the full prop contract.
