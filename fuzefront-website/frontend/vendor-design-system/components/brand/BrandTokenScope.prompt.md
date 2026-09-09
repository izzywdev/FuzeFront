Scopes a portal's brand `accent` (from `GET /api/v1/portal/context` → `branding.accent`) over the base design-system tokens — re-points `--accent-color` / `--accent-hover` / `--accent-soft` (and optionally `--accent-2`) for everything rendered inside it. This is the white-label reskin mechanism (FF-EPIC-13): the shell markup never changes, only which token scope wraps it.

```jsx
<BrandTokenScope accent={portal.branding.accent}>
  <PortalShell />
</BrandTokenScope>

<BrandTokenScope accent="#2f6df6" accent2="#17b0a0" as="main">
  <App />
</BrandTokenScope>

<BrandTokenScope accent={maybeMalformedInput} onAccentRejected={(info) => log.warn('brand accent rejected', info)}>
  {/* renders with NO override — children inherit the base/ancestor accent */}
  <App />
</BrandTokenScope>
```

`accent` accepts hex / `rgb()` / `hsl()` (and their alpha variants). Fail-closed: an unparsable string OR one that cannot reach WCAG 2.1 AA (≥ 4.5:1) against the white on-accent text this DS renders on accent surfaces is **rejected** — the scope then applies no override, so children fall back to the base `@fuzefront/design-system` accent (or an ancestor `BrandTokenScope`, for nesting). `data-brand-accent-status="applied\|fallback"` and `data-brand-fallback-reason` are set for QA/telemetry. `resolveBrandAccent(accent)` is exported standalone for validating a color outside React (e.g. in an admin form).
