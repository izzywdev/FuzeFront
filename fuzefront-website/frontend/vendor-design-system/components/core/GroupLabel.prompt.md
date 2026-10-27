A small uppercase heading that introduces a labelled group of content inside a card or section — e.g. "Responsibilities", "Qualifications", "Key challenges addressed", "Recommended products". Replaces the recurring ad-hoc `className="text-xs font-semibold text-gray-{600,900} uppercase tracking-wider mb-{2,3}"` pattern scattered across feature code. Not `Eyebrow` — that's a pill-shaped accent label with a dot, used above a big section/hero heading; `GroupLabel` is a plain inline heading directly above a sub-list or sub-block inside a card, with no pill and no accent color. Composes `Text` for size/tone (never forks its scales) and adds the three things `Text` deliberately leaves to the caller: the semibold weight, the uppercase/wide-tracking treatment, and the bottom-margin gap.

```jsx
<GroupLabel>Responsibilities</GroupLabel>
<GroupLabel tone="primary">Qualifications</GroupLabel>
<GroupLabel spacing="md">Key challenges addressed</GroupLabel>
```

Tones (delegated to `Text`): `primary` (`--text-primary`, gray-900 equivalent), `secondary` (default, `--text-secondary`, gray-600 equivalent), `muted` (`--text-tertiary`). `spacing`: `sm` (default, `--space-2`) | `md` (`--space-3`). `as` (`h4` default, or `h5` | `h6` | `p` | `span` | `div`) picks the rendered element.
