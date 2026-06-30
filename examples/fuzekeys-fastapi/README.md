# FuzeKeys ↔ Fuze family AuthN — FastAPI reference

A worked, runnable example of a **sibling app (FuzeKeys)** implementing the
[Fuze family AuthN federation contract](../../docs/auth/federation-authn-contract.md)
(`v1.0.0`) in Python/FastAPI. This is the Python equivalent of the
[`@fuzefront/authn`](../../packages/authn/README.md) TS package.

FuzeKeys is an **independent OIDC resource server of the shared Authentik
issuer**: it validates Authentik-issued **RS256** tokens via the shared **JWKS**,
scoped to its own `aud` (`fuzekeys-client`). It never touches FuzeFront's
`JWT_SECRET` or FuzeFront's minted session token.

## Files

| File | Purpose |
|------|---------|
| `fuze_authn.py` | The reusable `FamilyAuthValidator` (drop into your service). |
| `app.py` | Minimal FastAPI app wiring the validator as a dependency. |
| `test_validator.py` | **End-to-end worked example** — mints RS256 tokens and validates them. |
| `requirements.txt` | `pyjwt[crypto]`, `fastapi`, `uvicorn`, `pytest`. |

## Run the worked example (no live Authentik needed)

```bash
pip install -r requirements.txt
pytest -q
```

The test suite mints Authentik-shaped tokens with an ephemeral RSA keypair and
proves the contract end-to-end: a well-formed token passes; wrong-`aud`,
wrong-`iss`, expired, missing-`sub`/`iat`, and `HS256` are all rejected.

## Run against live Authentik

```bash
export FUZE_AUTHN_ISSUER="https://auth.fuzefront.dev/application/o/fuzekeys/"
export FUZE_AUTHN_AUDIENCE="fuzekeys-client"
# Resolve jwks_uri from ${FUZE_AUTHN_ISSUER}.well-known/openid-configuration:
export FUZE_AUTHN_JWKS_URI="https://auth.fuzefront.dev/application/o/fuzekeys/jwks/"

uvicorn app:app --reload
curl -H "Authorization: Bearer $TOKEN" http://localhost:8000/me
```

A valid token returns the principal `{ sub, email, groups }`; anything else gets a
`401` with a stable `{ "error": "<code>" }` body.

> **Prerequisite (FuzeInfra / cluster):** a `fuzekeys` OAuth2/OIDC provider must be
> registered in the shared Authentik with `client_id = fuzekeys-client`. That is a
> FuzeInfra change (delegated via `@claude`) and is tracked under the contract's
> deploy milestone.
