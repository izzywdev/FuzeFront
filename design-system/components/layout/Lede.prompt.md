The centered intro/subtitle paragraph under a page or section heading — replaces the recurring ad-hoc `className="text-lg text-secondary-300 max-w-2xl mx-auto mb-{8,10}"` pattern duplicated across `FuzeHubPage`, `IndustriesPage`, and `ProductsPage`.

```jsx
<h1 className="text-4xl sm:text-5xl font-heading font-extrabold text-white mb-4">
  Built for every industry
</h1>
<Lede spacing="sm">
  FuzeOne adapts to the compliance, security, and operational requirements of your vertical.
</Lede>
```

`tone`: `onDark` (default, `text-secondary-300` — for a hero/gradient dark background) | `onLight` (`text-gray-600` — for a white/light section intro). `size`: `base` (default, `text-lg`) | `responsive` (`text-lg sm:text-xl`). `maxWidth`: `xl` | `2xl` (default) | `3xl`, mapped to `max-w-*`. `spacing` (bottom margin): `none` | `sm` (`mb-6`) | `md` (default, `mb-8`) | `lg` (`mb-10`). `leading` adds `leading-relaxed`. `as` swaps the rendered element (default `p`). Independent of `Container` — `Container` centers a whole section's content width, `Lede` narrows just this one paragraph beneath it.
