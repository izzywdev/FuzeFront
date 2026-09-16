The host shell's circular user avatar — initials rendered in white on the indigo "fuse" gradient, derived from `name` (or `email` as a fallback), with the full identity exposed via `title`/`aria-label`.

```jsx
<Avatar name="Izzy Weinberg" />
<Avatar name="Ada Lovelace" email="ada@fuze.dev" size="lg" />
<Avatar email="ops@fuze.dev" size="sm" />
<Avatar name="Sam Rivera" interactive title="Open user menu" />
```

Props: `name` + `email` feed the derived initials; `size` is `sm | md | lg`; `interactive` adds the top-bar hover lift and accent glow for use as a menu trigger.
