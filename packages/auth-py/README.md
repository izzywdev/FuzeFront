# fuzefront-auth

Consumable authentication for **Python** FuzeFront-family services -- the peer of
[`@fuzefront/auth`](../auth). Same stable `Identity` shape, same error codes, same
fail-closed behaviour, with a Flask decorator and a FastAPI dependency.

> Verifies only. It **never mints** tokens. Any verification problem raises
> `AuthError` (or answers 401/403/500); there is no permissive fallback.

The token/claims contract is [`packages/auth/docs/TOKEN_CONTRACT.md`](../auth/docs/TOKEN_CONTRACT.md).
This package is a projection of it; where the two disagree the contract wins.

## Install

Distributed as a GitHub Release asset, like `fuzefront-identity` and
`fuzefront-service-auth`:

```bash
pip install https://github.com/izzywdev/FuzeFront/releases/download/auth-py-v0.1.0/fuzefront_auth-0.1.0-py3-none-any.whl

# with a framework adapter:
pip install "fuzefront-auth[flask] @ https://github.com/izzywdev/FuzeFront/releases/download/auth-py-v0.1.0/fuzefront_auth-0.1.0-py3-none-any.whl"
pip install "fuzefront-auth[fastapi] @ https://github.com/izzywdev/FuzeFront/releases/download/auth-py-v0.1.0/fuzefront_auth-0.1.0-py3-none-any.whl"
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
500 = the verifier or resolver is broken (an outage must not read as a permission
denial). Flask answers `{"error", "code"}`; FastAPI nests the same object under
`detail`. A role guard denies when roles are empty, and a tenant guard denies when
`tenant_id` is `None` -- an unresolved value is never a wildcard.

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
