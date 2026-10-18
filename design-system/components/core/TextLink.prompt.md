An inline accent-colored link — the DS answer to the recurring ad-hoc `className="text-primary-600 hover:text-primary-700"` pattern. Owns color only (default `--accent-color`, hover/focus `--accent-hover`); size, weight, underline and layout stay the caller's own `className`/`style`.

```jsx
<p>
  Learn more in our{' '}
  <TextLink href="/privacy">Privacy Policy</TextLink>
  {' '}and{' '}
  <TextLink href="/cookies">Cookie Policy</TextLink>
</p>

<TextLink as={RouterLink} to="/products/widgets" className="inline-flex items-center gap-2 text-sm font-medium">
  Learn more
</TextLink>

<TextLink as="button" type="button" onClick={retry} className="text-sm font-medium">
  Retry
</TextLink>
```

`as` polymorphs the rendered element — a plain `<a>` by default, a router `Link` for client-side navigation, or `"button"` for a text-styled inline action. This component never assumes or forces navigation semantics (`target`, `rel`, `to`/`href`) — those stay the caller's own props, unlike `ExternalLink` which forces `target="_blank"` and always appends an external-arrow icon; use `TextLink` instead of `ExternalLink` when the link must render icon-only or otherwise can't carry that forced affordance.
