# FuzeInfra capability request — multi-tenant portal DNS/TLS + custom-domain provisioning

> **Status:** delegation request to **FuzeInfra** (cross-repo `@claude`). This is the **hard
> dependency** blocking **FF-EPIC-16 (self-service custom domains)**, story S2 (TLS status +
> FuzeInfra integration). Infra changes are owned by FuzeInfra — FuzeFront only consumes the
> resulting capability. Paste the prompt below into a FuzeInfra session/thread.

## Why this exists — the split

Tenant portals are addressable three ways; only one of them needs runtime provisioning:

| Addressing | Example | Infra need |
|-----------|---------|-----------|
| Tenant subdomain | `corpabc.fuzefront.com` | **One-time static**: wildcard DNS + wildcard TLS + wildcard ingress route. No per-tenant provisioning. |
| Path prefix | `app.fuzefront.com/p/corpabc` | **None** — FuzeFront routes internally from the path. |
| Customer-owned domain | `app.corpabc.com` (customer CNAMEs → us) | **Runtime provisioning capability** — register hostname, validate ownership, issue TLS, report status. Cannot be a Helm release per domain. |

So the customer-domain case is the one that needs a FuzeInfra-provided provisioning **API/microservice**
that FuzeFront calls at request time. In practice this is usually a thin authenticated wrapper over
**Cloudflare for SaaS (Custom Hostnames)** — Cloudflare does per-hostname DNS validation, cert issuance,
and SNI routing to a fallback origin — rather than a bespoke cert-manager operator. FuzeInfra decides the
mechanism; FuzeFront consumes the same small API contract either way.

**FuzeFront owns (not FuzeInfra):** the `Host`→portal resolution middleware, the `portal_domains` table,
generation of the domain-verification token, and all UI.

## The prompt to paste into FuzeInfra

```
@claude — FuzeInfra capability request from FuzeFront: multi-tenant portal DNS/TLS + custom-domain provisioning

## Context
FuzeFront is becoming a multi-tenant portal platform: one shared deployment serves many
white-label tenant portals, each addressable three ways —
  (a) tenant subdomain   corpabc.fuzefront.com
  (b) path prefix        app.fuzefront.com/p/corpabc   (no infra change; FuzeFront routes internally)
  (c) customer domain    app.corpabc.com  (customer CNAMEs/points DNS at us — Lovable/Replit style)
FuzeFront resolves the active portal from the Host header at request time. What we need from
FuzeInfra is the DNS, TLS, ingress, and — for (c) — a runtime provisioning capability, since we
cannot do a Helm release per customer domain.

FuzeFront owns (do NOT build these — listed so the boundary is clear): Host→portal resolution
middleware, the `portal_domains` table, generation of the domain-verification token, and all UI.

## Please provide / design

1. WILDCARD DNS — `*.fuzefront.com` → the existing FuzeFront ingress (Cloudflare zone
   `fuzefront.com`), excluding reserved hosts (`app`, `auth`, `*.prod`). One-time, static.

2. WILDCARD TLS — a certificate for `*.fuzefront.com` (cert-manager DNS-01 via the Cloudflare
   solver, or Cloudflare-terminated TLS if that's simpler on the tunnel path — you choose; tell us which).

3. INGRESS — route the wildcard host to the `fuzefront-frontend` service alongside the existing
   `app.fuzefront.com` rules (same `/api`, `/socket.io` fan-out). Review our chart changes.

4. CUSTOM-DOMAIN PROVISIONING (the core ask) — a runtime mechanism/microservice FuzeFront calls
   to attach an arbitrary customer domain WITHOUT a per-domain Helm release. We need an internal,
   authenticated API roughly like:
     - POST   /custom-hostnames        { domain }            → begins validation + cert issuance
     - GET    /custom-hostnames/{domain}                     → { verification: {method, record, value},
                                                                 dns_status, tls_status, active }
     - DELETE /custom-hostnames/{domain}                     → deprovision
   Please RECOMMEND the mechanism — strong preference for **Cloudflare for SaaS (Custom Hostnames)**
   with a fallback origin pointing at our ingress; alternative is cert-manager HTTP-01 + a small
   operator that materializes Ingress/Certificate objects. For whichever you pick, specify:
     - the domain-verification model (we generate a TXT `_fuzefront-verify.<domain>` — who checks it,
       or does Cloudflare's own hostname validation replace it?),
     - a pollable TLS-issuance status we can surface in our UI,
     - apex-domain guidance for customers (CNAME flattening vs A/ALIAS records to publish),
     - the credential/security model: who holds the Cloudflare API token, how FuzeFront authenticates
       to this service (internal service-DNS + token/mTLS), and that it's never exposed publicly.

5. AUTHENTIK — confirm per-portal OIDC redirect URIs on custom domains are reachable (no egress/
   ingress constraint). Authentik brands are configured from FuzeFront blueprints — no action unless
   brand-per-domain needs extra ingress.

6. COOKIE NOTE (FYI, no action) — subdomains keep the `fuzefront.com` auth cookie; custom domains use
   token-exchange on their own origin, so no cross-domain cookie is needed from infra.

## Constraints
- Prod is GitOps (no hand-deploys / no kubectl-patch under selfHeal).
- Want local parity on kind-fuzeinfra (wildcard `*.fuzefront.local` or equivalent + a stub of the
  custom-hostname API so we can develop EPIC-16 locally).

## Please respond with
The chosen custom-domain mechanism, the provisioning API contract (an OpenAPI sketch is ideal so we can
generate a client), any quota/cost limits (e.g. Cloudflare custom-hostname pricing/caps), and the
integration points — so we can freeze the FuzeFront EPIC-16 (self-service custom domains) contract
against it. This is the hard dependency blocking EPIC-16 story S2 (TLS status + FuzeInfra integration).
```

## What FuzeFront does with the response

- The provisioning API contract FuzeInfra returns becomes the client FuzeFront generates and calls from
  FF-EPIC-16 S2 (`[Backend] request/poll TLS issuance via FuzeInfra mechanism; tls_status transitions`).
- The wildcard DNS/TLS/ingress items unblock subdomain routing for FF-EPIC-10 (portal context resolution)
  and FF-EPIC-09 (default `<slug>.fuzefront.com` per portal).
- No FuzeFront custom-domain UI (FF-EPIC-16 S3) ships until this contract is frozen.
