# @fuzefront/auth

The consumable **authN/authZ client** for the FuzeFront family (resolves
[#117](https://github.com/izzywdev/FuzeFront/issues/117)). Every product verifies
tokens and gates routes through this one package, so identity handling — and the
eventual federated-JWKS migration — is uniform across the family.

> **Status: CONTRACT FREEZE (v0.1.0).** This PR freezes the public *interface*
> only. Runtime verification (JWKS fetch, `jsonwebtoken`/`jose`) is a **follow-up
> backend slice** — the frozen signatures throw `VERIFIER_UNAVAILABLE` on purpose.
> Consumers may code against the types now; do not depend on runtime behavior yet.

## Why

FuzeDeploy (#13) and FuzeMarket (FF-auth) are deploy-blocked on a shared auth
client. Rolling their own would fork identity handling across the family. This
package gives them **one stable `Identity` shape** and a **pluggable verifier**,
so they get interop with today's token immediately and migrate to the federated token
OIDC/JWKS later **without any consumer code change**.

## Public interface

```ts
import {
  verifyToken, createVerifier,           // token verification
  requireAuth, requireRoles, requireTenant, // Express middleware
  AuthError, AUTH_CONTRACT_VERSION,
  type Identity, type Verifier, type VerifierConfig,
} from '@fuzefront/auth';
```

- **`Identity`** — the stable normalized principal: `{ userId, tenantId: string | null, roles: string[], authMode, email?, ... }`. Invariant across the HS256 → OIDC migration.
- **`createVerifier(config)` / `verifyToken(token, verifier)`** — verify a raw bearer token → `Identity`. Fail-closed (throws `AuthError`). Never mints tokens.
- **`requireAuth({ verifier })`** — Express middleware: reads `Authorization: Bearer`, verifies, attaches `req.identity`, responds `401` on failure.
- **`requireRoles(roles, 'all'|'any')` / `requireTenant(tenantId)`** — authZ guards (respond `403`; fail-closed when tenant is unresolved).

`express` is an **optional peer dependency** — non-Express consumers can import
`verifyToken`/types without pulling Express in.

## Two verifier modes

| mode           | when       | key            | tenantId / roles                 |
| -------------- | ---------- | -------------- | -------------------------------- |
| `legacy-hs256` | today      | `JWT_SECRET`   | out-of-band resolver (token lacks them) |
| `federated-jwks`    | target     | federated JWKS | from token claims                |

Full token/claims contract + migration path: [`docs/TOKEN_CONTRACT.md`](./docs/TOKEN_CONTRACT.md).
HTTP surface + schemas: [`openapi.yaml`](./openapi.yaml).

## Install (private registry)

Published privately to **GitHub Packages** under `@fuzefront` (`access: restricted`).
Consumers need a scoped `.npmrc`:

```
@fuzefront:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

```sh
npm install @fuzefront/auth
```

## Contract lifecycle

This package is the **contract-first gate**: it is frozen and merged FIRST, then
the backend (runtime verifier impl), consumers, and tests fan out against it. Any
later change re-enters through the contract-designer — re-lint, re-version (bump
`version` + `CHANGELOG.md`), regenerate, ripple deliberately. See `CHANGELOG.md`.
