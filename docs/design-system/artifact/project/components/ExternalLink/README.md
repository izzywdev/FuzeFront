A link to a resource on ANOTHER host, always opened in a new browser tab. Always a real `<a target="_blank" rel="noopener noreferrer">` — never a JS `window.open()` (popup-blockable) and never an in-app route. An external-arrow glyph is always appended so the affordance reads as external before the click.

```jsx
<ExternalLink href="https://portal.northwind.example/" variant="button">
  Open portal
</ExternalLink>

<ExternalLink href="https://docs.example.com/guide" variant="link">
  Read the guide
</ExternalLink>
```

Variants: `button` (filled accent CTA — the primary launch action) `| link` (quiet inline text link, default). `href` is required; pass the server-provided absolute URL directly — never compose a host from client-held data. For a destination that must NOT be launchable (e.g. a suspended resource), don't render `ExternalLink` at all — compose a disabled `Button` instead, so there is nothing navigable in the DOM.
