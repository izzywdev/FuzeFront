A single summary-metric tile — seam top accent, mono uppercase key label, display-font value, optional meta caption. Use in a CSS grid of your own layout (a 4-up admin-console overview); for a fused horizontal band of tiles, use `StatGroup` instead.

```jsx
<div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "var(--space-4)" }}>
  <StatCard label="Users" value={18} meta="3 admins, 2 invites pending" href="/portal/admin/users" />
  <StatCard label="Apps enabled" value={6} meta="of 12 available" href="/portal/admin/catalog" />
  <StatCard label="Storage" value={4.2} unit="GB" />
  <StatCard label="Plan" value="Pro" meta="renews Aug 1" />
</div>
```

Renders as an `<a>` when `href` is given (navigates to the metric's detail view), otherwise a `<div>`.
