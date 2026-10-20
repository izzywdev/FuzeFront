Wrap — a flex row that wraps onto multiple lines, spaced by a
`--space-*` token. Use for badge/tag groups and button rows that should
reflow on narrow viewports rather than overflow.

**Props**

- `gap?` — Spacing-scale step, mapped to `var(--space-<gap>)`. Defaults to `2`.
- `align?`
- `justify?`
- `as?` — Element/component to render as. Defaults to `"div"`.

See `components/index.d.ts` for the full prop contract.
