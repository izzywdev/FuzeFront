A quiet, same-tab inline navigation link — footer nav rows, a "back to X" link, or any small accent-colored link that stays within the app/site. Never opens a new tab; for that, use `ExternalLink`.

```jsx
<TextLink href="/contact">Contact Us</TextLink>

<TextLink as={Link} to="/terms">
  Terms of Service
</TextLink>
```

Polymorphic via `as` (defaults to a plain `<a>`): pass `as={Link}` (react-router-dom) with `to` for in-app routing. Color reads from the DS accent pair — `--accent-color` at rest, `--accent-hover` on hover/focus — never a raw Tailwind color shade.
