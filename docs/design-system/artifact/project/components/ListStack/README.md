A layout primitive that replaces the recurring `<ul className="space-y-2.5">` / `<ul className="space-y-1.5">` pattern used to lay out a vertical list of `<li>` items with a consistent gap — footer nav-link columns, careers responsibilities/qualifications bullet lists, pricing plan feature lists. `ListStack` owns the container (semantic list element, reset browser list styling, token-driven gap); callers keep supplying their own `<li>` items with whatever marker/icon/content they need.

```jsx
<ListStack gap="md">
  {footerNavigation.products.map((item) => (
    <li key={item.name}>
      <Link to={item.href}>{item.name}</Link>
    </li>
  ))}
</ListStack>

<ListStack as="ul" gap="sm">
  {position.responsibilities.map((r) => (
    <li key={r}>{r}</li>
  ))}
</ListStack>
```

`gap`: `xs` (`--space-1`, 4px) / `sm` (`--space-2`, 8px, default) / `md` (`--space-3`, 12px) / `lg` (`--space-4`, 16px). `as`: `ul` (default) or `ol`. Renders `role="list"` explicitly — `list-style: none` strips the implicit list semantics in Safari/VoiceOver otherwise.
