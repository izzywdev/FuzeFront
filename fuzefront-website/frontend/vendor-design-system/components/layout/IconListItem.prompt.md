A row with a tone-colored, top-aligned leading icon beside text — extracted from the recurring "checklist row" block duplicated across fuzefront-website: a challenge/use-case checklist item and a pricing plan's included/excluded feature row all repeated the identical icon className (`text-success-500 flex-shrink-0 mt-0.5`) (issue #975). The icon component is passed as `icon`; `IconListItem` only owns the row layout (flex, top-aligned, token-driven gap) and the icon's tone/size/alignment — callers keep full control of the icon glyph and their own text content/styling, the same division ListStack uses for `<li>` content.

```jsx
<ListStack gap="sm">
  {challenges.map((c) => (
    <IconListItem key={c} icon={CheckCircle2} className="text-sm text-gray-600">
      {c}
    </IconListItem>
  ))}
</ListStack>

<IconListItem icon={Check} tone="success">
  <span className="text-gray-700">{feature}</span>
</IconListItem>
<IconListItem icon={X} tone="muted">
  <span className="text-gray-600">{feature}</span>
</IconListItem>

<IconListItem as="div" icon={CheckCircle2} size={18} gap="md" className="bg-white rounded-xl border border-gray-100 p-5">
  <p className="text-sm text-gray-700 leading-relaxed">{useCase}</p>
</IconListItem>
```

`as`: `li` (default, for use inside a `ListStack`/`<ul>`) or `div` (a free-standing row). `tone`: `success` (default) `| warning | error | accent | neutral | muted` — same tone tokens as `IconTile`'s `plain` variant, plus `muted` (`--text-tertiary`) for a de-emphasized/excluded item. `size`: icon pixel size passed straight to `icon` (default `14`). `gap`: `xs | sm (default) | md | lg`, mapped to the DS spacing scale. The icon is decorative by default (`aria-hidden`) — the row's accessible name comes from its text content.
