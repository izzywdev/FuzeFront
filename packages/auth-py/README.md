# fuzefront-auth

Python verifier + Flask/FastAPI middleware for the **FuzeFront platform auth
contract** -- the Python peer of the TypeScript
[`@fuzefront/auth`](../auth) runtime (`packages/auth`). Both packages
project the SAME `Identity` contract; if this package disagrees with it,
`@fuzefront/auth`'s `types.ts` wins and this package is the bug.

Tracked by [#1267](https://github.com/izzywdev/FuzeFront/issues/1267):
[#117](https://github.com/izzywdev/FuzeFront/issues/117) ("publish
`@fuzefront/auth`") shipped only the Node package, so Python backends
(Flask on MongoDB/Neo4j, FastAPI, etc.) across the family had no way to
adopt the platform auth contract and `gate-platform-auth` A1/S2 stayed red
for them.

Why PyJWT and not a second crypto stack: PyJWT (with its `[crypto]` extra,
pulling in `cryptography`) covers both HS256 and RS256/ES256, so this
package needs exactly one third-party dependency for either mode.

This package **never mints tokens** -- verification only -- and **never
logs token contents**, anywhere, including error paths and stack traces.
See `src/fuzefront_auth/verifier.py`'s module docstring for how that
guarantee is enforced (every failure funnels through one fixed-message
`AuthError` taxonomy; the original library exception is never chained).

## Install

Distributed as a **GitHub Release asset** (wheel + sdist), the same
mechanism `packages/identity-py` and `packages/service-auth-py` use --
GitHub Packages has no PyPI-style registry, and this is a
private/proprietary family package.

```bash
pip install https://github.com/izzywdev/FuzeFront/releases/download/auth-py-v0.1.0/fuzefront_auth-0.1.0-py3-none-any.whl

# with framework middleware:
pip install "fuzefront-auth[fastapi] @ https://github.com/izzywdev/FuzeFront/releases/download/auth-py-v0.1.0/fuzefront_auth-0.1.0-py3-none-any.whl"
pip install "fuzefront-auth[flask] @ https://github.com/izzywdev/FuzeFront/releases/download/auth-py-v0.1.0/fuzefront_auth-0.1.0-py3-none-any.whl"
```

## The `Identity` contract

```python
@dataclass(frozen=True)
class Identity:
    user_id: str                 # ALWAYS present
    tenant_id: str | None        # None when unresolved (legacy-hs256 w/o a resolver)
    roles: list[str]             # ALWAYS a list, never None
    email: str | None = None
    auth_mode: AuthMode = ...    # "legacy-hs256" | "federated-jwks"
    issued_at: int | None = None
    expires_at: int | None = None
    issuer: str | None = None
    claims: dict = ...           # escape hatch, NOT part of the stable contract
```

Field names are the snake_case spelling of the TypeScript `Identity`
(`userId` -> `user_id`, `tenantId` -> `tenant_id`, `authMode` -> `auth_mode`),
matching every other Python package in this repo
(`fuzefront_identity`, `fuzefront_service_auth`).

## Two modes

### `legacy-hs256` -- today's FuzeFront session token

Interop with the token `backend/src/routes/auth.ts` mints today: HS256 over
the shared secret, subject in `userId` (falling back to `sub` on the OIDC
callback path). The real token carries neither `tenantId`/`roles` nor (as
of #1267) `iss`/`aud` -- `iss`/`aud` are therefore **optional**: unset by
default (so today's token keeps validating unmodified), and enforced only
once you explicitly configure an expected value.

```python
import os
from fuzefront_auth import LegacyHs256Config, create_verifier

verifier = create_verifier(
    LegacyHs256Config(secret=os.environ["FUZEFRONT_JWT_SECRET"])
)
# Or, equivalently, read FUZEFRONT_JWT_SECRET / FUZEFRONT_JWT_ISS / FUZEFRONT_JWT_AUD
# from the environment directly:
verifier = create_verifier(LegacyHs256Config.from_env())

identity = verifier.verify(bearer_token)  # raises AuthError on ANY failure
print(identity.user_id, identity.roles, identity.tenant_id)
```

`exp` is **required** -- a token with no `exp` claim is rejected (unlike
PyJWT's own default, which only checks `exp` if present).

An out-of-band `resolver` hydrates `tenant_id`/`roles`/`email`, since the
current token carries none of them:

```python
class DbResolver:
    def resolve(self, user_id: str) -> dict:
        row = db.users.find_one(user_id)
        return {"tenant_id": row["org_id"], "roles": row["roles"]}

verifier = create_verifier(LegacyHs256Config(secret=secret, resolver=DbResolver()))
```

A resolver that raises fails the WHOLE verification closed
(`AuthError(code="VERIFIER_UNAVAILABLE")`) rather than silently returning an
unprivileged identity -- that would be indistinguishable from a genuine
permission denial and would mask an outage as an authz decision.

### `federated-jwks` -- the target federated mode

RS256/ES256, verified against the issuer's published JWKS (fetched once per
issuer and cached, honoring `jwks_cache_ttl_sec`). `issuer` and `audience`
are both **required** here, and so are `exp`/`iss`/`aud` on every token.

```python
from fuzefront_auth import FederatedJwksConfig, create_verifier

verifier = create_verifier(
    FederatedJwksConfig(issuer=os.environ["FUZEFRONT_JWT_ISSUER"], audience=os.environ["FUZEFRONT_JWT_AUDIENCE"])
    # jwks_uri omitted -- resolved via OIDC discovery of
    # `${issuer}/.well-known/openid-configuration`
)
# Or: create_verifier(FederatedJwksConfig.from_env())

identity = verifier.verify(bearer_token)
```

## Framework middleware

Both middleware modules attach the SAME `Identity` and return the SAME
`{"error": ..., "code": ...}` JSON body on denial as the TypeScript
`requireAuth()` (`packages/auth/src/middleware.ts`).

### FastAPI

```bash
pip install "fuzefront-auth[fastapi]"
```

```python
from fastapi import Depends, FastAPI
from fuzefront_auth import Identity
from fuzefront_auth.middleware.fastapi import require_auth

require_identity = require_auth(verifier)
app = FastAPI()

@app.get("/private")
async def private(identity: Identity = Depends(require_identity)):
    return {"userId": identity.user_id}
```

Verification runs in FastAPI's threadpool (`run_in_threadpool`) since the
first federated-jwks call may perform a blocking JWKS fetch.

### Flask

```bash
pip install "fuzefront-auth[flask]"
```

```python
from flask import Flask, g
from fuzefront_auth.middleware.flask import require_auth

require_identity = require_auth(verifier)
app = Flask(__name__)

@app.route("/private")
@require_identity
def private():
    return {"userId": g.identity.user_id}
```

Both decorators/dependencies take `optional=True` for a route that should
continue (with `identity=None`) rather than reject when no/an invalid token
is presented.

## Error taxonomy

Every failure raises `fuzefront_auth.AuthError`, carrying a stable `.code`
from the SAME vocabulary as the TypeScript sibling's `AuthErrorCode`
(`NO_TOKEN`, `MALFORMED`, `INVALID_SIGNATURE`, `EXPIRED`, `NOT_ACTIVE`,
`INVALID_ISSUER`, `INVALID_AUDIENCE`, `MISSING_CLAIM`, `JWKS_UNAVAILABLE`,
`VERIFIER_UNAVAILABLE`, `UNKNOWN`) and a suggested `.status`. The message is
always a fixed, human-readable string -- **never** the token, a secret, or
raw JWKS key material.

## Testing

```bash
pip install -e '.[dev]'
pytest -q
```

The suite is biased toward denial paths (expired, wrong-algorithm, `alg:
none`, bad-signature, wrong-issuer, wrong-audience -- in BOTH modes), since
this package is the gate every consuming service mounts: a false "allow" is
a family-wide breach, a false "deny" is merely an outage.
