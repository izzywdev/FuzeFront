# `@izzywdev/fuzefront-auth` — Token & Claims Contract

> Published as `@izzywdev/fuzefront-auth` (workspace-internal name `@fuzefront/auth`, which is not installable). The Python peer is `fuzefront-auth`.

This document freezes the token/claims contract for both verification modes and
the HS256 → OIDC/JWKS migration path. **Consumers code against the stable
`Identity` shape and never against raw JWT claims**, so the migration is
transparent to them.

> This package **only verifies and normalizes** tokens. It **never mints** them
> (minting stays in the identity service). It is **fail-closed**: any
> verification problem yields `AuthError` / a `401`, never a permissive fallback.

## The stable output: `Identity`

Every verifier normalizes to the same shape (see `src/types.ts`):

| field       | type               | legacy-hs256                            | federated-jwks                                  |
| ----------- | ------------------ | --------------------------------------- | ------------------------------------------ |
| `userId`    | `string`           | from `userId` claim (always present)    | from `sub` claim                           |
| `tenantId`  | `string \| null`   | `null` unless out-of-band resolved      | from `tenantId` claim                      |
| `roles`     | `string[]`         | `[]` unless out-of-band resolved        | from `roles` claim                         |
| `email`     | `string?`          | out-of-band                             | from `email` claim                         |
| `authMode`  | `'legacy-hs256' \| 'federated-jwks'` | constant                    | constant                                   |
| `issuedAt`  | `number?`          | `iat`                                   | `iat`                                      |
| `expiresAt` | `number?`          | `exp`                                   | `exp`                                      |
| `issuer`    | `string?`          | absent                                  | `iss` (federation issuer URL)               |

**Contract guarantee:** `userId`, `tenantId`, `roles`, `authMode` are ALWAYS
present (`tenantId` may be `null`; `roles` may be `[]`). Consumers must treat
`tenantId === null` and `roles === []` as **unprivileged** and fail-closed on
tenant/role-scoped decisions.

## Mode 1 — `legacy-hs256` (interop TODAY)

Verifies FuzeFront's **current** token, verified against
`backend/src/routes/auth.ts` and `backend/src/middleware/auth.ts`:

- **Algorithm:** HS256 (default of `jsonwebtoken`; no `algorithm` option set).
- **Key:** the shared secret `JWT_SECRET`.
- **Claims present today:** `{ userId, sessionId? }` + `iat`/`exp` (24h TTL).
  - Local login emits `{ userId, sessionId }`; the OIDC-callback path emits `{ userId }` only.
  - **No `tenantId`, no `roles`** in the token — roles live in Postgres (`users.roles`)
    and are re-fetched per request by the current middleware.

Because the token lacks tenant/roles, `legacy-hs256` accepts an optional
`OutOfBandResolver` the host supplies (e.g. the same DB lookup the current
middleware does) to hydrate `tenantId`/`roles`/`email`. Without a resolver,
`tenantId` is `null` and `roles` is `[]` — safe by fail-closed default.

**Only a plain session authenticates.** A token carrying a `kind` claim —
`fuze-org-session` (Security API org exchange), `fuze-workload`, or
`fuze-delegation` — is a narrowed/machine credential that merely shares
`JWT_SECRET`; it is never a user session. The verifier throws `AuthError`
`INVALID_AUDIENCE` (401, fixed message, no token material) when `kind` is
present, *before* the resolver runs, so such a token is never hydrated with a
user's roles/tenant. This mirrors `backend/src/middleware/auth.ts` and the
Python `fuzefront-auth` verifier. `federated-jwks` is unaffected (`iss`/`aud`
enforced).

**A token that names a session is refused unless something can check it.** A signed
token stays valid until `exp` (24h), but a logout or device revoke ends the session
its `sessionId` names, and only the session store knows. `legacy-hs256` therefore
requires a `sessionValidator(userId, sessionId, claims)` (Node) /
`session_validator` (Python): only `true` keeps the session alive, anything else is a
401 `EXPIRED`, and a validator that throws is a retryable 503 `VERIFIER_UNAVAILABLE`.
It runs *before* the resolver. With no validator the verifier answers a loud 500
`VERIFIER_UNAVAILABLE` (a deployment misconfiguration, not a bad credential) and
hydrates nothing. A service that cannot reach the session store may accept the
revocation gap explicitly with `allowUnvalidatedSessions: true` (Node) /
`allow_unvalidated_sessions=True` (Python, or
`FUZEFRONT_ALLOW_UNVALIDATED_SESSIONS=true` via `verifier_from_env`); that flag only
waives the *requirement* for a validator and never disables a configured one. A
present-but-malformed `sessionId` is `MALFORMED`, never treated as "no session". Tokens
that name no session (the OIDC-callback path emits `{ userId }` only) are unaffected.
`federated-jwks` is unaffected.

