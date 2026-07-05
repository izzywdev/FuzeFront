The brand's signature "fuse seam" — a thin indigo-to-cyan gradient bar that marks where runtime modules fuse; use it under the top bar, atop cards, or as a glowing accent rule between sections.

```jsx
<SeamDivider />
<SeamDivider glow thickness={3} />
<SeamDivider opacity={0.5} />
<SeamDivider orientation="vertical" thickness={2} glow />
```

Props: `orientation` (`horizontal` | `vertical`), `thickness` (px, cross-axis), `opacity` (0–1), `glow` (boolean, adds a soft tinted halo). Painted entirely from `--seam` / `--accent-color` / `--accent-2`; renders as `role="separator"` with `aria-orientation`.
