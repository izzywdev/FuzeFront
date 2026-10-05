A text primitive that paints its children with a brand gradient via
`background-clip: text`, replacing the recurring ad-hoc
`className="gradient-text"` span used for the one emphasized word/phrase in
a marketing heading (ds-fp:22df75e86c00) — and the raw
`-webkit-background-clip: text; -webkit-text-fill-color: transparent;`
boilerplate that pattern leans on.

```jsx
<h1>
  About <GradientText>FuzeOne</GradientText>
</h1>

<div className="text-7xl font-heading font-extrabold">
  <GradientText as="div">404</GradientText>
</div>

<h1>
  The Software Factory
  <GradientText as="div" gradient="var(--primary-gradient)" className="mt-2">
    for your SaaS
  </GradientText>
</h1>
```

`gradient` (default `var(--seam)`, the DS indigo -> cyan "fuse seam" token)
accepts any CSS `<gradient>` value or `var(--custom-gradient)` reference —
a consumer with its own brand gradient (e.g. a marketing site) overrides it
per call rather than forking the component. `as` (`span` default, or `div`
| `h1` | `h2` | `h3` | `p`) picks the rendered element — `span` for inline
use inside a heading, a block element for a standalone display heading or
stat number.
