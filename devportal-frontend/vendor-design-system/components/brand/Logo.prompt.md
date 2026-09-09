A portal/tenant logo slot — renders `branding.logo` as an image, and falls back to an initials tile derived from `name` (never a broken-image icon, including when the URL 404s after mount).

```jsx
<Logo src={portal.branding.logo} name={portal.branding.name} />
<Logo name="CorpABC" />                 {/* no src -> "CA" initials tile */}
<Logo src="https://dead-link/x.png" name="Northwind" /> {/* onError -> "N" */}
<Logo size="lg" shape="circle" name="Ada Lovelace" alt="Ada Lovelace" />
```

`size` (`sm | md | lg`) and `shape` (`tile | circle`) control presentation; `name` drives both the initials fallback (first letter of up to the first two words) and the default accessible name. `data-logo-state` (`image \| fallback-initials \| fallback-error`) is exposed for QA hooks.
