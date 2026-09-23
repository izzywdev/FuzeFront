A panel/card header row — a title on the left, an optional trailing node (status pill, badge, action) flush to the end. Pair the `id` with the panel's `aria-labelledby` so the section is announced correctly.

```jsx
<section className="ffb-panel" aria-labelledby="ffb-sub-title">
  <PanelHeader id="ffb-sub-title" title={strings.subscriptionHeading}>
    <StatusPill status={status} strings={strings} />
  </PanelHeader>
  {/* panel body */}
</section>
```

No trailing content — just omit children:

```jsx
<PanelHeader id="ffb-pm-title" title={strings.paymentMethodHeading} />
```

Extracted from the recurring `ffb-panel__header` block duplicated across billing-ui's panel components (`ds-fp:25265d6c2784`). Use it wherever a card/panel needs a title + optional trailing action/status, instead of hand-rolling the flex row again.
