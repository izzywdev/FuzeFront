"""Tests for MachineTokenVerifier.

The single most important test in this package is
`test_inactive_token_with_http_200_is_rejected`: FuzeFront's introspection
endpoint ALWAYS answers HTTP 200 and expresses fail-closed semantics purely
in the response body's `active` boolean (see `verifier.py`'s module
docstring, which quotes the actual server route). A verifier that branches
on status code instead of the body fails OPEN the instant a caller does not
carefully re-derive that quirk themselves -- this package exists so nobody
has to.
"""

from __future__ import annotations

import json

import pytest

from fuzefront_service_auth import MachineTokenVerifier, TokenVerificationError


def make_http_post(responses):
    calls = []

    def http_post(url, payload, timeout):
        calls.append({"url": url, "payload": payload, "timeout": timeout})
        if not responses:
            raise AssertionError("http_post called more times than responses were queued")
        item = responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return item

    http_post.calls = calls
    return http_post


def active_body(subject="svc-b", scope="orders:read", tenant_id=None, expires_at=9999999999):
    return json.dumps(
        {"active": True, "subject": subject, "scope": scope, "tenantId": tenant_id, "expiresAt": expires_at}
    )


def test_verify_active_token_returns_identity():
    http_post = make_http_post([(200, active_body())])
    verifier = MachineTokenVerifier(base_url="http://security-service:3000", http_post=http_post)

    identity = verifier.verify_machine_token("some-token")

    assert identity.subject == "svc-b"
    assert identity.scope == "orders:read"
    call = http_post.calls[0]
    assert call["url"] == "http://security-service:3000/api/v1/security/tokens/introspect"
    assert call["payload"] == {"token": "some-token"}


def test_inactive_token_with_http_200_is_rejected():
    """THE regression test this package exists for.

    The server's actual introspection route returns `res.status(200).json({
    active: false })` both for a genuinely inactive token AND for its own
    internal error path. HTTP 200 is not a green light -- only
    `active: true` in the BODY is. A verifier that checked `status == 200`
    and stopped there would authenticate a revoked/expired/unknown token.
    """
    http_post = make_http_post([(200, json.dumps({"active": False}))])
    verifier = MachineTokenVerifier(base_url="http://security-service:3000", http_post=http_post)

    with pytest.raises(TokenVerificationError):
        verifier.verify_machine_token("revoked-token")


def test_connection_error_fails_closed():
    http_post = make_http_post([TimeoutError("connection timed out")])
    verifier = MachineTokenVerifier(base_url="http://security-service:3000", http_post=http_post)

    with pytest.raises(TokenVerificationError):
        verifier.verify_machine_token("some-token")


def test_malformed_body_fails_closed():
    http_post = make_http_post([(200, "{not valid json")])
    verifier = MachineTokenVerifier(base_url="http://security-service:3000", http_post=http_post)

    with pytest.raises(TokenVerificationError):
        verifier.verify_machine_token("some-token")


def test_missing_active_field_fails_closed():
    http_post = make_http_post([(200, json.dumps({"subject": "svc-b"}))])
    verifier = MachineTokenVerifier(base_url="http://security-service:3000", http_post=http_post)

    with pytest.raises(TokenVerificationError):
        verifier.verify_machine_token("some-token")


def test_non_boolean_active_field_fails_closed():
    http_post = make_http_post([(200, json.dumps({"active": "true"}))])
    verifier = MachineTokenVerifier(base_url="http://security-service:3000", http_post=http_post)

    with pytest.raises(TokenVerificationError):
        verifier.verify_machine_token("some-token")


def test_active_but_missing_subject_fails_closed():
    http_post = make_http_post([(200, json.dumps({"active": True}))])
    verifier = MachineTokenVerifier(base_url="http://security-service:3000", http_post=http_post)

    with pytest.raises(TokenVerificationError):
        verifier.verify_machine_token("some-token")


def test_unexpected_non_200_status_fails_closed():
    http_post = make_http_post([(500, "internal error")])
    verifier = MachineTokenVerifier(base_url="http://security-service:3000", http_post=http_post)

    with pytest.raises(TokenVerificationError):
        verifier.verify_machine_token("some-token")


def test_empty_token_fails_closed_without_a_network_call():
    http_post = make_http_post([])
    verifier = MachineTokenVerifier(base_url="http://security-service:3000", http_post=http_post)

    with pytest.raises(TokenVerificationError):
        verifier.verify_machine_token("")

    assert http_post.calls == []


def test_positive_result_is_cached_and_not_re_fetched():
    http_post = make_http_post([(200, active_body(expires_at=1000000))])
    fake_now = [0.0]
    verifier = MachineTokenVerifier(
        base_url="http://security-service:3000",
        http_post=http_post,
        clock=lambda: fake_now[0],
    )

    first = verifier.verify_machine_token("cached-token")
    second = verifier.verify_machine_token("cached-token")

    assert first == second
    assert len(http_post.calls) == 1


def test_cache_respects_token_exp_and_re_verifies_after_expiry():
    fake_now = [0.0]
    http_post = make_http_post(
        [
            (200, active_body(expires_at=100)),  # first call: cache entry capped at exp=100
            (200, json.dumps({"active": False})),  # after exp, must re-check -- now revoked
        ]
    )
    verifier = MachineTokenVerifier(
        base_url="http://security-service:3000",
        http_post=http_post,
        clock=lambda: fake_now[0],
    )

    verifier.verify_machine_token("short-lived-token")
    assert len(http_post.calls) == 1

    fake_now[0] = 200.0  # past the token's own exp
    with pytest.raises(TokenVerificationError):
        verifier.verify_machine_token("short-lived-token")
    assert len(http_post.calls) == 2


def test_a_failed_verification_is_never_cached():
    """Caching a negative result, even briefly, would let a just-revoked token
    keep authenticating for the cache TTL -- so failures must never be
    cached, and the very next call must re-check the server.
    """
    http_post = make_http_post(
        [
            (200, json.dumps({"active": False})),
            (200, active_body()),
        ]
    )
    verifier = MachineTokenVerifier(base_url="http://security-service:3000", http_post=http_post)

    with pytest.raises(TokenVerificationError):
        verifier.verify_machine_token("token-x")

    identity = verifier.verify_machine_token("token-x")
    assert identity.subject == "svc-b"
    assert len(http_post.calls) == 2
