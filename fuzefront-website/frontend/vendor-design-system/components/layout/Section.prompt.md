Full-bleed page-section wrapper — replaces the recurring `className="py-{16,20,24} bg-white border-t border-secondary-100"` block duplicated across marketing pages (ds-fp:1b68ad502744). Puts a `<Container>` (or any other wrapper) inside it for horizontal centering/width; `Section` owns only the vertical rhythm, background tone, and optional top divider.

```jsx
<Section padding="lg" divider>
  <Container size="4xl">
    <h2>Leadership</h2>
    {/* ... */}
  </Container>
</Section>

<Section padding="sm" divider>
  <div className="max-w-2xl mx-auto px-4 text-center">
    <p>For all press inquiries, contact …</p>
  </div>
</Section>

<Section tone="muted">
  <Container size="5xl">{/* ... */}</Container>
</Section>
```

`tone` is `surface` (default — `--bg-tertiary`, white in light theme), `muted` (`--bg-primary`, tinted canvas), or `transparent` (no background set, inherits the page's). `padding` maps to the spacing scale: `sm` (--space-16, 64px), `md` (--space-20, 80px), `lg` (--space-24, 96px, default). `divider` adds a top border in `--border-color` (`border-block-start`, so it mirrors under RTL) — off by default. `as` renders a different element (default `section`). All standard attributes (`id`, `aria-*`, `data-*`) pass through.
