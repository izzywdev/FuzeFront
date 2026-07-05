The host shell header — a fixed-height bar on the deepest surface (`--bg-secondary`) with a bottom border and the signature "fuse seam" gradient underline; `brand` sits on the left, `actions`/`children` on the right, with a flex spacer between.

```jsx
<TopBar brand={<Logo />} actions={<ThemeToggle theme="dark" />} />

<TopBar brand={<Logo title="FuzeFront" />}>
  <ThemeToggle theme="dark" />
  <UserMenu name="Izzy" />
</TopBar>

<TopBar
  brand={<span style={{ fontFamily: "var(--font-display)" }}>FuzeFront</span>}
  actions={<><SearchButton /><ThemeToggle /></>}
/>
```

Slots: `brand` (left), `actions` or `children` (right), separated by a flex spacer. Renders at `var(--top-bar-height)` with the indigo->cyan `--seam` strip (opacity 0.7) along its bottom edge.
