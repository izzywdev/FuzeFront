`PasswordChecklist` — a FuzeFront design-system `forms` primitive, styled entirely with tokens.

**Props**

- `value?` — Current password value being validated.
- `rules?` — Policy rules to display; defaults to {@link DEFAULT_PASSWORD_RULES}.
- `title?` — Heading shown above the list; pass "" to hide.
- `columns?` — Lay the rules out in this many grid columns (default 1).
- `highlightUnmet?` — Tint still-unmet rules with the error colour (e.g. after a rejected submit). Default false.
- `metLabel?` — Visually-hidden suffix announced for a met rule (default " — met"). Localize it.
- `unmetLabel?` — Visually-hidden suffix announced for an unmet rule (default " — not met"). Localize it.

See `components/index.d.ts` for the full prop contract.
