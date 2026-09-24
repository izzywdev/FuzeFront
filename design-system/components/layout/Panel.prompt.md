A bordered content panel with a titled header, used for the "titled summary card" shape that recurs across dashboards (subscription status, usage/credits, payment method, settings sections, …). Renders as a `<section aria-labelledby>` so assistive tech announces it as a named region, with an optional trailing badge/pill beside the title, an optional empty-state message in place of the body, and an optional actions row.

```jsx
<Panel title="Subscription" trailing={<StatusPill status="active" />}>
  <div>…plan details…</div>
</Panel>

<Panel title="Payment method" empty="No payment method on file" />

<Panel
  title="Usage"
  actions={<Button variant="secondary" onClick={onManage}>Manage</Button>}
>
  …metrics…
</Panel>
```

Pass `empty` to swap the body for a muted one-line message (e.g. "No card on file") instead of conditionally rendering children yourself. `titleId` is optional — omit it and `Panel` generates one via `useId()`; pass it only when another element (e.g. a live-region announcement) needs to reference the same id.
