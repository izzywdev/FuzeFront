# `@fuzefront/authn`

Reference validator for the **[Fuze family AuthN federation contract](../../docs/auth/federation-authn-contract.md)** (`v1.0.0`).

Sibling Fuze-family services (e.g. FuzeKeys) are **independent OIDC resource
servers of the shared Authentik issuer**. They validate Authentik-issued
**RS256** tokens via the shared **JWKS**, scoped to their own `aud`. They never
consume FuzeFront's private HS256 BFF session token and never share `JWT_SECRET`.

This package gives a Node/TypeScript service a contract-compliant validator in a
few lines, built on [`jose`](https://github.com/panva/jose).

## Install

```bash
npm install @fuzefront/authn
# (private — resolves from GitHub Packages; see repo .npmrc)
```

## Usage — framework-agnostic

```ts
import { createAuthnValidator } from '@fuzefront/authn'

const validator = createAuthnValidator({
  // Exact `iss` claim value, trailing slash included.
  issuer: process.env.FUZE_AUTHN_ISSUER!, // .../application/o/fuzekeys/
  // This app's own audience (its Authentik client id).
  audience: process.env.FUZE_AUTHN_AUDIENCE!, // fuzekeys-client
  // The `jwks_uri` from the issuer's .well-known/openid-configuration.
  jwksUri: process.env.FUZE_AUTHN_JWKS_URI!,
})

const principal = await validator.validate(bearerToken)
// principal.sub  -> stable Authentik user id (federate local users on this)
// principal.email, .groups, .raw, ...
```

## Usage — Express middleware

```ts
import { requireFamilyAuth } from '@fuzefront/authn'

app.use(
  requireFamilyAuth({
    issuer: process.env.FUZE_AUTHN_ISSUER!,
    audience: process.env.FUZE_AUTHN_AUDIENCE!,
    jwksUri: process.env.FUZE_AUTHN_JWKS_URI!,
  })
)

app.get('/me', (req, res) => res.json(req.familyPrincipal))
```

On failure the middleware responds `401` with `{ error: <code> }` where `code` is
`missing_bearer_token` or `invalid_token` — it never throws into the error path.

## What it enforces (contract §2)

- Signature verified against the issuer's JWKS (by `kid`).
- `alg` **must** be `RS256`; `HS*` and `none` are rejected at construction.
- `iss` exact match; `aud` must contain this app's audience.
- `exp`, `iat`, `sub` required; ±60 s clock-skew leeway (configurable).

## Config

| Field | Required | Default | Notes |
|-------|----------|---------|-------|
| `issuer` | yes | — | Exact `iss` string (trailing slash matters). |
| `audience` | yes | — | This app's client id; `string \| string[]`. |
| `jwksUri` | yes\* | — | Prefer the discovery `jwks_uri`. \*Or supply `keySet`. |
| `algorithms` | no | `["RS256"]` | `HS*`/`none` rejected. |
| `clockToleranceSec` | no | `60` | Leeway on time claims. |
| `keySet` | no | remote JWKS | Test/advanced key resolver. |

## Test

```bash
npm run test   # vitest — mints RS256 tokens with an ephemeral keypair, no network
```

See [`src/validator.test.ts`](src/validator.test.ts) for an end-to-end worked
example (valid token passes; wrong-`aud`, wrong-`iss`, expired, missing-`sub`,
and `HS256` all rejected).
