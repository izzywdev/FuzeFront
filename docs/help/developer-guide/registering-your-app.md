---
title: Registering Your App
description: How an app gets into the FuzeFront registry, the three independent naming questions, and the registration API shape.
audience: developer
order: 6
owner: "@izzywdev"
lastReviewed: 2026-10-26
status: published
---

# Registering Your App

The shell discovers apps from the **app registry**. Registration stores your **manifest**, a declarative document describing how the shell mounts and labels your app. An app starts `registered` (not visible), becomes `activated` (visible in the launcher and menu), and can be `suspended` (hidden, record kept). The contract is `services/app-registry-service/openapi.yaml`, served under `/api/v1/app-registry`.

## The manifest

Required fields are `manifestVersion` (always `"1"`), `slug`, `name`, `menuLabel`, `mode`, and `integration`. A module-federation example:

```json
{
  "manifestVersion": "1",
  "slug": "fuzesales",
  "name": "Sales",
  "menuLabel": "Sales",
  "mode": "portal",
  "modes": ["portal", "standalone"],
  "integration": {
    "type": "module-federation",
    "remoteEntry": "/apps/fuzesales/assets/remoteEntry.js",
    "scope": "fuzesalesApp",
    "module": "./App"
  },
  "nav": { "section": "revenue", "order": 20 },
  "routing": { "path": "/app/fuzesales" },
  "visibility": "organization"
}
```

`integration.type` is one of `module-federation`, `iframe`, `web-component`, or `spa`. For module federation, `scope` is your federation `name` and `module` is the `exposes` key. `nav.section` places you in the side menu (`executive`, `plan`, `build`, `revenue`, `customer`, `insight`, `platform`); omit it and you land last in `platform`. Start from the valid-as-shipped templates in `@fuzefront/onboarding-kit` (`packages/onboarding-kit/templates/`).

## Three independent naming questions

`slug`, display name, and serve path are **three independent questions**. None implies another. The canonical statement is the section "`slug`, display name, and the federated serve path are THREE INDEPENDENT questions" in the repository's root `CLAUDE.md`. Read it before you choose; this is only a summary.

1. **`slug` is free at creation and immutable afterward.** Prefixed (`fuzepicker`) or unprefixed (`picker`) are both fine for a new app. There is no rename operation, so a redeploy under a changed slug registers a second app and strands the first, with orphaned authorization grants and a ghost tile. Never edit a slug.
2. **`name` and `menuLabel` drop the `Fuze` prefix.** Sixteen-plus products all reading "Fuze..." in one menu is noise, so register `"Sales"`, not `"FuzeSales"`. Both fields are mutable. The owner's two named exceptions are FuzeBI and FuzeX, where the remainder alone is meaningless.
3. **The serve path is independent of both.** The shell resolves `integration.remoteEntry` against its own origin; the slug is not an input. The convention is `/apps/<your slug>/`, and it must agree across four layers: the registered `remoteEntry`, Vite `base`, the Ingress `path`, and the nginx `location` or `alias`. If they disagree, fix the path, never the slug.

## The service mints ids

Registration never accepts a client-chosen id. The create body is `{ "manifest": {...}, "organizationId": "<existing org id>" }` with `additionalProperties: false`, so an `id` field is rejected. `organizationId` is optional and is a **reference** to an existing organization, not the identity of the new app. Your own services follow the same rule: mint ids on the server, and treat an id as an identifier, never a credential.

## The API

Paths are relative to the platform API base, which is same-origin from the shell; the onboarding kit's init container reaches the same routes through the cluster-internal applications service URL. Creating an app needs the `apps:register` scope.

```http
POST /api/v1/app-registry/apps
Content-Type: application/json
Authorization: Bearer <token>

{ "manifest": { "manifestVersion": "1", "slug": "fuzesales", "...": "..." } }
```

| Operation | Request | Notes |
|---|---|---|
| Register | `POST /api/v1/app-registry/apps` | `201`, status `registered`; `409` if the slug exists; `400` on a bad manifest |
| Read | `GET /api/v1/app-registry/apps/{slug}` | Full record including manifest |
| Replace manifest | `PUT /api/v1/app-registry/apps/{slug}` | `slug`, `builtin`, `manifestVersion` must match; needs `apps:write` |
| Activate | `POST /api/v1/app-registry/apps/{slug}/activate` | Idempotent; needs `apps:activate` |
| Suspend | `POST /api/v1/app-registry/apps/{slug}/suspend` | Hidden, record retained |
| Policy | `PUT /api/v1/app-registry/apps/{slug}/policy` | Your authorization resources and roles |
| Billing profile | `PUT /api/v1/app-registry/apps/{slug}/billing-profile` | Optional |

## Do not register by hand: use the onboarding kit

`@fuzefront/onboarding-kit` ships `register.sh`, an idempotent script run by a Helm **init container** before your pod starts. It registers, activates, then submits `policy.json` and `billing-profile.json`; on any unexpected result it exits non-zero so the pod does not start unregistered. Re-running refreshes the manifest, so a new `remoteEntry` or `nav` placement ships with the next deploy. Validate your files in CI:

```bash
npx fuzefront-validate-registration registration
```

The kit reads `FUZEFRONT_API_URL` and `FUZEFRONT_REGISTRATION_TOKEN`. That token is a **pre-shared platform secret** (a static string, not a JWT and not per-app) distributed as a sealed `fuzefront-registration` Secret; the procedure and the `401 invalid_registration_token` / `503 consumer_registration_unavailable` diagnoses are in `docs/mfe-self-registration.md`. The kit's validator also flags `Fuze`-prefixed `name`/`menuLabel` values, without a FuzeBI or FuzeX exception today.

Next: [Deployment](deployment.md), and [APIs and contracts](apis-and-contracts.md) for the registry's OpenAPI document. Users install registered apps as described in [Installing and using apps](../user-guide/installing-and-using-apps.md).
