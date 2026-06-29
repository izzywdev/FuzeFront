# Post-production e2e (live app)

Real-browser Playwright specs that verify the **live** FuzeFront deployment
(default `https://app.fuzefront.com`). These are INDEPENDENT UI verification —
run by the front-end test engineer, not the implementer.

Config: [`../../playwright.post-prod.config.ts`](../../playwright.post-prod.config.ts)
(`testDir: ./e2e/post-prod`, `baseURL` = `POST_PROD_BASE_URL` || `https://app.fuzefront.com`,
serial, screenshots/trace/video on failure).

## Specs

| Spec | Verifies |
| --- | --- |
| `live-smoke.spec.ts` | MF shell serves, API health, sign-in, Module-Federation remotes load |
| `subscribe-basic.spec.ts` | **New org → workspace provisioning → subscribe Basic $9 (Stripe Checkout)** |

## `subscribe-basic.spec.ts` — the headline goal

Covers the full flow, with explicit step assertions:

1. **Log in** (local auth).
2. **Create a new organization** via the UI (`/organizations/new`).
3. **CRITICAL — workspace provisioning succeeds**: the shell's
   `WorkspaceProvisioningGate` must resolve and land the user *inside* the app —
   not stuck on the provisioning spinner, not on the timeout/error card. (This is
   the exact previously-broken failure: org-create timing out / 500ing.) The test
   fails loudly if provisioning hangs or errors.
4. **Billing** (`/billing`): plans load; a **Basic** plan (**$9 / month**) shows
   with a **Subscribe** button.
5. **Subscribe → Stripe Checkout**: clicking Subscribe redirects to a
   Stripe-hosted Checkout URL (`checkout.stripe.com`).
6. **Card entry — parameterized by `STRIPE_MODE`** (see below).
7. **Post-subscribe**: Billing reflects an **active** subscription.

### Run — TEST mode (CI / fully automated)

Backend on Stripe **test** keys. Auto-fills the `4242 4242 4242 4242` test card.

```bash
cd frontend
STRIPE_MODE=test \
FF_EMAIL=admin@fuzefront.dev FF_PASSWORD=admin123 \
npx playwright test e2e/post-prod/subscribe-basic.spec.ts \
  --config playwright.post-prod.config.ts
```

### Run — LIVE mode (assisted; a human enters the real card)

Does **not** auto-fill a card. Asserts you reached the live Stripe Checkout page,
then `page.pause()` hands off so a human completes the one card step; the test
then resumes and runs the return / active-subscription assertions. Requires
`--headed` and a human; it is skipped under CI.

```bash
cd frontend
STRIPE_MODE=live \
FF_EMAIL=... FF_PASSWORD=... \
npx playwright test e2e/post-prod/subscribe-basic.spec.ts \
  --config playwright.post-prod.config.ts --headed
```

### Env vars

| Var | Default | Purpose |
| --- | --- | --- |
| `POST_PROD_BASE_URL` | `https://app.fuzefront.com` | target app |
| `FF_EMAIL` / `FF_PASSWORD` | `admin@fuzefront.dev` / `admin123` | login creds |
| `STRIPE_MODE` | `test` | `test` (auto 4242 card) or `live` (manual card handoff) |
| `FF_BASIC_PRICE` | `$9` | expected Basic price text |

### Deploy gate

The subscribe leg (steps 4–7) depends on the billing backend
(`/api/v1/billing/checkout`). If `GET /api/v1/billing/plans` is not yet serving
real plans, the spec **skips** the subscribe leg with a clear reason — steps 1–3
(login + create org + **workspace provisioning**, the previously-broken part)
still run and are asserted. Once `/checkout` is deployed, the subscribe leg runs
automatically with no spec change.

### Safety

Read-only against prod **except**: creates one uniquely-named test org and
(test mode only) one test-card subscription on it. Never enters a real card in
automation; never mutates other config/data.
