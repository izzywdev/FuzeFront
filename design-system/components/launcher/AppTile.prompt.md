The launcher app tile — a compact icon + name cell for the 9-dots app grid, modeled on the Google app launcher. Unlike `AppCard`, it shows only the app icon and its menu label — no description, no integration badge — so a dense grid of apps stays scannable. Offline apps go grayscale + dimmed + inert, with a corner health dot.

```jsx
<AppTile
  name="FuzeClock"
  integrationType="module-federation"
  iconUrl="/icons/clock.svg"
  isHealthy
  onClick={() => navigate("/app/fuzeclock")}
/>
<AppTile name="Legacy Reports" integrationType="iframe" isHealthy={false} />
```

Props: `name`, `integrationType` (`module-federation` | `iframe` | `web-component` | other — sets the fallback icon hue/emoji), `iconUrl` (emoji fallback on error), `iconGlyph` (manifest emoji glyph), `isHealthy` (offline = grayscale/dim/inert), `onClick` (fires on click/Enter/Space when healthy). For the full-detail dashboard/management card, use `AppCard`.
