The dark secondary-900 -> secondary-800 diagonal-gradient hero wrapper used at the top of marketing sub-pages — replaces the recurring `className="bg-gradient-to-br from-secondary-900 to-secondary-800 pt-28 pb-{16,20} relative overflow-hidden"` pattern duplicated across the Industries, Pricing and Products pages.

```jsx
<PageHeroBand>
  <div className="absolute inset-0 hero-pattern opacity-20" />
  <Container size="4xl" className="relative text-center">
    <h1>Built for every industry</h1>
  </Container>
</PageHeroBand>

<PageHeroBand spacing="compact">
  {/* Pricing's hero used pb-16 instead of the default pb-20 */}
</PageHeroBand>
```

Top padding is always `--space-28` (112px); `spacing` picks the bottom padding — `"default"` (`--space-20`, 80px) or `"compact"` (`--space-16`, 64px). `gradient={{ from, to }}` overrides the two gradient stops for a page that wants the same shape with a different tone. Polymorphic via `as` (default `"section"`), and forwards `ref` for a caller's own `useInView`/`useRef` enter-animation. Deliberately does not render the hero-pattern overlay, the inner `Container`, or the heading itself — those remain the caller's children, same as before this extraction.
