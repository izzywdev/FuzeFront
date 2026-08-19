# @fuzefront/payment-service

The **vendor-neutral payment gateway** for FuzeFront. This service is the single
seam through which **all** payment-vendor interaction (Stripe today) is routed.
Consumers — `billing-service` and other products — talk only to its neutral
**Payment Provider API**; none of them touch a vendor SDK. That lets FuzeFront
swap the vendor, run two in parallel behind a flag, or insert pre/post hooks
(metrics, idempotency, transforms, retries) centrally without changing a single
call site.

> **Scaffold status.** This PR ships the gateway as a **runnable health service +
> frozen contract + adapter skeleton + deploy wiring**. The adapter methods are
> not yet wired to Stripe — they return `501 Not Implemented`. The live money
> path still lives in `billing-service`; it is absorbed here progressively. **This
> is not yet the live money path.**

- **Port:** `3007` (billing-service is `3006`).
- **Health:** `GET /health` → `{ "status": "ok", "service": "payment-service" }`.
- **API base:** `/api/v1/payments` (see `openapi.yaml`, version `0.1.0`).

## The vendor-swap boundary (port / adapter model)

```
consumers (billing-service, host proxy)
        │  neutral HTTP  (/api/v1/payments)
        ▼
  payment-service  ──►  PaymentProvider  (src/providers/payment-provider.ts)   ← the PORT
                              ▲
                              │  implements
                    StripePaymentProvider   (src/providers/stripe/…)           ← the ADAPTER
                              │
                              ▼
                         Stripe SDK   ← the ONLY place the vendor is touched
```

- **The port** (`src/providers/payment-provider.ts`) is a vendor-agnostic
  interface with neutral DTOs (cents, `Date`, lowercased currency, `provider*Id`).
  It is intentionally a **superset aligned with billing-service's own
  `PaymentProvider` port** (`services/billing-service/src/providers/payment-provider.ts`).
  That billing-service port is the **client** that will point at this gateway once
  the money path is migrated — the shapes are kept compatible so the seam is a
  drop-in.
- **The adapter** (`src/providers/stripe/stripe-payment-provider.ts`) is the
  **only** file allowed to import the Stripe SDK. **Swapping vendors = adding a
  sibling adapter** (e.g. `src/providers/adyen/…`) that implements the same port
  and pointing `PAYMENT_PROVIDER` at it. No call-site changes.

## The pre/post hook seam

Every vendor call in the adapter is wrapped in `ProviderHooks`
(`onBeforeCall` / `onAfterCall` / `onError`). This is where cross-cutting
concerns — metrics, idempotency keys, payload transforms, retries, audit — are
added once, centrally, without touching the neutral API or the consumers.

## Configuration

Runnable with **zero secrets** (degraded mode → `/health` only, like
billing-service's no-deps `createApp()`).

| Env | Default | Purpose |
|-----|---------|---------|
| `PORT` | `3007` | HTTP port |
| `PAYMENT_PROVIDER` | `stripe` | active vendor adapter (the swap knob) |
| `STRIPE_SECRET_KEY` | — (optional in scaffold) | vendor secret; absent → degraded mode |
| `PAYMENT_INTERNAL_TOKEN` | — | Bearer token guarding the neutral API (fail-closed when set) |

## Neutral API surface (`openapi.yaml`)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/customers` | create/upsert a payment customer |
| GET | `/customers/{customerId}` | retrieve a customer |
| GET | `/customers/{customerId}/invoices` | list a customer's invoices (paged) |
| POST | `/checkout-sessions` | open a hosted checkout session |
| POST | `/payment-methods/setup` | begin collecting a payment method |
| POST | `/webhooks/{provider}` | receive a vendor webhook (public, sig-verified) |

No vendor names appear in any path or schema. Neutral schema names: `Customer`,
`Invoice`, `CheckoutSession`, `PaymentMethodSetup`, `WebhookAck`.

## Develop / test

```bash
cd services/payment-service
npm install
npm run typecheck   # tsc --noEmit
npm test            # jest — asserts /health
npm run dev         # ts-node, live reload
```

## Deploy

Wired the same way as billing-service:

- **Local:** `docker-compose.yml` `payment-service` block (port `3007`).
- **Kubernetes:** `deploy/helm/fuzefront/templates/payment-service.yaml`
  (Deployment + Service, gated by `paymentService.enabled`, probes on `/health`),
  values in `values.yaml` / `values-prod.yaml`. Synced by the **umbrella
  `fuzefront` Argo Application** (hybrid-Argo: same rule as billing/unleash — a
  second Argo app on the same chart path would double-claim the Deployment; a
  dedicated app is only correct once the service is extracted into its own chart).
- **Secrets:** per-service `payment-secrets` SealedSecret scaffold
  (`deploy/contabo/sealed/payment-secrets.yaml`) — `STRIPE_SECRET_KEY`,
  `PAYMENT_INTERNAL_TOKEN`. Seal real values with
  `deploy/scripts/seal-secret.sh <KEY> --scope fuzefront/payment-secrets`.
- **CI image build** must be added to `.github/workflows/release.yml` — see
  `deploy/PENDING-WORKFLOW-CHANGES-payment-service.md` (the bot cannot edit
  workflows).
