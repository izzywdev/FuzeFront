# @fuzefront/auth

The consumable **authN/authZ client** for the FuzeFront family (resolves
[#117](https://github.com/izzywdev/FuzeFront/issues/117)). Every product verifies
tokens and gates routes through this one package, so identity handling — and the
eventual federated-JWKS migration — is uniform across the family.

> **Status: IMPLEMENTED (v0.2.0).** The runtime is real — `createVerifier`,
> `verifyToken`, `requireAuth`, `requireRoles` and `requireTenant` all work. The
> public signatures are unchanged from the v0.1.0 freeze, so code written against
> the frozen types keeps compiling; it now also *runs*. Verification is backed by
> [`jose`](https://github.com/panva/jose) (one dependency covers HS256 today and
> RS256/JWKS for the federated target).

## Install

```bash
npm install @fuzefront/auth        # + express, if you use the middleware
```

## Use it as middleware

```ts
import express from 'express'
import { createVerifier, requireAuth, requireRoles } from '@fuzefront/auth'

// Today's FuzeFront session token (HS256 over the shared JWT_SECRET).
// It carries no tenant/roles, so hydrate them out-of-band if you gate on them.
const verifier = createVerifier({
  mode: 'legacy-hs256',
  secret: process.env.JWT_SECRET!,
  resolver: {
    async resolve(userId) {
      const row = await db('users').where({ id: userId }).first()
      return { tenantId: row?.org_id ?? null, roles: row?.roles ?? [] }
    },
  },
})

const app = express()
app.use('/api/private', requireAuth({ verifier }))          // 401 if not authenticated
app.get('/api/private/admin', requireRoles(['admin']), h)   // 403 if not permitted
app.get('/api/private/me', (req, res) => res.json(req.identity))
```

Migrating to federated JWKS later is a config change, not a code change:

```ts
const verifier = createVerifier({
  mode: 'federated-jwks',
  issuer: process.env.OIDC_ISSUER!,   // jwks_uri resolved via discovery
  audience: 'fuzefront',
})
```

### Guarantees worth knowing

- **Fail-closed everywhere.** Every failure throws `AuthError`; no path returns a
  permissive identity. `requireAuth` never calls `next()` on an unauthenticated
  request.
- **Algorithms are pinned per mode.** `legacy-hs256` accepts only `HS256`;
  `federated-jwks` accepts only asymmetric algs. This is what blocks algorithm
  confusion (e.g. a token that names `alg: none`, or an RS256 public key abused
  as an HMAC secret).
- **`tenantId: null` means UNRESOLVED, never "any tenant".** `requireTenant`
  denies on null rather than treating it as a wildcard.
- **A resolver failure denies** rather than yielding an identity with empty roles
  — otherwise an outage would be indistinguishable from a permission decision.
- **This package never mints tokens.** Verification only. In `federated-jwks`
  mode a consumer holds no signing key at all.
- **`express` is an optional peer** — import `verifyToken`/types without it.

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

This package is the **contract-first gate**: its interface was frozen and merged FIRST, then
the backend (runtime verifier impl), consumers, and tests fan out against it. Any
later change re-enters through the contract-designer — re-lint, re-version (bump
`version` + `CHANGELOG.md`), regenerate, ripple deliberately. See `CHANGELOG.md`.
