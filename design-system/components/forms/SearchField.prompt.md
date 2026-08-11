A filter/search field for scannable lists (directories, tables) — a leading search glyph inside a bordered surface that lights the accent focus ring, matching `Input`.

```jsx
<SearchField
  placeholder="Search portals by name or domain…"
  value={query}
  onChange={(e) => setQuery(e.target.value)}
  data-input="search"
/>
```

`label` defaults to `"Search"` and is visually hidden (the placeholder carries the visible hint) — pass `hideLabel={false}` to show it above the field. Fully controlled: pass `value`/`onChange` like any input. Renders `type="search"`, so the browser's native clear affordance is available.
