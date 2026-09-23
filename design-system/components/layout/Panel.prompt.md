A titled surface for a summary card — header (title + optional trailing element like a status pill), a body of normal content or a token-styled empty message, and an optional footer row of actions. Replaces a hand-rolled `<section className="ffb-panel">` wrapper.

```jsx
<Panel title="Payment method" headerAction={<StatusPill status="active" />}>
  <div>{cardSummary}</div>
</Panel>

<Panel title="Subscription" empty="No active subscription." actions={<Button variant="primary">Choose a plan</Button>} />
```

The heading is wired to the section via `aria-labelledby` (auto-generated, or pass `titleId` to reuse one you already control). `empty` and `children` are mutually exclusive — pass `empty` for the no-data state instead of nesting your own paragraph.