```ts
import { createVerifier, requireAuth } from '@izzywdev/fuzefront-auth';

const verifier = createVerifier({
  mode: 'legacy-hs256',
  secret: process.env.JWT_SECRET!,      // same secret the identity service signs with
  // Required for session tokens (see above): true while the session is still active.
  sessionValidator: async (userId, sessionId) => sessionIsActive(sessionId),
  subjectClaim: 'userId',               // default
  resolver: {                           // optional hydration
    async resolve(userId) {
      const u = await db('users').where('id', userId).first();
      return { tenantId: u?.organization_id ?? null, roles: u?.roles ?? [], email: u?.email };
    },
  },
});

app.use('/api/private', requireAuth({ verifier }));
```

## Mode 2 — `federated-jwks` (TARGET)

Verifies the federated RS256/JWKS token directly, no shared secret:

- **Algorithm:** RS256 (asymmetric); public keys fetched from the provider **JWKS**.
- **Key discovery:** via OIDC discovery of `${issuer}/.well-known/openid-configuration`
  (federation issuer, server-side config), or an explicit `jwksUri`.
- **Validation:** signature, `exp`/`nbf` (with clock tolerance), `iss` (must equal
  the configured issuer), and `aud` when configured.
- **Claims:** `sub` → `userId`, `tenantId` claim → `tenantId`, `roles` claim →
  `roles`, `email` → `email`. Claim names are overridable in config.

```ts
const verifier = createVerifier({
  mode: 'federated-jwks',
  issuer: process.env.FEDERATION_ISSUER_URL!,
  audience: process.env.FEDERATION_CLIENT_ID,
  tenantClaim: 'tenantId',   // defaults shown
  rolesClaim: 'roles',
  subjectClaim: 'sub',
});
```

## Migration path: HS256 → OIDC/JWKS

The `Identity` shape is invariant, so **consumers do not change** across the
migration. Only the verifier config the host wires changes:

1. **Today — legacy-hs256.** All services verify the current HS256 token; tenant/roles hydrated out-of-band. `@izzywdev/fuzefront-auth` gives interop immediately without waiting on federated token issuance.
2. **Dual-accept (transition).** The federation provider begins issuing RS256/JWKS tokens carrying `tenantId`+`roles`. A host may run BOTH verifiers and try `federated-jwks` first, falling back to `legacy-hs256`, until all clients present the new token. (The package exposes both verifiers; the dual-accept composition is a small host-side wrapper — a follow-up impl detail, not a contract change.)
3. **OIDC-only.** Once all tokens are RS256/JWKS, drop `legacy-hs256`, remove `JWT_SECRET` from services, and rely on JWKS. `tenantId`/`roles` now come from the token itself; the out-of-band resolver is retired. **No consumer code change** — they still read `Identity`.

### What changes for whom

- **Consumers of `Identity`:** nothing. Same fields, same guarantees.
- **Host wiring `createVerifier`:** swaps `legacy-hs256` config for `federated-jwks` config (or runs both during transition).
- **Identity service (out of this package's scope):** starts issuing RS256 tokens with `tenantId`+`roles` claims — a backend slice tracked separately.

## Error contract

`requireAuth` responds `401` with `{ error, code }` (`AuthErrorBody`) on any
authn failure; `requireRoles`/`requireTenant` respond `403`. `verifyToken`
throws `AuthError` (`code` from the `AuthErrorCode` enum). See `openapi.yaml`
`AuthErrorBody` for the wire shape.

## Events

Session lifecycle is published on Kafka (Zod schemas in `@fuzefront/shared`):

- `identity.session.issued` (V1) — non-secret session metadata (never the token).
- `identity.session.revoked` (V1) — consumers drop cached identities on revoke.

Topic-prefix convention: `<domain>.<entity>.<pastTenseEvent>`, `V1`-versioned schemas.
