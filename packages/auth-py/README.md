# fuzefront-auth

Consumable authentication for **Python** FuzeFront-family services -- the peer of
[`@izzywdev/fuzefront-auth`](../auth). Same stable `Identity` shape, same error codes, same
fail-closed behaviour, with a Flask decorator and a FastAPI dependency.

> Verifies only. It **never mints** tokens. Any verification problem raises
> `AuthError` (or answers 401/403/500); there is no permissive fallback.

The token/claims contract is [`packages/auth/docs/TOKEN_CONTRACT.md`](../auth/docs/TOKEN_CONTRACT.md).
This package is a projection of it; where the two disagree the contract wins.

## Install

Distributed as a GitHub Release asset, like `fuzefront-identity` and
`fuzefront-service-auth`:

```bash
pip install https://github.com/izzywdev/FuzeFront/releases/download/auth-py-v0.2.0/fuzefront_auth-0.2.0-py3-none-any.whl

# with a framework adapter:
pip install "fuzefront-auth[flask] @ https://github.com/izzywdev/FuzeFront/releases/download/auth-py-v0.2.0/fuzefront_auth-0.2.0-py3-none-any.whl"
pip install "fuzefront-auth[fastapi] @ https://github.com/izzywdev/FuzeFront/releases/download/auth-py-v0.2.0/fuzefront_auth-0.2.0-py3-none-any.whl"
```

## Modes

