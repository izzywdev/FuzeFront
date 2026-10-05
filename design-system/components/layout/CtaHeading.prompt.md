The bold, centered heading inside a page's closing call-to-action band — "Don't see your industry?", "Not sure where to start?". Replaces the recurring ad-hoc `className="text-3xl font-heading font-bold text-gray-900 mb-4"` duplicated across `IndustriesPage` and `ProductsPage`.

```jsx
<CtaHeading>Don't see your industry?</CtaHeading>

<CtaHeading as="h1" space="sm">Not sure where to start?</CtaHeading>
```

Same bold/centered `--font-display` heading family as `SectionTitle`, but fixed at a single size — a CTA-band heading does not step up at the `sm` breakpoint the way a full section opener does, so it reads from its own `--role-cta-heading-*` tokens instead. `as` picks the heading level (`h2`, default). `align` defaults to `center` since every known call site renders centered; pass `left` for a non-centered variant. `space` picks the bottom-margin step: `none` | `sm` (`--space-2`) | `md` (default, `--space-4`, matching the extracted `mb-4`).
