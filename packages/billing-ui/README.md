# @fuzefront/billing-ui

Design-system-first React UI for the FuzeFront **billing-service**. Built against
the frozen contract (`@fuzefront/billing-client`, generated from
`services/billing-service/openapi.yaml`) — every request/response shape is
imported, never hand-written.

Private package: published to GitHub Packages (`@fuzefront`, `access: restricted`).

## Components

| Component             | Purpose                                                                     |
| --------------------- | --------------------------------------------------------------------------- |
| `PlanPicker`          | Plan catalogue + monthly/yearly toggle, featured + current-plan treatment.  |
| `PlanCard`            | A single plan (localized currency, features, CTA).                          |
| `CheckoutModal`       | Stripe **Payment Element** checkout (`payment`/`setup` modes, SCA via 3DS). |
| `SubscriptionManager` | Current plan/status/trial/renewal, change/cancel (confirm), resume.         |
| `UsagePanel`          | Account credit (Stripe customer balance) + seats-in-use, empty state.       |
| `PaymentMethodPanel`  | Card-on-file summary + add/update (delegates to `CheckoutModal` setup).     |
| `Modal`, primitives   | Accessible dialog + Button/StatusPill/Spinner/Notice (DS contract).         |

## Install & usage

```bash
npm i @fuzefront/billing-ui @fuzefront/billing-client \
  @stripe/stripe-js @stripe/react-stripe-js
```

```tsx
import {
  BillingI18nProvider,
  PlanPicker,
  CheckoutModal,
} from '@fuzefront/billing-ui';
import '@fuzefront/billing-ui/styles.css'; // design-system token-only stylesheet
import { loadStripe } from '@stripe/stripe-js';

const stripe = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);

function Billing({ plans }) {
  return (
    <BillingI18nProvider dir="ltr" locale="en-US">
      <PlanPicker plans={plans} onSelect={openCheckout} />
      {/* clientSecret comes from billing-client.createSubscription(...) */}
      <CheckoutModal open={open} stripe={stripe} clientSecret={cs} plan={plan} />
    </BillingI18nProvider>
  );
}
```

The token CSS variables (`--bg-*`, `--accent-*`, `--space-*`, `--seam`, …) come
from `@fuzefront/design-system` / `frontend/src/index.css` — the FuzeFront shell
already provides them. Card data is collected and tokenised entirely by Stripe.js
inside its iframe; only the `clientSecret` and Stripe ids flow through these
components.

## Design-system-first

- Zero hard-coded color/spacing/type — only design-system token CSS variables.
- One token added to the design system for this work: `--scrim` (modal overlay).
- RTL via CSS logical properties only; `dir`/`locale` drive automatic mirroring
  and `Intl` currency/date formatting.
- a11y: labelled regions, `role="dialog"`/`aria-modal`, focus trap + restore,
  keyboard nav, fuse-seam focus rings, `role="alert"` on errors.

## i18n

`BillingI18nProvider` mirrors the expected `@fuzefront/i18n` interface (a `dir`,
a `locale`, a string table, and `Intl` formatters). When the shared package
lands, swapping it in is a one-line import change; the component API does not
move. All copy lives in `src/i18n` — components never hard-code strings.

## Develop against the contract (no backend needed)

Stand up the mock server from the spec and point the host's billing-client at it:

```bash
npx @stoplight/prism-cli mock services/billing-service/openapi.yaml
```

## Scripts

```bash
npm run build       # tsup dual build: ESM (.js) + CJS (.cjs) + .d.ts + styles.css
npm run type-check  # tsc --noEmit
npm test            # vitest run (unit + a11y + RTL)
```
