The shell's standalone form-field label — for fields not built from `Input`/`Select` (a `register()`-wired field, or a custom edit/view toggle). Tokens-only text treatment; wire it to its control with `htmlFor`/`id`.

```jsx
<FieldLabel htmlFor="firstName">First Name</FieldLabel>
<FieldLabel htmlFor="email" required>Email</FieldLabel>
<FieldLabel htmlFor="bio" style={{ marginBlockEnd: "var(--space-1)" }}>Bio</FieldLabel>
```

Props: `htmlFor`, `required` (appends a tokenized asterisk + visually-hidden " (required)"), plus all native `<label>` attributes. Defaults to an 8px (`--space-2`) bottom margin; override via `style` when a tighter field group needs 4px (`--space-1`).
