A bold sub-heading that introduces a block of content — a placeholder section's title ("Blog Coming Soon") or a grid-card's title (a solution card's name). Replaces the recurring ad-hoc `className="text-2xl font-bold text-gray-900 mb-4"` pattern duplicated across feature code. Composes `Text` for its color scale (never forks it) and adds the DS `--text-2xl` size, `--weight-bold` weight, and a `space` prop for the bottom-margin gap.

```jsx
<BlockHeading>Blog Coming Soon</BlockHeading>
<BlockHeading as="h3">{solution.name}</BlockHeading>
<BlockHeading tone="secondary" space="sm">Smaller gap variant</BlockHeading>
```

Sits between `CardTitle` (`--text-lg` / semibold, a smaller feature-card title) and `SectionTitle`-style section openers in the type scale. `as` (`h2` default, or `h1` | `h3` | `h4`) picks the heading level. `tone` (delegated to `Text`): `primary` (default), `secondary`, `muted`, `danger`. `space`: `none` | `sm` (`--space-2`) | `md` (default, `--space-4`, matching the extracted `mb-4`).
