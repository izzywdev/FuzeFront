The shell's labeled text field for login, search, and config dialogs — focus lights the accent "fuse seam" ring; an `error` borders the field red and surfaces the message.

```jsx
<Input id="email" label="Email" type="email" placeholder="you@team.dev" />
<Input id="remote" label="Remote entry URL" placeholder="https://app.example.com/remoteEntry.js" />
<Input id="name" label="Display name" defaultValue="ada" error="That name is already taken" />
<Input id="key" label="API key" type="password" disabled value="••••••••" />
```

Props: `label`, `error`, plus all native `<input>` attributes (`type`, `placeholder`, `value`, `disabled`, `onChange`, etc.). Full-width by default; focus applies the accent border + 3px `--accent-soft` ring; `error` switches the border to `--error-color` and renders the message.
