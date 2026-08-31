"""Tests for the FastAPI dependency, using FastAPI's TestClient (httpx) and a
fully mocked verifier -- no real HTTP calls to a security-service.
"""

from __future__ import annotations

import json

import pytest

fastapi = pytest.importorskip("fastapi")
from fastapi import Depends, FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from fuzefront_service_auth import AuthorizationError, MachineTokenVerifier  # noqa: E402
from fuzefront_service_auth.middleware.fastapi import machine_identity_dependency  # noqa: E402


def make_http_post(responses):
    def http_post(url, payload, timeout):
        return responses.pop(0)

    return http_post


def active_body(subject="svc-caller"):
    return json.dumps({"active": True, "subject": subject, "scope": "orders:read", "expiresAt": 9999999999})


def build_app(verifier, authorize=None):
    app = FastAPI()
    require_identity = machine_identity_dependency(verifier, authorize=authorize)

    @app.get("/internal/reports")
    async def reports(identity=Depends(require_identity)):
        return {"caller": identity.subject}

    return app


def test_valid_token_reaches_the_handler_with_identity_attached():
    verifier = MachineTokenVerifier(
        base_url="http://security-service:3000", http_post=make_http_post([(200, active_body())])
    )
    client = TestClient(build_app(verifier))

    response = client.get("/internal/reports", headers={"Authorization": "Bearer good-token"})

    assert response.status_code == 200
    assert response.json() == {"caller": "svc-caller"}


def test_missing_header_is_rejected_401():
    verifier = MachineTokenVerifier(base_url="http://security-service:3000", http_post=make_http_post([]))
    client = TestClient(build_app(verifier))

    response = client.get("/internal/reports")

    assert response.status_code == 401


def test_garbage_header_is_rejected_401():
    verifier = MachineTokenVerifier(base_url="http://security-service:3000", http_post=make_http_post([]))
    client = TestClient(build_app(verifier))

    response = client.get("/internal/reports", headers={"Authorization": "not-a-bearer-token"})

    assert response.status_code == 401


def test_inactive_token_is_rejected_401_even_though_introspect_returned_200():
    verifier = MachineTokenVerifier(
        base_url="http://security-service:3000",
        http_post=make_http_post([(200, json.dumps({"active": False}))]),
    )
    client = TestClient(build_app(verifier))

    response = client.get("/internal/reports", headers={"Authorization": "Bearer revoked-token"})

    assert response.status_code == 401


def test_authorization_hook_denial_returns_403():
    def deny(identity):
        raise AuthorizationError(f"{identity.subject} is not allowed")

    verifier = MachineTokenVerifier(
        base_url="http://security-service:3000", http_post=make_http_post([(200, active_body())])
    )
    client = TestClient(build_app(verifier, authorize=deny))

    response = client.get("/internal/reports", headers={"Authorization": "Bearer good-token"})

    assert response.status_code == 403
