# Service URL convention (FuzeFront prod)

**Decision (2026-06-22): path-based routing under one app host. NOT per-service subdomains.**

All FuzeFront microservices are addressed as **paths under the single app host**:

```
https://app.fuzefront.com/api/v1/<service>/...
```

e.g. `https://app.fuzefront.com/api/v1/billing/...`, `/api/auth`, `/api/apps`.

We deliberately do **not** use `billing.app.fuzefront.com` / `<svc>.prod.fuzefront.com`
subdomains.

## Why path-based wins on ops

| Concern | Path-based (`/api/v1/billing`) | Subdomain (`billing.app.…`) |
|---|---|---|
| TLS | One wildcard/app cert, already issued | New cert (or wildcard mgmt) per service |
| DNS | Zero new records | New record per service |
| CORS | Same-origin — none needed | Cross-origin preflight + allow-list upkeep |
| Cookies/session | Shared on the apex automatically | SameSite/domain juggling |
| Ingress | One Ingress, longest-prefix rules | One Ingress/host block per service |
| Browser → service | Just `fetch('/api/v1/billing/...')` | Must know each service's FQDN |

## Default posture: internal-only, carve out the public bits

A service's routes are **cluster-internal by default** (reachable pod-to-pod via
Service DNS `fuzefront-<svc>:<port>`, guarded by the service's internal token).
The ingress exposes **only** the specific public paths a service needs.

Billing is the canonical example:
- **Public (ingress carve-out):** `POST /api/v1/billing/webhooks/stripe` only
  (Stripe-signature verified via `STRIPE_WEBHOOK_SECRET`). `pathType: Exact`.
- **Everything else** under `/api/v1/billing/*` stays internal. Browsers reach it
  **through the host backend**, which proxies same-origin `/api/v1/billing/*`
  to `fuzefront-billing-service:3006` adding `BILLING_INTERNAL_TOKEN`.

So the browser only ever talks to `app.fuzefront.com` (same origin); the host
backend is the trust boundary that holds the internal service token.

## Adding a new service

1. Pick its path prefix: `/api/v1/<service>`.
2. Keep it internal; expose public paths via an `{{- if .Values.<svc>.enabled }}`
   block in `deploy/helm/fuzefront/templates/ingress.yaml` (longest-prefix wins,
   so service-specific prefixes sit above the `/api` catch-all).
3. For browser-facing-but-not-public APIs, add a host-backend proxy route
   (`browser → backend → fuzefront-<svc>` with the service's internal token).
4. Generate the typed client (`@fuzefront/<svc>-client`) from the service's
   OpenAPI spec; UI imports it and calls same-origin paths.
