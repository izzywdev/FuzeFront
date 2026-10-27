---
title: APIs and Contracts
description: The contract-first workflow, where FuzeFront OpenAPI specs live, how they are versioned, and how they reach the Developer Portal.
audience: developer
order: 7
owner: "@izzywdev"
lastReviewed: 2026-10-26
status: published
---

# APIs and Contracts

FuzeFront is **contract-first**. The OpenAPI document is the source of truth for an API: you change the spec first, then regenerate clients and implement against it. Code that disagrees with the spec is the bug.

## Where the specs live

| Contract | Path |
|---|---|
| App registry | `services/app-registry-service/openapi.yaml` |
| Security (sign-in, identity, authorization) | `packages/security/openapi.yaml` |
| Auth | `packages/auth/openapi.yaml` |
| Billing | `services/billing-service/openapi.yaml` |
| Chat | `services/chat-service/openapi.yaml` |
| Config | `services/config-service/openapi.yaml` |
| Selection lists | `services/selection-list-service/openapi.yaml` |
| Portal | `services/portal-service/openapi.yaml` |
| Developer Portal service | `services/devportal-service/openapi.yaml` |

Others (payment, notification, email, SMS, custom hostnames, fuzepicker) follow the same `services/<name>/openapi.yaml` pattern. List the current set from the repository rather than relying on this table, and browse them rendered at the [Developer Portal](developer-portal.md).

## Workflow for a change

1. **Amend the spec.** Edit the service's `openapi.yaml` and bump `info.version`. The contract change, the regenerated client, and the version bump travel together as their own pull request, before implementation begins.
2. **Regenerate the client.** Typed clients such as `@fuzefront/security-client` and `@fuzefront/app-registry-client` are generated from the spec (the app-registry spec names `openapi-typescript`). Never hand-edit generated output.
3. **Implement against the contract.** Request and response shapes, status codes, and error bodies match the document exactly.
4. **Publish.** Merging the spec is what makes it available to developers; CI includes an OpenAPI conformance gate and a gate that fails when a service exposes HTTP but its spec never reaches the Developer Portal catalog.

## Contract conventions you will see

- **Same-origin base.** Paths are versioned and relative, for example `/api/v1/app-registry/apps` and `/api/v1/security/session`. Never prepend an absolute host.
- **`additionalProperties: false` on create bodies.** A client cannot supply an `id` for the thing being created. The owning service mints it.
- **Typed references.** An identifier that points at an existing entity is a reference; it is not a capability. Authorization comes from the token and a Permit decision.
- **Fail closed.** Authorization endpoints return a denial on error rather than a permissive default.
- **Errors have a shape.** The registry spec, for example, defines shared `Error`, `ValidationError`, `Unauthorized`, and `Forbidden` responses; code against those shapes, not against message text.

## Versioning

Each contract carries its own `info.version` (the app registry spec is at 1.5.0, the Developer Portal service at 0.1.0 at the time of writing; check the file for the current value). The Security API also exports `SECURITY_CONTRACT_VERSION` from its client; assert on the major version. Pin the generated client you depend on and review the spec diff before upgrading across a major.

## Consuming a contract from your service

```ts
import type { Identity } from '@fuzefront/security-client'

async function whoAmI(token: string): Promise<{ identity: Identity }> {
  const res = await fetch('/api/v1/security/session', {
    headers: { authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`session check failed: ${res.status}`)
  return res.json()
}
```

Prefer the generated client types over hand-written interfaces so that a contract change breaks your build, not your users.

## Publishing your own product's contract

If your product has an API, keep an `openapi.yaml` in your repository and follow the same rules. This repository's own specs are baked into the `devportal-service` image and harvested when it starts. For other repositories, the service has an internal, secret-protected push endpoint intended for a repository's CI to publish its spec on merge; it is not exposed publicly, so ask the platform team to wire your repository in. See [Developer Portal](developer-portal.md).

Related: [Authentication and authorization](authentication-and-authorization.md) and [Registering your app](registering-your-app.md).
