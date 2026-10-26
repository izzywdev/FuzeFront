An ordered progress indicator for any multi-step flow — an onboarding checklist, a wizard header, a build/deploy pipeline. Each step is `done | current | failed | cancelled | pending`.

```jsx
// Vertical card list (default) — e.g. the Stripe Connect onboarding checklist
<Stepper
  steps={[
    { id: "business", title: "Business details", status: "done" },
    { id: "bank", title: "Bank account", description: "Add a payout account", status: "current" },
    { id: "review", title: "Review & submit", status: "pending" },
  ]}
/>

// Horizontal segmented bar — e.g. a build pipeline that stopped at a failure
<Stepper
  orientation="horizontal"
  aria-label="Build progress"
  aria-live="polite"
  steps={[
    { id: "launching", title: "Launching", status: "done" },
    { id: "building", title: "Building", status: "done" },
    { id: "deploying", title: "Deploying — failed", status: "failed" },
    { id: "deployed", title: "Deployed", status: "pending" },
  ]}
/>
```

Props: `steps` (`{ id?, title, description?, status? }[]`; a missing or unrecognised `status` is `pending`), `orientation` (`"vertical"` default | `"horizontal"`), `statusLabels` (override the visually-hidden status words to localise), plus any native `<ol>` attribute (`aria-label`, `aria-live`, `data-*`).

Looks: **vertical** — `done` is a success-tinted check badge, `current` an accent-tinted card, `failed` an error-tinted `✕` badge, `cancelled` a neutral `–` badge. **horizontal** — equal-width segments, a status-coloured bar over the title (`done` success, `current` the seam gradient, `failed` error, `cancelled` neutral-strong, `pending` muted); wraps to fewer columns on narrow screens.

Accessibility: an `<ol>`; the current step has `aria-current="step"`; every step's status is also visually-hidden text ("Completed", "Current step", "Failed", "Cancelled", "Not started") so state is never conveyed by colour or glyph alone. For `failed` / `cancelled` you will usually also want the state in the visible title ("Deploying — failed"), as the horizontal bar alone is colour-only for sighted users. Add `aria-live="polite"` when step changes should be announced. Layout uses logical properties and grid, so it mirrors under `dir="rtl"`.

Test hooks on each step: `data-step` (the `id`), `data-step-status` (`done|current|failed|cancelled|pending`) and `data-step-state` (same, but `todo` for `pending`).
