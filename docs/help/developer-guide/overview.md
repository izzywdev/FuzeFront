---
title: Developer Guide Overview
description: How FuzeFront is put together, which packages are real, and where to start when you build on the platform.
audience: developer
order: 1
owner: "@izzywdev"
lastReviewed: 2026-10-26
status: published
---

# Developer Guide Overview

FuzeFront is a **Module Federation host shell**. The shell is the container application; products and micro-frontends are federated **remotes** that the shell discovers in an app registry and mounts at runtime. You build your product as a remote, register it, and the shell shows it in the launcher and side menu. Your product does not need a build-time dependency on the shell.

## Architecture

| Piece | What it is | Where it lives |
|---|---|---|
| Host shell | React 19 app that loads remotes and renders navigation, theme, and org context | `frontend/` |
| Remotes | Your micro-frontends, built with Vite and `@originjs/vite-plugin-federation` | Your own repo, or `clock-app/` as the in-repo reference |
| App registry | Stores each app's manifest (slug, menu label, remote entry, scope, module) | `services/app-registry-service/openapi.yaml`, `backend/applications/` |
| Backend | Express and Postgres services behind a same-origin `/api` base | `backend/`, `services/*` |
| Identity | Authentik provides OIDC single sign-on | Behind the Security API |
| Authorization | Permit decides what a signed-in user may do | Behind the Security API |
| Design system | The "fuse seam" tokens and primitives for the whole Fuze family | `@fuzefront/design-system` |
| Developer Portal | Catalog of OpenAPI specs and a sandbox | developers.fuzefront.com |

Two rules shape everything else. The frontend always talks to the API on a **same-origin base** (never an absolute API host), so it behaves the same under local TLS and production ingress. And FuzeFront runs on Kubernetes through Helm and ArgoCD, so deployment is GitOps (see [Deployment](deployment.md)).

## The package landscape

There is **no SDK package** to install. Do not look for `@fuzefront/sdk`; it does not exist. Integration is Module Federation plus a small set of focused packages:

| Package (source name) | Use it for |
|---|---|
| `@fuzefront/design-system` | Tokens and React primitives (the base your UI extends) |
| `@fuzefront/security-client` | Generated types and client for the Security API (sign-in, identity, authorization) |
| `@fuzefront/onboarding-kit` | Registration script, manifest schema, templates, and the Helm init container |
| `@fuzefront/feature-flags` | OpenFeature client over Unleash, with safe defaults |
| `@fuzefront/service-auth` | Service-to-service (client credentials) auth |
| `@fuzefront/auth` | Verifier and Express middleware for backend services |

Source names use the `@fuzefront/*` scope (`@fuzeone/*` for some selection-list clients). Packages are published privately to GitHub Packages, and the published names are mapped to the owner scope at publish time, so you install them with a scoped `.npmrc` and a token with `read:packages`. The authoritative install table is `docs/guides/BUILDING_ON_FUZEFRONT.md` in the repository.

## Toolchain floor

These are minimums, not targets: Node `>=24.0.0`, npm `>=10.0.0`, `react` and `react-dom` `^19.2.0`, and a Module Federation `requiredVersion` of `^19.0.0` that is identical to the host's. A React 18 app fails peer resolution against the published packages. See [The Module Federation contract](module-federation-contract.md) for why the last one matters most.

## Where to start

1. [Quickstart: build a micro-frontend](quickstart-build-a-microfrontend.md) - a working remote in a few files.
2. [The Module Federation contract](module-federation-contract.md) - the shared-singleton rules the shell depends on.
3. [Design system](design-system.md) - style with tokens, never raw values.
4. [Authentication and authorization](authentication-and-authorization.md) - sign-in and permission checks.
5. [Registering your app](registering-your-app.md) - manifest, naming rules, and the registry API.
6. [APIs and contracts](apis-and-contracts.md) - the contract-first workflow and where specs live.
7. [Developer Portal](developer-portal.md) - browse and try the APIs.
8. [Deployment](deployment.md) - GitOps for in-repo and external remotes.
9. [Troubleshooting](troubleshooting.md) - the failures you are most likely to hit.

If you only want to use the portal as an end user, start with the [Getting started](../user-guide/getting-started.md) guide instead.
