The small semibold heading atop a content card — a feature card's title, a value-prop card's heading, a press-release card's headline. Replaces the recurring ad-hoc `className="text-lg font-semibold text-gray-900 mb-2"` pattern duplicated across marketing-site card grids. Composes `Text` (`size="lg"` = `--text-lg`, `tone="primary"`, `spacing="sm"` = `--space-2`) and adds the `--weight-semibold` weight and a snug line height.

```jsx
<CardTitle>Single sign-on</CardTitle>
<CardTitle as="h4" spacing="md">Nested card title</CardTitle>
```

`as` (`h3` default, or `h1` | `h2` | `h4`) picks the heading level. `tone` and `spacing` are delegated to `Text` (`spacing` default `sm`). Any extra `className` (e.g. a `group-hover:*` colour transition) passes through untouched. Sits below `Subheading` (`--text-xl`/bold) and `BlockHeading` (`--text-2xl`/bold) in the type scale.
