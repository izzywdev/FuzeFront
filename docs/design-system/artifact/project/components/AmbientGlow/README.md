A soft, blurred background "glow orb" for marketing/hero backdrops and empty
states — the ambient light behind a hero section. Position it with `style`
(top/left/right/bottom/transform) on a `position: relative` (or similarly
positioned) parent; `AmbientGlow` itself only owns the glow, not placement.

```jsx
<section style={{ position: 'relative', overflow: 'hidden' }}>
  <AmbientGlow tone="primary" size={320} style={{ top: '2.5rem', left: '25%' }} />
  <AmbientGlow tone="accent" size={288} opacity={0.15} style={{ bottom: 0, right: '25%' }} />
  {/* ...hero content... */}
</section>

{/* centered, rectangular, low-intensity */}
<AmbientGlow
  tone="primary"
  width={600}
  height={400}
  opacity={0.1}
  style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}
/>
```

Props: `tone` (`primary` | `accent` — maps to `--accent-color` / `--accent-2`),
`size` (px, square side), `width`/`height` (px, override `size` for a
non-square glow), `blur` (px, default 64), `opacity` (0–1, default 0.2).
Always `pointer-events: none` and `aria-hidden` (purely decorative) — never
intercepts input or screen-reader focus; pass `aria-hidden={false}` to
override in the rare case the glow carries meaning.
