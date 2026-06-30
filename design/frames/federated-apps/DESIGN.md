# Federated App Platform — Detailed Design / Contract Freeze

> **Status:** contract-freeze (detailed design). This document + the artifacts it
> references are the **dependency gate** for the implementation fan-out. No
> backend/UI/test/deploy code is written here — only the interface and the
> human-approval UX frames.
>
> Owner: `contract-designer`. Amend this PR (don't diverge) if implementation
> proves the contract wrong.

## 1. What exists today (so we extend, not reinvent)

The applications-service (`backend/applications/`) already owns an **App registry**:

- **DB model** (`001_create_apps_table.ts` + `002_update_apps_for_organizations.ts`):
  `apps(id, name, url, icon_url, is_active, integration_type, remote_url, scope,
  module, description, metadata, organization_id, visibility, marketplace_metadata,
  is_marketplace_approved, …)`.
- **TS type** `App` in `@fuzefront/core` (`backend/core/src/types/shared.ts`).
- **REST** mounted at `/api/apps`: `GET /api/apps`, `POST /api/apps` (admin),
  `PUT /api/apps/:id/activate`, `DELETE /api/apps/:id`,
  `POST /api/apps/register` (no-auth demo), `POST /api/apps/:id/heartbeat`.
  Validation is **hand-rolled**; **no frozen OpenAPI** (only inline `@swagger`
  JSDoc); events are **Socket.io** (`app-registered`, `app-status-changed`), not
  Kafka.
- **MF host shell** loads remotes **dynamically at runtime** via
  `frontend/src/utils/loadFederatedApp.ts`
  (`__federation_method_setRemote/getRemote`), routed at `/app/:appId`
  (`FederatedAppLoader.tsx`). `integration_type ∈
  {module-federation, iframe, web-component, spa}` (`spa` has **no loader branch**
  today — a gap).
- **Menu:** the launcher grid (`AppSelector.tsx`) shows `GET /api/apps`
  active apps; the side menu (`SidePanel.tsx`) has hardcoded **portal** items plus
  **app** items that a loaded remote pushes at runtime through the platform bridge
  `window.__FUZEFRONT__.menu.add(appId, items)` (`frontend/src/platform/bridge.ts`,
  `CONTRACT_VERSION = 1`).
- **No concept** of: app `mode` (portal vs standalone), full menu **substitution**,
  or running an app **outside** the shell chrome.

### Decision: extend the applications-service, add a thin contract surface

We **do not** create a brand-new service. We **freeze a contract over the existing
applications-service** under the versioned path `/api/v1/app-registry`, mirroring
the billing precedent (`services/billing-service/openapi.yaml` +
`@fuzefront/billing-client`). The new generated client is **`@fuzefront/app-registry-client`**.

Net-new surface this contract adds to the existing service:

| Capability | Mechanism |
|---|---|
| 1. Registration + activation lifecycle | extend `apps` rows with a **manifest** + an explicit `status` lifecycle (`registered → activated → suspended`) |
| 2. Menu substitution | new manifest field `chrome.menu = "host" \| "substitute"` (+ declared menu items) |
| 3. standalone / non-portal apps | new manifest field `mode = "portal" \| "standalone"` + routing/infra opt-ins |
| 4. built-in Clock app | a **seed** manifest entry, `slug: "clock"`, `builtin: true` |

The **App Manifest** is the heart of this contract: a single declarative document
(submitted at registration, stored on the row, served back on read) that fully
describes how the host mounts and chromes the app. UI, backend, and tests all
consume the **same generated `Manifest` type**, so drift is a compile error.

## 2. The package / service boundary + public interface

- **Service:** the existing `backend/applications/` (applications-service),
  contract-frozen as `services/app-registry-service/openapi.yaml`. Public HTTP
  interface = that OpenAPI doc, served under `{baseUrl}/api/v1/app-registry`.
- **Shared client package:** `@fuzefront/app-registry-client` (private, GitHub
  Packages, `access: restricted`) — generated `schema.ts` (openapi-typescript) +
  hand-wrapped axios client, exactly like `@fuzefront/billing-client`.
- **Event contract:** Kafka topics `app.registered`, `app.activated`,
  `app.suspended`, `app.heartbeat` with Zod schemas in `shared/src/kafka/schemas/`
  (these are the durable, cross-service successors to the Socket.io emits; the host
  may keep Socket.io as a live UI push, but the **system-of-record events are
  Kafka**).
- **Manifest schema:** lives in the OpenAPI `components.schemas.AppManifest` and is
  re-exported from the client. A JSON-Schema copy ships at
  `services/app-registry-service/manifest.schema.json` for non-TS validators
  (CI, the seed loader).

## 3. The App Manifest (v1) — field summary

```jsonc
{
  "manifestVersion": "1",
  "slug": "clock",                 // url-safe unique id, immutable
  "name": "Clock",                  // display name
  "menuLabel": "Clock",            // label in the application menu/launcher
  "description": "…",
  "icon": { "kind": "emoji" | "url", "value": "🕐" | "https://…" },
  "mode": "portal" | "standalone", // (3) portal = mounted in shell; standalone = own host/path, no chrome
  "builtin": false,                 // (4) shipped with the platform, cannot be deleted
  "integration": {
    "type": "module-federation" | "iframe" | "web-component" | "spa",
    "remoteEntry": "https://…/remoteEntry.js",  // FULL entry URL (freezes the base-vs-entry ambiguity)
    "scope": "clockApp",
    "module": "./ClockApp",
    "url": "https://…"             // iframe/standalone navigable URL
  },
  "chrome": {                       // (2) menu substitution
    "menu": "host" | "substitute", // host = portal side menu stays; substitute = app owns the whole side menu
    "topbar": "host" | "hidden",
    "items": [ { "id", "label", "icon?", "route?", "order?" } ]  // app-declared menu items
  },
  "routing": {                      // mostly for standalone
    "path": "/clock",              // portal route suffix OR standalone path
    "host": "clock.fuzefront.com"  // standalone only (optional; path-based default)
  },
  "visibility": "private" | "organization" | "public" | "marketplace",
  "roles": ["admin", "member"],   // who may see/activate it
  "infra": {                        // (3) standalone infra opt-ins
    "auth": true, "billing": false, "api": true, "deployOnFuzeInfra": true
  }
}
```

Lifecycle: `registered` (manifest accepted, not visible) → **activate** →
`activated` (visible in menu/launcher) → `suspend` → `suspended` (hidden, retained).
`builtin` apps may be suspended but not deleted.

### Menu substitution contract (capability 2)

When the active app's manifest has `chrome.menu = "substitute"`:
- the host **yields** its portal side menu (Organizations/Profile/Billing/… are
  hidden) and renders the app's `chrome.items` instead;
- the host **always** retains a minimal "return to portal" affordance (a back/home
  control) so the user is never trapped — this is a host guarantee, not app-supplied;
- on app exit/deactivate the host **restores** its own chrome.
- `chrome.menu = "host"` (default) keeps the portal menu; the app may still push
  `category:'app'` items at runtime via the existing bridge (backward compatible).

### standalone contract (capability 3)

`mode = "standalone"` apps:
- render with **no portal chrome** (no side menu, no topbar) — `chrome` is ignored
  except `topbar` may stay `hidden`;
- are routed by `routing.path` (path-based default, e.g. `/clock`) or an optional
  dedicated `routing.host`;
- opt into platform infra via `infra.*` (auth/identity, billing, API, deploy on
  FuzeInfra). A standalone landing page typically sets
  `{ auth:false, billing:false, api:false, deployOnFuzeInfra:true }`.
- still appear in the registry and (if visible) the launcher, but clicking them
  navigates to the standalone surface rather than mounting `/app/:appId`.

## 4. Decisions the human must approve (see PR description)
Listed in the PR body. The HTML frames in this directory are the UX those
decisions produce — approve the frames = approve the model.
