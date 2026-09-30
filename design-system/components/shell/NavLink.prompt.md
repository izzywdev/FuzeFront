A single horizontal top-nav entry — `MenuItem`'s counterpart for a horizontal bar (marketing header, tabbed top nav) rather than a vertical sidebar. Renders a real `<a>` (or a router `Link` via `as`), marks the current page with `active` (seam-accent underline, never color alone), and optionally discloses a hover/focus flyout `submenu` of related links.

```jsx
<nav style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
  <NavLink label="Products" href="/products" active submenu={[
    { label: "FuzeFront Platform", href: "/products/fuzefront", description: "Module Federation host shell" },
    { label: "FuzeAgent", href: "/products/fuzeagent", description: "AI team orchestration" },
  ]} />
  <NavLink label="Pricing" href="/pricing" />
  <NavLink label="About" href="/about" />
</nav>

{/* With react-router-dom — both the trigger AND the submenu rows */}
<NavLink
  as={Link}
  to="/products"
  label="Products"
  active={location.pathname.startsWith("/products")}
  submenuAs={Link}
  submenu={[
    { label: "FuzeFront Platform", to: "/products/fuzefront", description: "Module Federation host shell" },
    { label: "FuzeAgent", to: "/products/fuzeagent", description: "AI team orchestration" },
  ]}
/>
```

Props: `label` (text), `active` (seam-accent underline + primary text + semibold + `aria-current="page"`), `submenu` (array of `{ label, description?, onClick?, ...anything the row's element needs, e.g. href or to }` — omit for a plain link), `as` (element/component for the trigger, default `"a"`), `submenuAs` (element/component for each submenu row, default `"a"` — pass a router `Link` so a row's `to` navigates), `open`/`defaultOpen`/`onOpenChange` (controlled or uncontrolled submenu visibility). The submenu opens on hover or focus, closes on mouse-leave/blur (with a short grace delay so moving the pointer from the trigger into the panel doesn't close it) or Escape, and is a plain disclosure panel (not `role="menu"`) per the WAI-ARIA disclosure-navigation pattern, since these are navigation links rather than actions.

Multiple `NavLink`s compose into a row by placing them in a flex container with a `--space-*` gap — unlike `MenuItem`, `NavLink` carries no vertical stacking margin of its own.
