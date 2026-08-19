A loading-placeholder block with the shared skeleton shimmer — use it to reserve layout while content loads (pricing cards, profile blocks, etc.). It is decorative (`aria-hidden`); mark the surrounding region with `aria-busy`/a "Loading" label.

```jsx
<div aria-busy="true" aria-label="Loading plans">
  <Skeleton height="var(--space-6)" width="60%" />
  <Skeleton height="var(--space-16)" />
</div>
```

Props: `width`, `height`, `radius` all accept any CSS length and default to token values.
