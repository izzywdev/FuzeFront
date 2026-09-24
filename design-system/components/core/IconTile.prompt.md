A tone-colored icon, optionally on a rounded chip — extracted from the recurring "perk/contact/legal-header icon" block duplicated across fuzefront-website (issue #936). The icon itself is passed as `children`; IconTile only styles the surrounding box and color.

```jsx
<IconTile tone="accent" size="md"><Mail size={24} /></IconTile>
<IconTile tone="accent" size="lg"><Shield size={28} /></IconTile>
<IconTile tone="accent" size="md" variant="surface"><Zap size={20} /></IconTile>
<IconTile tone="accent" variant="plain"><Newspaper size={24} /></IconTile>
<IconTile tone="success" variant="plain" label="Success"><CheckCircle size={20} /></IconTile>
```

Tones: `accent | info | success | warning | error | neutral`. Sizes (box only, the child icon keeps its own `size`): `sm` (36px) `md` (44px) `lg` (56px). Variants: `soft` (default — tone-tinted background) for a chip on a light/neutral section; `surface` (neutral `--bg-quaternary` background, icon still tone-colored) for a chip sitting on an already-dark/colored section where a second tint would fight it; `plain` (no box) for an icon inline beside text with no chip. Decorative by default (`aria-hidden`); pass `label` when the icon carries meaning with no adjacent text.
