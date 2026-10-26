A radio group rendered as selectable cards — a title plus a one-sentence description per option. Use it when each choice needs explaining ("Everyone in your organization" / "Only people I give a role"); for a short, label-only choice use a native radio group or `SegmentedControl`.

```jsx
<span id="vis-label">Who can see this list</span>
<RadioCardGroup
  ariaLabelledBy="vis-label"
  value={visibility}
  onChange={setVisibility}
  options={[
    { value: "private", label: <>Only people with a role <Badge>Private</Badge></>, description: "Everyone else keeps using the common list." },
    { value: "org", label: "Everyone in Acme Logistics", description: "Every member can read it and pick its values." },
    { value: "platform", label: "Every organization", description: "Publishes it as a common list.", disabled: !canPublish },
  ]}
/>
```

Props: `options` (`{ value, label, description?, disabled?, pending?, ...data-*/aria-* }[]`), `value` / `defaultValue` / `onChange(value)`, `disabled` (whole group), `name` (adds a hidden input for native form posts), `ariaLabel` or `ariaLabelledBy` (one is required for an accessible group name), `ref` (the radiogroup element). Extra keys on an option (`data-*`, `aria-describedby`) are forwarded to its card.

Behaviour (WAI-ARIA radio group): `role="radiogroup"` containing `role="radio"` cards with `aria-checked`; roving tab stop (the checked card, else the first enabled one); Arrow keys move focus **and** selection, wrap, and skip disabled cards; Space selects. Left/Right flip under `dir="rtl"`, Up/Down do not. Disabled cards are `aria-disabled`, dimmed and not selectable. `pending: true` draws a dashed accent border for "chosen, awaiting confirmation" without marking the card checked.

Each card's accessible name is its `label`; its `description` is the accessible description. Cards are at least `--touch-target` (44px) tall, use logical properties so they mirror in RTL, and show the accent focus ring on keyboard focus. Below the xs breakpoint (480px) the stack tightens and the checked card is tinted with `--accent-soft`.
