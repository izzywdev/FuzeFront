A token-driven, container-responsive grid — replaces the recurring `grid grid-cols-1 md:grid-cols-2 gap-N` Tailwind pattern used to pair form fields side by side and to lay out two-panel content sections. Stacks to one column when narrow and reflows up to `columns` once each can be at least `minColumnWidth` wide; the reflow is driven by the grid's own container width (CSS `auto-fit`/`clamp()`), not a viewport media query, so it collapses correctly inside a narrow host-shell panel too.

```jsx
<ResponsiveGrid columns={2}>
  <Input label="First name" value={firstName} onChange={onFirstNameChange} />
  <Input label="Last name" value={lastName} onChange={onLastNameChange} />
</ResponsiveGrid>

<ResponsiveGrid columns={2} gap="md" minColumnWidth="200px">
  <div role="group" aria-label="Admin panel">…</div>
  <div role="group" aria-label="Member panel">…</div>
</ResponsiveGrid>

<ResponsiveGrid columns={3} gap="sm" align="start">
  <StatCard {...a} />
  <StatCard {...b} />
  <StatCard {...c} />
</ResponsiveGrid>
```

Props: `columns` (max columns at full width, default `2`), `minColumnWidth` (default `"240px"`), `gap` (`sm | md | lg | xl`, default `"lg"` → `var(--space-6)`), `align` (`align-items`). Purely presentational — no owned semantics — so give it a `role`/`aria-label` (or wrap it in a landmark) when the grid itself is a meaningful group, exactly like a plain `<div>`.
