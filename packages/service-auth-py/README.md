# fuzefront-service-auth

Python service-to-service (S2S) auth for **any** FuzeFront-family microservice
-- a caller-side client that acquires/caches machine-to-machine (M2M) access
tokens, and a callee-side verifier + framework middleware that validates
them. The Python peer of the TypeScript `packages/service-auth` runtime and
of the generated `@fuzefront/security-client` types.

Hand-authored from
[`packages/security/openapi.yaml`](../security/openapi.yaml) (`tokens` tag:
`POST /v1/security/tokens`, `POST /v1/security/tokens/introspect`). **That
spec is the frozen contract; this package is a projection of it.** If the
two disagree, the spec wins and this package is the bug.

Both halves talk ONLY to FuzeFront's own Security API -- never to the
underlying identity provider, which the contract deliberately hides. Core
client/verifier code is dependency-free (stdlib `urllib` only, mirroring
`fuzefront-config-client`/`fuzefront-identity`); framework middleware is
behind optional extras so it never forces a web framework onto a caller-only
service.

## Install

Distributed as a **GitHub Release asset** (wheel + sdist) -- the same
mechanism `packages/identity-py` and `packages/config-client-py` use.
GitHub Packages has no PyPI-style registry, and this is a
private/proprietary family package, so a signed Release asset is the
private-by-default artifact store the family already authenticates against:

```bash
pip install https://github.com/izzywdev/FuzeFront/releases/download/service-auth-py-v1.0.0/fuzefront_service_auth-1.0.0-py3-none-any.whl

# with framework middleware:
pip install "fuzefront-service-auth[fastapi] @ https://github.com/izzywdev/FuzeFront/releases/download/service-auth-py-v1.0.0/fuzefront_service_auth-1.0.0-py3-none-any.whl"
```

## Caller side: acquire a token

```python
import os
import requests  # or any HTTP client -- this package does not send your request
from fuzefront_service_auth import ServiceAuthClient, TokenRequestError

client = ServiceAuthClient(
    base_url="http://fuzefront-security-service:3000",  # Kubernetes Service DNS
    client_id=os.environ["FUZEFRONT_CLIENT_ID"],
    client_secret=os.environ["FUZEFRONT_CLIENT_SECRET"],
)

try:
    token = client.get_token()
except TokenRequestError:
    # Fail closed: never send the request unauthenticated.
    raise

response = requests.get(
    "http://other-service/internal/reports",
    headers={"Authorization": token.authorization_header},
)
```

`get_token()` caches the token in memory and only calls
`POST /api/v1/security/tokens` again shortly before the cached token expires
(a configurable safety margin, default 30s). Concurrent callers that land
during a refresh share the SAME in-flight HTTP request ("single-flight")
instead of each hammering the identity provider. Call `client.invalidate()`
to force the next `get_token()` to fetch a fresh token immediately (e.g.
after an unexpected 401 from a downstream call).

Every exception raised by this package is a `ServiceAuthError` (or a
subclass) carrying a stable `.code` and a suggested `.status`, using the
SAME code vocabulary as the TypeScript sibling's `ServiceAuthErrorCode`
(`MISCONFIGURED`, `TOKEN_REQUEST_FAILED`, `MALFORMED_RESPONSE`, `NO_TOKEN`,
`INTROSPECTION_UNAVAILABLE`, `TOKEN_INACTIVE`, `FORBIDDEN`, `UNKNOWN`) — the
FastAPI/Flask middleware below emits the same `{"error", "code"}` JSON body
shape the Express middleware does.

## Callee side: verify a token + framework middleware

```python
from fuzefront_service_auth import MachineTokenVerifier

verifier = MachineTokenVerifier(base_url="http://fuzefront-security-service:3000")

identity = verifier.verify_machine_token(bearer_token)  # raises TokenVerificationError on ANY failure
print(identity.subject, identity.scope, identity.tenant_id)
```

