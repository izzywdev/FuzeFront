"""Minimal FastAPI app showing how FuzeKeys wires the Fuze family AuthN contract.

Run:
    pip install -r requirements.txt
    export FUZE_AUTHN_ISSUER="https://auth.fuzefront.dev/application/o/fuzekeys/"
    export FUZE_AUTHN_AUDIENCE="fuzekeys-client"
    export FUZE_AUTHN_JWKS_URI="https://auth.fuzefront.dev/application/o/fuzekeys/jwks/"
    uvicorn app:app --reload

Then call a protected route with an Authentik-issued bearer token:
    curl -H "Authorization: Bearer $TOKEN" http://localhost:8000/me
"""
from __future__ import annotations

import os

from fastapi import Depends, FastAPI, Header, HTTPException

from fuze_authn import FamilyAuthValidator, FamilyPrincipal, FamilyTokenError

app = FastAPI(title="FuzeKeys (Fuze family AuthN example)")

# Construct the validator once at startup; it caches the JWKS.
validator = FamilyAuthValidator(
    issuer=os.environ["FUZE_AUTHN_ISSUER"],
    audience=os.environ["FUZE_AUTHN_AUDIENCE"],
    jwks_uri=os.environ["FUZE_AUTHN_JWKS_URI"],
)


def require_family_auth(authorization: str | None = Header(default=None)) -> FamilyPrincipal:
    """FastAPI dependency enforcing the contract; yields the validated principal."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail={"error": "missing_bearer_token"})
    token = authorization[len("bearer "):].strip()
    try:
        return validator.validate(token)
    except FamilyTokenError as exc:
        raise HTTPException(status_code=401, detail={"error": exc.code, "message": str(exc)})


@app.get("/me")
def me(principal: FamilyPrincipal = Depends(require_family_auth)) -> dict:
    # `sub` is the stable cross-family user id — federate local users on it.
    return {
        "sub": principal.sub,
        "email": principal.email,
        "groups": principal.groups,
    }
