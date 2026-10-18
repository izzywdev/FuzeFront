`StatusCallout` — a FuzeFront design-system `feedback` primitive, styled entirely with tokens.

**Props**

- `tone?` — Severity tone. Drives the tint, border, icon color, and default a11y role.
- `icon?` — Decorative leading glyph/icon rendered in a soft chip (aria-hidden).
- `title?` — Emphasized title line.
- `actions?` — Action row (buttons/links) rendered under the body.
- `role?` — Override the ARIA role (defaults: `alert` for error, `status` otherwise).

See `components/index.d.ts` for the full prop contract.
