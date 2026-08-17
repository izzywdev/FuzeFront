A labeled technical-value field rendered in `--font-mono` — for JSON, ISO-8601
durations, TypeIDs, remoteEntry URLs and other values a reader scans
character-by-character rather than reads as prose. Mirrors `Textarea`'s
label/error/focus contract exactly (so the two are interchangeable wherever a
value stops being "technical"); the only difference is the font and, for
single-line values, rendering an `<input>` instead of a `<textarea>`.

```jsx
<CodeField label="Retry backoff" defaultValue="PT5M" />
<CodeField label="Config value (JSON)" multiline rows={8} defaultValue={'{\n  "a": 1\n}'} />
<CodeField label="Retry backoff" error="Not a valid ISO-8601 duration." defaultValue="5 minutes" />
```

Props: `label`, `error`, `multiline` (renders a `<textarea>`; default is a
single-line `<input>`), `rows` (multiline only, default 6), plus every native
input/textarea attribute. An `error` borders the field red and renders the
message below with a warning icon, matching `Input`/`Textarea`/`Select`.
