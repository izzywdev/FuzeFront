A compact single-select button group for filtering or switching a view — "Any / Private / Organization / Common". Choose it over `Select` when there are only a handful of short options that should all be visible at once; choose `Tabs` when the choice swaps a panel of content.

```jsx
<SegmentedControl
  ariaLabel="Visibility"
  value={visibility}
  onChange={setVisibility}
  options={[
    { value: "any", label: "Any" },
    { value: "private", label: "Private" },
    { value: "org", label: "Organization" },
    { value: "platform", label: "Common" },
  ]}
/>
```

Props: `options` (`{ value, label, disabled?, ...data-*/aria-* }[]`), `value` / `defaultValue` / `onChange(value)`, `disabled` (whole control), `ariaLabel` or `ariaLabelledBy` (one is required for an accessible group name), `ref` (the group element). Extra keys on an option (`data-*`) are forwarded to its button.

Behaviour: a `role="group"` of native `<button>`s, each with `aria-pressed`; exactly one is pressed. Pressing the pressed segment is a no-op and does not call `onChange` — a segmented control cannot be cleared, so add an explicit "Any" segment for that. Every segment is its own tab stop and Space/Enter activate it. Disabled segments are native `disabled` buttons.

Segments are separated by a hairline using logical properties (mirrors in RTL); the pressed segment is tinted `--accent-soft`; the focus ring is drawn inside the segment so the group's rounded clip never cuts it off. Segments grow to 44px (`--touch-target`) on touch devices and below the xs breakpoint (480px).
