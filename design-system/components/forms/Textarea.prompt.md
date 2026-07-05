Multi-line text field that mirrors `Input` exactly — same label, error state, focus seam ring, and disabled behaviour — but renders a `<textarea>` with vertical resize only.

```jsx
<Textarea id="bio" label="Bio" placeholder="Tell us about yourself…" rows={4} />
<Textarea id="notes" label="Notes" rows={6} onChange={(e) => setNotes(e.target.value)} />
<Textarea id="desc" label="Description" error="Description is required" rows={3} />
<Textarea id="log" label="Raw log" rows={10} disabled value={logOutput} />
```

Props: `label`, `error`, `rows` (default 4), plus all native `<textarea>` attributes (`placeholder`, `value`, `disabled`, `onChange`, etc.). Full-width by default; focus applies the accent border + 3px `--accent-soft` ring; `error` switches the border to `--error-color` and renders the message.
