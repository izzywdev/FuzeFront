A trail of pill steps through a hierarchy. Use it as an ordinary breadcrumb
(clickable ancestors, plain-text current page), or — with `kind` set per item
— as a labeled resolution/scope chain (`platform › portal › org › user`) where
the active tier carries the accent treatment and `aria-current="true"`.

```jsx
<Breadcrumb items={[
  { key: 'orgs', label: 'Organizations', href: '/organizations' },
  { key: 'acme', label: 'Acme Corp', current: true },
]} />

<Breadcrumb items={[
  { key: 'platform', kind: 'platform', label: 'FuzeFront' },
  { key: 'portal', kind: 'portal', label: 'Acme Portal' },
  { key: 'org', kind: 'org', label: 'Acme Corp', current: true },
  { key: 'user', kind: 'user', label: 'You' },
]} />
```

Props: `items` — an array of `{ key, label, kind?, current?, href?, onClick? }`.
A step with `href` or `onClick` renders as a link/button; one with neither
renders as plain text (a chain step that is read, not navigated). Separators
(`›`) are decorative (`aria-hidden`); the list itself carries
`aria-label="Breadcrumb"`.
