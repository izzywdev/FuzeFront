# Portal API contract — changelog

The single source of truth is `services/portal-service/openapi.yaml`. Every change
bumps `info.version` here first, then the client (`@fuzefront/portal-client`) is
regenerated (`openapi-typescript`) and re-linted (Spectral). Any later change
re-enters through `contract-designer` — never around it.

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
