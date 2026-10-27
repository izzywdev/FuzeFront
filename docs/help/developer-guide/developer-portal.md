---
title: Developer Portal
description: What developers.fuzefront.com offers, who can sign in, and how the catalog and the Try it sandbox behave.
audience: developer
order: 8
owner: "@izzywdev"
lastReviewed: 2026-10-26
status: published
---

# Developer Portal

**developers.fuzefront.com** is the single place to discover, read, and try the OpenAPI contracts published across the Fuze family. It exists so you do not have to hunt through repositories for `openapi.yaml` files or touch a production system to see how an endpoint behaves. It is a separate app on its own subdomain (not a federated remote), built on `@fuzefront/design-system`. The design is in `docs/planning/developers-portal.md`; the service is `services/devportal-service/` and the SPA is `devportal-frontend/`.

## What you can do there

| Area | What it gives you |
|---|---|
| Home | What the portal is, quick links, and the sign-in call to action |
| Catalog | Browse specs by product and service, with search and product and tag filters |
| Spec viewer | One service's contract, with its operations listed by path, method, operation id, and tags |
| Try it (playground) | Exercise an operation safely in a sandbox |
| My access | Your developer membership status and remaining sandbox quota |

## Signing in

The portal uses the **same FuzeFront identity** as the rest of the platform (Authentik OIDC single sign-on). There is no separate credential. On first sign-in you are provisioned as a member of the platform's root organization with the **`Developer`** role.

That role is deliberately narrow. A Permit policy grants only reading the catalog (`DevPortalCatalog:read`) and using the sandbox (`DevPortalPlayground:use` and `view_history`). It does not grant access to any tenant's data or to other parts of the platform.

## The Try it sandbox never touches production

A Try it call goes through `devportal-service`, not to the host named in a spec's `servers` block. Today the sandbox is **spec-only**: it returns the operation's documented `example` response, or a value synthesized from the response schema, and makes no network call to any backend. Because of that, no real token is forwarded and no real data can be reached. Mock responses show the shape of an API, not its live behavior.

Calls are limited to 60 per rolling hour per developer, and you can review your own recent calls. Exceeding the limit returns `429`. A repository may in future opt in to a dedicated sandbox URL, but no such opt-in is implemented today.

Portal service endpoints, for reference (all under the portal's own origin, authenticated by its session cookie):

```http
GET  /v1/catalog
GET  /v1/catalog/{repo}/{service}
POST /v1/playground/try
GET  /v1/playground/quota
GET  /v1/playground/history
GET  /v1/me
```

The contract is `services/devportal-service/openapi.yaml`. A `403` means your session lacks the developer role; a `401` means you are not signed in.

## Availability

The portal ships behind the `fuzefront.devportal.enabled` feature flag, **default off**, and its workloads are deployed through the normal GitOps path. If you open the site and it is not live yet, the flag has not been turned on for your audience. The runbook for flag flips is `docs/runbooks/unleash-launcher-and-developer-flags.md`. See [Deployment](deployment.md) for how flags are used.

## How specs get into the catalog

This repository's specs are collected at build time and harvested when the service starts. A CI gate fails the build if a service that runs an HTTP server ships no `openapi.yaml`, or if a spec exists but is not registered for collection, so a published API cannot silently miss the catalog. See [APIs and contracts](apis-and-contracts.md).

## Tips

- Use the catalog to find the exact operation and field names before writing a client, then generate types from the spec rather than copying by hand.
- Treat a missing example in the sandbox as a documentation gap in the contract, and add an `example` to the spec.
- The portal covers the API surface. For narrative guidance, stay in this guide; start at the [Overview](overview.md).
