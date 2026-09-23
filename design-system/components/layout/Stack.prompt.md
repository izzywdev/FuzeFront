Stack — the vertical-rhythm layout primitive: a `flex-direction: column` wrapper with a consistent `gap`, replacing the recurring hand-rolled Tailwind `space-y-*` div used across tab panels, settings sections and permission-demo blocks. Pick `gap` from the token scale instead of a raw utility class.

```jsx
<Stack gap="lg">
  <ProfileFieldsGrid />
  <BioField />
  <TimezoneLanguageGrid />
</Stack>

<Stack gap="sm" as="section" aria-label="Notification preferences">
  <InfoRow label="Email Notifications">
    <Toggle checked={emailEnabled} onChange={onToggleEmail} />
  </InfoRow>
</Stack>

<Stack gap="xs">
  <p>Can read organizations</p>
  <p>Can create organizations</p>
</Stack>
```

`gap`: `xs | sm | md | lg | xl` (4/8/16/24/32px via `--space-*` tokens), default `md`. `as` renders a different element (`section`, `ul`, `nav`, …) for semantic wrapping — pair it with `aria-label`/`aria-labelledby` when the stack is a distinct region. `gap` on a column flex mirrors automatically under RTL, unlike `space-y-*`'s child-margin approach — no directional overrides needed.
