A tone-colored icon, optionally on a rounded chip — extracted from the recurring "perk/contact/legal-header icon" block duplicated across fuzefront-website (issue #936). The icon itself is passed as `children`; IconTile only styles the surrounding box and color.

```jsx
<IconTile tone="accent" size="md"><Mail size={24} /></IconTile>
<IconTile tone="accent" size="lg"><Shield size={28} /></IconTile>
<IconTile tone="accent" size="md" variant="surface"><Zap size={20} /></IconTile>
<IconTile tone="accent" variant="plain"><Newspaper size={24} /></IconTile>
<IconTile tone="success" variant="plain" label="Success"><CheckCircle size={20} /></IconTile>

{/* Icon on a caller-owned colored/gradient tile (e.g. a per-product
    marketing brand gradient) — ds-fp:c607f2d639f8, issue #945. The box's
    background stays the caller's own markup (often a data-driven gradient,
    not a DS tone); IconTile only replaces the raw `className="text-white"`
    with the `--primary-foreground` token. */}
<div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${product.gradient} flex items-center justify-center`}>
  <IconTile tone="inverse" variant="plain"><Icon size={22} /></IconTile>
</div>
```

Tones: `accent | info | success | warning | error | neutral | inverse`. `inverse` renders the icon in `--primary-foreground` (flat white in both themes) rather than a hue — for an icon placed on a colored/gradient surface the caller renders itself; always pair it with `variant="plain"` since the surrounding box is not this tone's concern. Sizes (box only, the child icon keeps its own `size`): `sm` (36px) `md` (44px) `lg` (56px). Variants: `soft` (default — tone-tinted background) for a chip on a light/neutral section; `surface` (neutral `--bg-quaternary` background, icon still tone-colored) for a chip sitting on an already-dark/colored section where a second tint would fight it; `plain` (no box) for an icon inline beside text with no chip, or on a caller-owned surface. Decorative by default (`aria-hidden`); pass `label` when the icon carries meaning with no adjacent text.
