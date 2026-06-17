The dashboard launcher card — the primary surface of the runtime fabric: it lifts and reveals the indigo→cyan `--seam` along its top edge on hover, and goes grayscale + dimmed + inert when the remote app is offline.

```jsx
<AppCard
  name="FuzeClock"
  description="A live world-clock remote, fused at runtime."
  integrationType="module-federation"
  iconUrl="/icons/clock.svg"
  isHealthy
  onClick={() => navigate("/app/fuzeclock")}
/>
<AppCard name="Legacy Reports" integrationType="iframe" isHealthy={false} />
<AppCard
  name="Widget Kit"
  description="Drop-in custom elements."
  integrationType="web-component"
  onClick={open}
/>
```

Props: `name`, `description`, `integrationType` (`module-federation` | `iframe` | `web-component` | other — sets the fallback icon hue + mono badge), `iconUrl` (emoji fallback on error), `isHealthy` (offline = grayscale/dim/inert), `onClick` (fires on click/Enter/Space when healthy).