| | `legacy-hs256` (today's session token) | `federated-jwks` (target) |
|---|---|---|
| Key | shared secret `FUZEFRONT_JWT_SECRET` | issuer's public JWKS (cached) |
| Algorithms | **HS256 only** | RS256/384/512, ES256/384 (never HS\*) |
| `exp` | required | required |
| `iss` / `aud` | enforced **when configured** (today's token carries neither) | **both required** and enforced |
| `tenant_id` / `roles` | `None` / `()` unless a `resolver` hydrates them | from the `tenantId` / `roles` claims |

`alg=none`, algorithm-confusion, expired, not-yet-valid, bad-signature, unknown-`kid`
and JWKS-outage tokens are all rejected.

Unlike the Node package, `federated-jwks` **requires** `audience`: a verifier that
accepts any audience accepts tokens minted for a different relying party.

## Use

```python
from fuzefront_auth import verifier_from_env

verifier = verifier_from_env()   # raises AuthError(500) at startup if misconfigured
```

Environment:

| Variable | Mode | |
|---|---|---|
| `FUZEFRONT_AUTH_MODE` | both | `legacy-hs256` or `federated-jwks` (unset = refuse to start) |
| `FUZEFRONT_JWT_SECRET` | legacy | required |
| `FUZEFRONT_JWT_ISSUER`, `FUZEFRONT_JWT_AUDIENCE` | legacy | optional; enforced when set |
| `FUZEFRONT_AUTH_ISSUER`, `FUZEFRONT_AUTH_AUDIENCE` | federated | required |
| `FUZEFRONT_AUTH_JWKS_URI` | federated | optional; else OIDC discovery |

Or build one explicitly: `create_verifier(LegacyHs256Config(secret=..., resolver=...))` /
`create_verifier(FederatedJwksConfig(issuer=..., audience=...))`.

### Flask

```python
from flask import g
from fuzefront_auth.middleware.flask import require_auth, require_roles, require_tenant

@app.get("/reports")
@require_auth(verifier)
@require_roles(["admin"])
def reports():
    return {"caller": g.identity.user_id}
```

### FastAPI

```python
from fastapi import Depends
from fuzefront_auth import Identity
from fuzefront_auth.middleware.fastapi import auth_dependency, require_roles

auth = auth_dependency(verifier)

@app.get("/reports")
def reports(identity: Identity = Depends(require_roles(auth, ["admin"]))):
    return {"caller": identity.user_id}
```

Dependencies are deliberately sync `def`: verification does blocking I/O and
FastAPI runs those in its threadpool.

### Status codes and bodies

401 = "who are you?" (re-authenticate); 403 = "I know who you are, and no";
500 = the verifier or resolver is broken, and 503 = the issuer's JWKS/discovery or the
portal lookup is unreachable (retryable; an outage must not read as a permission denial
or tell a client its credentials are invalid). Flask answers `{"error", "code"}`; FastAPI nests the same object under
`detail`. A role guard denies when roles are empty, and a tenant guard denies when
`tenant_id` is `None` -- an unresolved value is never a wildcard.

## Session revocation (legacy-hs256)

A signed token stays valid until `exp` (24h), but the session it names may have been ended
by a logout or a device revoke; only the session store knows. **A token that names a session
(every FuzeFront session token carries a `sessionId`) is therefore refused unless something
can check it.** Supply a validator and the verifier asks it before hydrating anything:

```python
LegacyHs256Config(secret=..., session_validator=lambda user_id, session_id, claims: session_is_active(session_id))
```

Only `True` keeps the session alive; anything else is a 401 `EXPIRED`, and a validator that
raises is a retryable 503. It runs before the resolver.

With no validator the default is **reject**: a 500 `VERIFIER_UNAVAILABLE` (a deployment
misconfiguration, not a bad credential, so it is loud rather than a 401 that sends the user
to log in again), and nothing is hydrated. A service that genuinely cannot reach FuzeFront's
session store can accept the revocation gap, deliberately and visibly:

```python
LegacyHs256Config(secret=..., allow_unvalidated_sessions=True)   # or FUZEFRONT_ALLOW_UNVALIDATED_SESSIONS=true
```

That flag only waives the *requirement* for a validator; a configured validator still runs.
Without one, a logged-out session keeps authenticating until the token expires. Tokens that
name no session (for example an OIDC `sub` token) are unaffected. The Node peer
[`@izzywdev/fuzefront-auth`](../auth) has the same rule from 0.4.0
(`allowUnvalidatedSessions` / `sessionValidator`).

## Portal-bound sessions

With multi-tenant portals on, FuzeFront mints session tokens carrying a `portalId`, and
the host rejects a token presented on a different portal. A Python service reachable
through several portal hosts must do the same: pass a resolver that returns the portal the
request arrived on, as a `ResolvedPortal(id, is_root)` (or `None` for no portal context).

```python
from fuzefront_auth import ResolvedPortal

def portal_for(req):                      # your own host -> portal lookup
    row = lookup_portal(req.host)
    return ResolvedPortal(id=row.id, is_root=row.is_root) if row else None

@require_auth(verifier, portal=portal_for)                  # Flask
auth = auth_dependency(verifier, portal=portal_for)         # FastAPI
```

Rules, all fail closed:

- A token with a `portalId` is accepted only if the resolver returns the same id (mismatch
  is 401). With no resolver configured it is rejected: a claimed binding with nothing to
  check it against never falls through.
- A token with no `portalId` (pre-portal / flag-off) has no verifiable binding, so it is
  valid only on the root portal: on a non-root portal it is a 401, as at the host. With no
  portal context (or no resolver) it is accepted.
- A resolver that raises, or returns anything other than `ResolvedPortal`/`None`, is a
  retryable 503, never a 401. `Identity.portal_id` carries the claim.

## Signing-key rules (federated-jwks)

A published key verifies a token only if it is a signing key (`use` is absent or `sig`,
`key_ops` absent or includes `verify`), its key type fits the token's algorithm, and any
`alg` the issuer pinned on it equals the token's. Tokens whose algorithm is not RS*/ES*
are refused before any key lookup.

## Never logs

This package does not log, and error messages are fixed strings: they never contain
the token, a token segment, or an exception message derived from one.

## Develop

```bash
cd packages/auth-py
pip install -e '.[dev]'
pytest
```

Tests use throwaway keys and a local JWKS server; no network, no real credentials.
