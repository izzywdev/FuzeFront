A single sidebar nav row for the host shell — quiet by default, raised on hover, and marked with the runtime "fuse seam" (a 3px indigo->cyan bar on the left edge) when `active`.

```jsx
<MenuItem icon="🏠" label="Dashboard" active onClick={() => go("/")} />
<MenuItem icon="🏢" label="Organizations" onClick={() => go("/organizations")} />
<MenuItem
  icon={
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15" />
    </svg>
  }
  label="Settings"
  onClick={() => go("/settings")}
/>
<MenuItem icon="❓" label="Help" onClick={openHelp} />
```

Props: `icon` (leading glyph/SVG), `label` (text), `active` (seam bar + accent-soft fill + semibold), `onClick` (fires on click and Enter/Space).
