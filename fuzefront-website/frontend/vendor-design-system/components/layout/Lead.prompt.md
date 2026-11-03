The hero/section lead paragraph that follows a heading — replaces the recurring ad-hoc `className="text-xl text-gray-600 max-w-{2xl,3xl} mx-auto"` (a hero subtitle under an `<h1>`, a section intro under an `<h2>`).

```jsx
<h1>Get in Touch</h1>
<Lead>
  Ready to build something amazing? Let's discuss how FuzeFront can help.
</Lead>

<h1>Solutions for Every Business</h1>
<Lead maxWidth="3xl">
  Whether you're a startup building an MVP or an enterprise scaling globally,
  we have the right solution for you.
</Lead>
```

`maxWidth` picks a step of the DS's `--container-*` content-width scale (default `"2xl"`) instead of a raw Tailwind `max-w-*` utility. `centered` (default `true`) applies `margin-inline: auto`; pass `centered={false}` inside a parent that already centers (e.g. `<Center>`) to avoid doubling up. `as` picks a different rendered element when the content isn't plain text.
