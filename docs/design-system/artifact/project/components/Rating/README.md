`Rating` — a FuzeFront design-system `feedback` primitive, styled entirely with tokens.

**Props**

- `value?` — Numeric score, e.g. 4.5. Used to fill stars proportionally.
- `count?` — Review count label (e.g. 128). Omit to suppress the count.
- `variant?` — "row" = inline stars + score; "pill" = compact rounded badge.
- `starCount?` — Number of stars to render. Defaults to 5.

See `components/index.d.ts` for the full prop contract.
