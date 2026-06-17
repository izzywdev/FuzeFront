A small pill label for status, roles, and technical tags — `accent` is the brand "fuse" indigo, the status tones (`success`/`warning`/`error`) render as their color on a faint wash, and `mono` switches to JetBrains Mono for machine values like app types and scopes.

```jsx
<Badge tone="accent" mono>react</Badge>
<Badge tone="success" dot>Running</Badge>
<Badge tone="error" dot>Failed</Badge>
<Badge tone="neutral" size="sm" mono>read:apps</Badge>
```

Tones: `neutral | accent | success | warning | error`. Sizes `sm | md`. `mono` uses the technical font and skips uppercasing; `dot` prepends a tone-colored status dot.
