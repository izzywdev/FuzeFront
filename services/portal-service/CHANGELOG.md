# Portal API contract — changelog

The single source of truth is `services/portal-service/openapi.yaml`. Every change
bumps `info.version` here first, then the client (`@fuzefront/portal-client`) is
regenerated (`openapi-typescript`) and re-linted (Spectral). Any later change
re-enters through `contract-designer` — never around it.

## 1.1.0 — 2026-07-28

Aligns the domain-status vocabulary with FuzeInfra's shipped Custom Hostname API
(FF-EPIC-16 / FFRNT-91). The two contracts previously disagreed, which would have
made a `portal_domains` projection impossible to type.

### Changed — `TlsStatus` (BREAKING)
- Was `[none, pending, issued, failed]`; now
  `[none, pending_validation, pending_issuance, pending_deployment, active, expired, failed]`.
- These mirror FuzeInfra's normalized enum verbatim rather than re-mapping it.
  Their values are already mapped from Cloudflare's rawer vocabulary, and unknown
  upstream states deliberately map to a *pending* state, never to a failure — a
  second mapping layer here would only re-introduce the coupling FuzeInfra removed.
- `none` is retained as the FuzeFront-only value for `subdomain`/`path` domains,
  which the static wildcard certificate already serves.

### Changed — `VerificationStatus` (BREAKING)
- Was `[pending, verified, failed]`; now `[pending, verified, moved, blocked, failed]`,
  projecting FuzeInfra's `dns_status`.
- **Sourced from Cloudflare's `_cf-custom-hostname` validation, not from a
  FuzeFront-issued token.** FF-EPIC-16 originally specified generating a
  `_fuzefront-verify.<domain>` TXT record and polling DNS for it. That is dropped:
  it proves the same fact with a weaker verifier (our resolver, subject to caching
  and split-horizon) and adds a third record to every customer's onboarding.
  No such generator was ever implemented, so nothing was removed in code.

### Added — `PortalDomain.active` (BREAKING: new required field)
- The **only** field a caller may gate on before advertising a domain. True only
  when DNS, TLS, and in-cluster routing all agree.
- Deliberately not derivable from `tlsStatus` alone: a certificate can be live
  while routing is missing, which serves a valid certificate in front of a 404 —
  the worst failure mode to debug.

### Added — `PortalDomain.verificationRecords` / `cnameTarget` / `error`
- `verificationRecords[]` (new `DomainVerificationRecord` schema) carries the full
  ownership + certificate + routing record set the customer must publish. A UI must
  render all three; the ownership record alone does not make the domain work.
- `cnameTarget` is read from the API rather than hard-coded — the target is a
  public contract kept separate from the origin so the origin can be repointed
  without customer DNS changes.

> Safe to make breaking: `@fuzefront/portal-client` currently has no consumers in
> this repo, and `services/portal-service` has no implementation behind it yet.

## 1.0.0 — 2026-07-27 (frozen)

Initial freeze — the gate for the FF-EPIC-09 / FF-EPIC-10 multi-tenant-portal
fan-out (backend + frontend build against this).

### Added — public portal context (FF-EPIC-10-S2)
- `GET /api/v1/portal/context` — **public / pre-auth** boot endpoint. Returns
  `PortalContext` (id, slug, branding, identity policy, auth entry points) for the
  Host the request arrived on. Suspended portal ⇒ `403 PORTAL_SUSPENDED`.

### Added — portal self (FF-EPIC-14 portal-admin console)
- `GET /api/v1/portal/current` — the authenticated caller's own `Portal`, resolved
  from the session (`portalId` never accepted from the client). `x-pagination:
  exempt` (singleton). Cross-tenant ⇒ `403 FORBIDDEN_PORTAL`.

### Added — master-admin portal CRUD (FF-EPIC-09-S3, Permit platform-admin gated)
- `GET /api/v1/admin/portals` — cursor-paginated fleet list (`limit` default 25 /
  max 100, opaque `cursor`, `{ items, page }` envelope).
- `POST /api/v1/admin/portals` — provision a portal (`PortalCreate`). Duplicate
  slug ⇒ `409 SLUG_TAKEN`. New portal starts `provisioned-pending-invite`.
- `GET /api/v1/admin/portals/{portalId}` — read one portal.
- `PATCH /api/v1/admin/portals/{portalId}` — partial update (`PortalUpdate`);
  setting `status` performs suspend/resume (the transition the UI binds to).
  Suspending the root portal ⇒ `409 ROOT_PORTAL_PROTECTED`.
- `POST /api/v1/admin/portals/{portalId}/suspend` — semantic suspend action.
- `POST /api/v1/admin/portals/{portalId}/resume` — semantic resume action.
- `GET /health` — liveness/readiness.

### Schemas
`Portal`, `PortalContext`, `PortalBranding`, `PortalIdentityPolicy`,
`PortalAuthEntry`, `PortalSsoProvider`, `PortalDomain`, `PortalStatus`,
`BillingMode`, `DomainKind`, `VerificationStatus`, `TlsStatus`, `PortalCreate`,
`PortalUpdate`, `PortalPage`, `Page`, `ErrorBody`, `ValidationErrorBody`.

### Notes
- Authz stays in **Permit**; all portal capability is staged behind
  `fuzefront.platform.multi-tenant-portals` (default OFF, FF-EPIC-09-S4).
- Non-admin on any admin route ⇒ `403 FORBIDDEN` (authorization denial, never a
  sign-in redirect; only `401` re-authenticates).
- Paths are absolute and match exactly what the approved frames bind to
  (`design/frames/white-label-portal`, `design/frames/portal-admin-consoles`).
