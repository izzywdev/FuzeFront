"""Tests for the FastAPI dependency, using Starlette's TestClient and a REAL
legacy-hs256 verifier (verification here is pure/local -- no network -- so
there is nothing to mock).
"""

from __future__ import annotations

import time

import jwt
import pytest

fastapi = pytest.importorskip("fastapi")
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from fuzefront_auth import AuthError, Identity, LegacyHs256Config, create_verifier
from fuzefront_auth.middleware.fastapi import require_auth

SECRET = "test-secret-not-for-prod"


def token(claims: dict, exp_in: int = 3600) -> str:
    payload = {**claims, "exp": int(time.time()) + exp_in}
    return jwt.encode(payload, SECRET, algorithm="HS256")


def build_app(verifier, *, optional: bool = False):
    app = FastAPI()
    require_identity = require_auth(verifier, optional=optional)

    @app.get("/private")
    async def private(identity: Identity | None = Depends(require_identity)):
        if identity is None:
            return {"identity": None}
        return {"userId": identity.user_id}

    return app


def test_valid_token_reaches_the_route_with_identity_attached():
    verifier = create_verifier(LegacyHs256Config(secret=SECRET))
    client = TestClient(build_app(verifier))

    response = client.get("/private", headers={"Authorization": f"Bearer {token({'userId': 'u-1'})}"})

    assert response.status_code == 200
    assert response.json() == {"userId": "u-1"}


def test_missing_header_is_rejected_401_with_stable_body():
    verifier = create_verifier(LegacyHs256Config(secret=SECRET))
    client = TestClient(build_app(verifier))

    response = client.get("/private")

    assert response.status_code == 401
    assert response.json()["detail"] == {"error": "no bearer token presented", "code": "NO_TOKEN"}


def test_expired_token_is_rejected_401():
    verifier = create_verifier(LegacyHs256Config(secret=SECRET))
    client = TestClient(build_app(verifier))

    response = client.get(
        "/private", headers={"Authorization": f"Bearer {token({'userId': 'u-1'}, exp_in=-60)}"}
    )

    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "EXPIRED"


def test_bad_signature_is_rejected_401():
    verifier = create_verifier(LegacyHs256Config(secret=SECRET))
    client = TestClient(build_app(verifier))

    forged = jwt.encode(
        {"userId": "u-1", "exp": int(time.time()) + 3600}, "wrong-secret", algorithm="HS256"
    )
    response = client.get("/private", headers={"Authorization": f"Bearer {forged}"})

    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "INVALID_SIGNATURE"


def test_optional_route_continues_without_identity_on_missing_token():
    verifier = create_verifier(LegacyHs256Config(secret=SECRET))
    client = TestClient(build_app(verifier, optional=True))

    response = client.get("/private")

    assert response.status_code == 200
    assert response.json() == {"identity": None}


def test_refuses_to_build_without_a_verifier():
    with pytest.raises(AuthError):
        require_auth(None)
