The content wrapper for a hero `<section>` that also carries absolutely-positioned decorative layers (gradient overlays, blurred glow blobs, a `hero-pattern` background) — replaces the duplicated `<Container size="…" className="relative text-center">` pattern across the marketing site's hero sections.

```jsx
<section className="relative overflow-hidden bg-gradient-to-br from-secondary-900 to-secondary-800 pt-28 pb-20">
  <div className="absolute inset-0 hero-pattern opacity-20" />
  <div className="absolute top-10 left-1/4 w-80 h-80 bg-primary-600/20 rounded-full blur-3xl pointer-events-none" />

  <HeroContent size="4xl">
    <h1>About FuzeOne</h1>
    <p>We're building the operating system for SaaS.</p>
  </HeroContent>
</section>
```

Wraps `Container`, so `size`/`gutter`/`as` behave identically to `Container` — pick the hero's max-width and horizontal gutter the same way. `position: relative` is what lets the content stack correctly next to the hero's absolutely-positioned decoration siblings; `text-align: center` centers the hero heading/copy. Both come from `style`, not raw `relative`/`text-center` Tailwind utility classNames.
