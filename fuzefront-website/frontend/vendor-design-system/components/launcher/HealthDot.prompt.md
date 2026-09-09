A small round status dot for launcher app icons — green (`--success-color`) when a remote micro-frontend is reachable, coral (`--error-color`) when it's offline, ringed in `--bg-tertiary` so it stays legible when overlapping an icon.

```jsx
<HealthDot healthy />
<HealthDot healthy={false} label="FuzeClock unreachable" />
<HealthDot healthy size="sm" />

{/* overlapping a launcher app icon */}
<div style={{ position: "relative" }}>
  <AppIcon />
  <HealthDot healthy={app.isHealthy} overlay />
</div>
```

`healthy` toggles green/coral; `size` is `sm | md | lg`; `overlay` corner-pins it onto a relative parent; `label` overrides the auto health-aware tooltip/aria-label.
