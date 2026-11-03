A prose list primitive that replaces the recurring `<ul className="list-disc pl-6 space-y-* [mt-*]">` pattern used for bullet lists inside long-form legal/marketing copy (Privacy Policy, Terms of Service). Unlike `ListStack` (which strips native markers for a custom icon/marker per item), `BulletList` keeps the browser's native disc/decimal marker and indent — callers still supply their own `<li>` items.

```jsx
<p>We use the information we collect to:</p>
<BulletList space="sm">
  <li>Provide, operate, and maintain our platform and services</li>
  <li>Process transactions and send related information</li>
  <li><strong>Service Providers:</strong> vendors who assist in delivering our services</li>
</BulletList>

<BulletList>
  <li>Cookies and similar tracking technologies</li>
  <li>Analytics data about how you interact with our platform</li>
</BulletList>
```

`as`: `ul` (default, disc marker) or `ol` (decimal marker). `gap`: `xs` (`--space-1`, 4px) / `sm` (`--space-2`, 8px, default) / `md` (`--space-3`, 12px) / `lg` (`--space-4`, 16px) — the vertical space between items. `space`: `none` (default) / `sm` (`--space-3`, 12px) / `md` (`--space-4`, 16px) — the top margin separating the list from the paragraph above it. Indent is fixed at `--space-6` (24px, `pl-6`'s exact token match). All standard list-element attributes (`aria-*`, `role`, `data-*`) pass through.
