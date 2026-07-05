The host shell's quiet square control — an icon-only ghost button that stays transparent until hovered (notification bell, theme toggle, top-bar actions). `label` is required and powers both the tooltip and the accessible name.

```jsx
<IconButton label="Notifications">
  <BellIcon />
</IconButton>

<IconButton label="Toggle theme" size="sm">
  <MoonIcon />
</IconButton>

<IconButton label="Filter modules" active>
  <FilterIcon />
</IconButton>

<IconButton label="Refresh remotes" disabled>
  <RefreshIcon />
</IconButton>
```

Pass the icon as `children`. `label` (required) sets `title` + `aria-label`; `active` holds the quaternary fill with accent color; sizes `sm | md | lg`; supports `disabled` and all native button props.
