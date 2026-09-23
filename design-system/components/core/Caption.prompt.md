A small supporting text line that sits below other content — a status line under a spinner/icon, a notification's message line under its title, or a footnote under a CTA row. Replaces the recurring ad-hoc `className="mt-{1,2,6} text-sm text-gray-{500,600}"` pattern scattered across feature code. Composes `Text` for its color scale (never forks it) and adds the two things `Text` deliberately leaves to the caller: the DS `--text-sm` size and a `space` prop for the top-margin gap.

```jsx
<Caption tone="muted">Checking permissions...</Caption>
<Caption tone="secondary" space="xs">{message}</Caption>
<Caption tone="secondary" space="lg">No credit card required &middot; Free for 14 days</Caption>
```

Tones (delegated to `Text`): `primary`, `secondary` (default — de-emphasized supporting copy, `--text-secondary`), `muted` (lowest-emphasis, `--text-tertiary`), `danger`. `space`: `none` | `xs` (`--space-1`) | `sm` (default, `--space-2`) | `md` (`--space-4`) | `lg` (`--space-6`). `as` (`p` default, or `span` | `div` | `label`) picks the rendered element.