**`verify_machine_token` fails closed on every ambiguity** -- a connection
error, a timeout, a malformed body, a body missing a boolean `active` field,
or `active: false` all raise the SAME `TokenVerificationError`. This matters
because FuzeFront's introspection endpoint **always answers HTTP 200** and
expresses the fail-closed decision purely in the body:

```ts
// backend/security/src/routes/security.ts (the actual server route)
router.post('/tokens/introspect', async (req, res) => {
  try {
    const r = await getIdentityProvider().introspectToken(req.body.token)
    res.status(200).json(r)
  } catch (err) {
    res.status(200).json({ active: false })   // still 200!
  }
})
```

A verifier that checks `response.status_code == 200` and stops there will
authenticate a revoked, expired, or unknown token. This package never
branches on status code alone -- see
`tests/test_verifier.py::test_inactive_token_with_http_200_is_rejected` for
the regression test that proves it.

### FastAPI

```bash
pip install "fuzefront-service-auth[fastapi]"
```

```python
from fastapi import Depends, FastAPI
from fuzefront_service_auth import MachineIdentity, MachineTokenVerifier
from fuzefront_service_auth.middleware.fastapi import machine_identity_dependency

verifier = MachineTokenVerifier(base_url="http://fuzefront-security-service:3000")
require_machine_identity = machine_identity_dependency(verifier)

app = FastAPI()

@app.get("/internal/reports")
async def reports(identity: MachineIdentity = Depends(require_machine_identity)):
    return {"caller": identity.subject}
```

### Flask

```bash
pip install "fuzefront-service-auth[flask]"
```

```python
from flask import Flask, g
from fuzefront_service_auth import MachineTokenVerifier
from fuzefront_service_auth.middleware.flask import require_machine_identity

verifier = MachineTokenVerifier(base_url="http://fuzefront-security-service:3000")
require_identity = require_machine_identity(verifier)

app = Flask(__name__)

@app.route("/internal/reports")
@require_identity
def reports():
    return {"caller": g.machine_identity.subject}
```

Both middlewares reject a missing/malformed `Authorization` header and any
token that fails verification with `401`, and attach the verified
`MachineIdentity` to the request (`request.state.machine_identity` /
`flask.g.machine_identity`).

## Authorization seam (for when `/authz/*` goes live)

Verifying a token proves **who** is calling; it says nothing about **what**
they may do. Both middlewares accept an optional `authorize` hook, called
with the verified `MachineIdentity` after authentication succeeds -- raise
`AuthorizationError` to deny (mapped to HTTP `403`):

```python
from fuzefront_service_auth import AuthorizationError, MachineIdentity

def check_authz(identity: MachineIdentity) -> None:
    # Wire this to POST /api/v1/security/authz/check (or bulk-check) once
    # those routes are live -- this package does not call them itself, since
    # the request shape (single vs. bulk, which claim maps to which subject)
    # is a decision for the calling service, not this library.
    if not authz_client.check(identity.subject, resource="orders", action="read"):
        raise AuthorizationError(f"{identity.subject} may not read orders")

require_identity = machine_identity_dependency(verifier, authorize=check_authz)
```

See [`authz.py`](src/fuzefront_service_auth/authz.py) for the full seam
documentation.

## Caching

- **Caller side**: the acquired access token is cached and refreshed before
  its `expiresIn` lapses (with a safety margin) -- never one HTTP call per
  outbound request.
- **Callee side**: only POSITIVE (`active: true`) introspection results are
  cached, bounded by size (LRU) and capped at the token's own `expiresAt`
  claim (never longer). A failed/inactive result is **never** cached at any
  TTL -- caching it, even briefly, would let a just-revoked token continue
  authenticating for the cache's lifetime.

## Development

```bash
pip install -e ".[dev]"
pytest -q
```

## Delivered by

FuzeFront's S2S auth foundation (PR #837 shipped `@fuzefront/security-client`
as generated types only, with no runtime for either TypeScript or Python).
This package is the Python runtime half; `packages/service-auth` is its
TypeScript sibling. Both are projections of one frozen contract -- neither is
a second source of truth.
