The shell's labeled dropdown for config dialogs and member/role pickers — surface, border, radius and focus match Input, with a tokenized chevron; focus lights the accent "fuse seam" ring and an `error` borders the control red.

```jsx
<Select
  id="role"
  label="Role"
  placeholder="Choose a role"
  options={[
    { value: "owner", label: "Owner" },
    { value: "admin", label: "Admin" },
    { value: "member", label: "Member" },
  ]}
/>
<Select id="theme" label="Theme" defaultValue="dark" options={[
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
]} />
<Select id="env" label="Environment" error="Pick a target before deploying" options={[
  { value: "staging", label: "Staging" },
  { value: "prod", label: "Production", disabled: true },
]} />
<Select id="scope" label="Scope">
  <option value="read">read</option>
  <option value="write">write</option>
</Select>
```

Props: `label`, `options` (`{ value, label, disabled? }[]`), `placeholder`, `error`, plus all native `<select>` attributes (`value`, `defaultValue`, `disabled`, `onChange`, etc.). Full-width by default; focus applies the accent border + 3px `--accent-soft` ring; `error` switches the border to `--error-color`. Pass `<option>` children instead of `options` when you need custom markup.
