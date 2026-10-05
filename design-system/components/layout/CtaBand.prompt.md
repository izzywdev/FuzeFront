The closing call-to-action band that caps a marketing page — a top-bordered, full-bleed surface with generous vertical padding and a centered, width-capped content column underneath (heading + copy + action buttons).

```jsx
<CtaBand>
  <h2>Ready to get started?</h2>
  <p>Try free for 14 days. No credit card required.</p>
  <Wrap gap={4} justify="center">
    <a className="btn-primary" href="/signup">Get started</a>
    <a className="btn-secondary" href="/pricing">Compare plans</a>
  </Wrap>
</CtaBand>

<CtaBand maxWidth="2xl">
  <h2>Ready to get started with {product.name}?</h2>
</CtaBand>
```

`maxWidth` (`2xl | 3xl | 4xl | 5xl | 6xl | 7xl | full`, default `3xl`) picks the content column's cap from Container's token scale — the shorter product-detail CTA uses `2xl`. The band itself never sets any Tailwind-era `py-20 bg-white border-t border-gray-100` class; the surface is tokens-only (`--space-20`, `--bg-tertiary`, `--border-color`).
