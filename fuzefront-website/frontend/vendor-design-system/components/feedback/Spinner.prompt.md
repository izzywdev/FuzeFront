A token-driven, inline loading indicator — pure CSS `@keyframes` ring, no SVG markup and no Tailwind class dependency. Use it any time UI needs to say "this is loading": inline inside a busy button (next to its label), in a full-panel "checking permissions..." state, or standalone next to a loading message. Replaces every hand-rolled `<svg class="animate-spin">…</svg>` spinner icon (the `opacity-25`/`opacity-75` two-path SVG duplicated across `PermissionButton` and `ProtectedRoute`) — do not re-inline that markup; compose `<Spinner>` instead.

```jsx
<Spinner />
<Spinner size={16} color="currentColor" className="-ml-1 mr-2" />
<Spinner size={14} color="white" />
<Spinner size={32} color="var(--accent-color)" label="Checking permissions..." />
```

Props: `size` (px, default `32`) and `color` (any CSS color or `var(--*)` token, default `var(--accent-color)`) size/color the ring; border thickness derives from `size`. `label` (default `"Loading"`) sets the accessible name — the root carries `role="status"` and `aria-label={label}`, so it announces once as a live region without extra markup at the call site. Any other prop (`className`, `style`, `data-*`) is forwarded to the root element, so it composes inline inside a button's existing flex/gap layout.
