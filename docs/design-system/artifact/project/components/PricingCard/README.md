An industry-standard pricing/plan card for a subscription tier — tier name, a big price with interval, feature bullets, an optional highlighted "Recommended" tier, a "Current plan" state, and a clear CTA. Token-driven; the recommended highlight and current state are always labelled (never color alone) for a11y.

```jsx
<PricingCard
  tierName="Pro"
  price="$9"
  interval="month"
  description="For growing teams."
  features={["Unlimited apps", "Priority support", "Audit log"]}
  recommended
  ctaLabel="Subscribe"
  onSelect={() => startCheckout("pro")}
/>

<PricingCard tierName="Starter" price="Free" features={["1 app"]} current />
```

`recommended` adds the accent border/glow + a Recommended badge and an accent CTA. `current` shows a success badge and a disabled "Current plan" button. `busy` shows a working CTA. Lay several out in a responsive grid (`repeat(auto-fit, minmax(220px, 1fr))`).
