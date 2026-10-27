A bold `--text-xl` heading that titles a card or opens a numbered
legal-document section — an industry/product card's name, or a Terms/Privacy
page's "1. Introduction" section heading. Replaces the recurring ad-hoc
`className="text-xl font-bold text-gray-900 mb-{1,3,4}"` pattern duplicated
across the marketing site. Sits one step below `BlockHeading` (`--text-2xl`)
and one step above `CardTitle` (`--text-lg`/semibold) in the type scale.
Composes `Text` for its color scale (never forks it) and adds the DS
`--text-xl` size, `--weight-bold` weight, and a `space` prop for the
bottom-margin gap.

```jsx
<Subheading>1. Introduction</Subheading>
<Subheading space="md">2. Information We Collect</Subheading>
<Subheading as="h3" space="sm">{product.name}</Subheading>
<Subheading as="h3" space="xs">{industry.name}</Subheading>
```

Tones (delegated to `Text`): `primary` (default), `secondary`, `muted`,
`danger`. `space`: `xs` (`--space-1`, e.g. a tight card title immediately
followed by a tagline) | `sm` (`--space-3`) | `md` (default, `--space-4`, a
legal-document section heading followed by body copy). `as` (`h2` default,
or `h3` | `h4`) picks the heading level — `h2` for a stand-alone legal-section
heading, `h3` for a heading nested inside a card.
