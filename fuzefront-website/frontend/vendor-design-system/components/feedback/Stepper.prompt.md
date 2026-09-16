A vertical, ordered progress list for a multi-step onboarding/setup flow — built for the Stripe Connect onboarding checklist (Portal Admin -> Billing), generic beyond it.

```jsx
<Stepper
  steps={[
    { id: "business", title: "Business details", status: "done" },
    { id: "bank", title: "Bank account", description: "Add a payout account", status: "current" },
    { id: "review", title: "Review & submit", status: "pending" },
  ]}
/>
```

Each step is `done | current | pending`. `done` gets a success-tinted checkmark badge; `current` gets an accent-tinted card and `aria-current="step"`; `pending` is neutral.
