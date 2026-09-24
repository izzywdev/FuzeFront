Flex layout primitive for laying out a row (or column) of inline items with a consistent, token-driven gap — replaces the recurring `className="flex items-center space-x-*"` pattern found across the app (badge rows, avatar + name clusters, icon + label pairs).

```jsx
<Stack gap="sm">
  <RoleBadge role="admin" />
  {isSelected && <CheckIcon />}
</Stack>

<Stack gap="md">
  <Avatar src={profile.avatar} />
  <div>{profile.firstName} {profile.lastName}</div>
</Stack>

<Stack direction="column" gap="xs" align="stretch">
  <Input label="Email" />
  <Input label="Password" type="password" />
</Stack>
```

`direction` is `row` (default) or `column`. `align` (cross-axis) defaults to `center`; `justify` (main-axis) defaults to `start` — pass `justify="between"` for a space-between row. `gap` maps to the spacing scale: `xs` (--space-1, 4px), `sm` (--space-2, 8px, default), `md` (--space-4, 16px), `lg` (--space-6, 24px), `xl` (--space-8, 32px). `wrap` allows children to flow onto multiple lines. All standard `div` attributes (including `aria-*`, `role`, `data-*`) pass through.
