Full-bleed content band used to zebra-stripe a long scrolling marketing page — replaces the recurring `className="py-{N} bg-secondary-{N2} ..."` pattern found across About/Careers/Home/Industries/Press/Pricing/Products/ProductDetail/FuzeHub.

```jsx
<Section tone="muted" spacing="lg">
  <Container>…stats grid…</Container>
</Section>

<Section tone="inverse" spacing="md" border="top">
  <Container>…closing CTA…</Container>
</Section>
```

`tone` picks the flat background from the site's token scale: `base` (white), `muted` (secondary-50, default — the light alternate band), `inverse` (secondary-900, the dark-shell band), `inverseMuted` (secondary-800). `spacing` maps to vertical padding: `xs` (py-12), `sm` (py-16), `md` (py-20), `lg` (py-24, default). `border` adds the tone-paired rule: `none` (default), `top`, or `y`. `as` swaps the rendered element (default `section`). Not for hero/gradient sections — those keep their own `overflow-hidden` + `bg-gradient-to-br` markup.
