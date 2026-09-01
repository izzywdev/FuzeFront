"""Tests for the Flask decorator, using Flask's test client and a fully mocked
verifier -- no real HTTP calls to a security-service.
"""

from __future__ import annotations

import json

import pytest

flask = pytest.importorskip("flask")
from flask import Flask, g  # noqa: E402

from fuzefront_service_auth import AuthorizationError, MachineTokenVerifier  # noqa: E402
from fuzefront_service_auth.middleware.flask import require_machine_identity  # noqa: E402


def make_http_post(responses):
    def http_post(url, payload, timeout):
        return responses.pop(0)

    return http_post


def active_body(subject="svc-caller"):
    return json.dumps({"active": True, "subject": subject, "scope": "orders:read", "expiresAt": 9999999999})


def build_app(verifier, authorize=None):
    app = Flask(__name__)
    require_identity = require_machine_identity(verifier, authorize=authorize)

    @app.route("/internal/reports")
    @require_identity
    def reports():
        return {"caller": g.machine_identity.subject}

    return app


def test_valid_token_reaches_the_view_with_identity_attached():
    verifier = MachineTokenVerifier(
        base_url="http://security-service:3000", http_post=make_http_post([(200, active_body())])
    )
    client = build_app(verifier).test_client()

    response = client.get("/internal/reports", headers={"Authorization": "Bearer good-token"})

    assert response.status_code == 200
    assert response.get_json() == {"caller": "svc-caller"}


def test_missing_header_is_rejected_401():
    verifier = MachineTokenVerifier(base_url="http://security-service:3000", http_post=make_http_post([]))
    client = build_app(verifier).test_client()

    response = client.get("/internal/reports")

    assert response.status_code == 401


def test_garbage_header_is_rejected_401():
    verifier = MachineTokenVerifier(base_url="http://security-service:3000", http_post=make_http_post([]))
    client = build_app(verifier).test_client()

    response = client.get("/internal/reports", headers={"Authorization": "not-a-bearer-token"})

    assert response.status_code == 401


def test_inactive_token_is_rejected_401_even_though_introspect_returned_200():
    verifier = MachineTokenVerifier(
        base_url="http://security-service:3000",
        http_post=make_http_post([(200, json.dumps({"active": False}))]),
    )
    client = build_app(verifier).test_client()

    response = client.get("/internal/reports", headers={"Authorization": "Bearer revoked-token"})

    assert response.status_code == 401


def test_authorization_hook_denial_returns_403():
    def deny(identity):
        raise AuthorizationError(f"{identity.subject} is not allowed")

    verifier = MachineTokenVerifier(
        base_url="http://security-service:3000", http_post=make_http_post([(200, active_body())])
    )
    client = build_app(verifier, authorize=deny).test_client()

    response = client.get("/internal/reports", headers={"Authorization": "Bearer good-token"})

    assert response.status_code == 403
