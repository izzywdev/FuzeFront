A layout primitive that centers block content — replaces the recurring ad-hoc `className="text-center"` div (a hero heading + paragraph, a stat/perk grid item, a loading/status panel).

```jsx
<Center>
  <h1>About FuzeOne</h1>
  <p>We're building the operating system for SaaS.</p>
</Center>

<Center as="div">
  <div>{metric}</div>
  <div>{label}</div>
</Center>

<Center as={motion.div} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
  <h1>Get in Touch</h1>
</Center>
```

`as` picks the rendered element/component (default `"div"`) — pass an animation wrapper like framer-motion's `motion.div` to keep an existing entrance animation with no extra nesting; every other prop (e.g. `initial`/`animate`/`transition`) forwards straight through.
