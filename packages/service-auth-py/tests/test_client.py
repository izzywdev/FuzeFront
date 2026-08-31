"""Tests for ServiceAuthClient: caching, refresh-before-expiry, single-flight,
and fail-closed handling of transport/response errors.

The HTTP layer is mocked throughout via the `http_post` constructor override
-- no real network calls are made.
"""

from __future__ import annotations

import json
import threading
import time

import pytest

from fuzefront_service_auth import ServiceAuthClient, TokenRequestError


def make_http_post(responses):
    """Return an `http_post(url, payload, timeout)` stub that pops from `responses`
    and records every call in `.calls`.
    """
    calls = []

    def http_post(url, payload, timeout):
        calls.append({"url": url, "payload": payload, "timeout": timeout})
        if not responses:
            raise AssertionError("http_post called more times than responses were queued")
        item = responses.pop(0)
        if isinstance(item, Exception):
            raise item
        status, body = item
        return status, body

    http_post.calls = calls
    return http_post


def token_body(access_token="tok-1", expires_in=3600, token_type="Bearer", scope=None):
    body = {"accessToken": access_token, "tokenType": token_type, "expiresIn": expires_in}
    if scope is not None:
        body["scope"] = scope
    return json.dumps(body)


def test_get_token_calls_the_contract_endpoint_and_returns_the_token():
    http_post = make_http_post([(200, token_body())])
    client = ServiceAuthClient(
        base_url="http://security-service:3000",
        client_id="svc-a",
        client_secret="s3cr3t",
        http_post=http_post,
    )

    token = client.get_token()

    assert token.access_token == "tok-1"
    assert token.token_type == "Bearer"
    assert token.authorization_header == "Bearer tok-1"
    assert len(http_post.calls) == 1
    call = http_post.calls[0]
    assert call["url"] == "http://security-service:3000/api/v1/security/tokens"
    assert call["payload"] == {"clientId": "svc-a", "clientSecret": "s3cr3t"}


def test_get_token_never_fetches_per_call_when_still_fresh():
    """A cached, non-expiring-soon token must not trigger a second HTTP call."""
    http_post = make_http_post([(200, token_body(expires_in=3600))])
    client = ServiceAuthClient(
        base_url="http://security-service:3000",
        client_id="svc-a",
        client_secret="s3cr3t",
        http_post=http_post,
    )

    first = client.get_token()
    second = client.get_token()
    third = client.get_token()

    assert first is second is third
    assert len(http_post.calls) == 1


def test_refresh_before_expiry_with_safety_margin():
    """A fake clock proves refresh happens BEFORE hard expiry, honoring the margin."""
    fake_now = [1000.0]
    http_post = make_http_post(
        [
            (200, token_body(access_token="tok-1", expires_in=100)),
            (200, token_body(access_token="tok-2", expires_in=100)),
        ]
    )
    client = ServiceAuthClient(
        base_url="http://security-service:3000",
        client_id="svc-a",
        client_secret="s3cr3t",
        http_post=http_post,
        refresh_margin_seconds=30.0,
        clock=lambda: fake_now[0],
    )

    token = client.get_token()
    assert token.access_token == "tok-1"
    assert token.expires_at == pytest.approx(1100.0)

    # Still well within the margin -- must be served from cache.
    fake_now[0] = 1050.0
    assert client.get_token().access_token == "tok-1"
    assert len(http_post.calls) == 1

    # Now inside the refresh margin (expires_at - margin = 1070; now = 1075):
    # a fresh token must be fetched even though the token has not hard-expired.
    fake_now[0] = 1075.0
    refreshed = client.get_token()
    assert refreshed.access_token == "tok-2"
    assert len(http_post.calls) == 2


def test_connection_error_fails_closed_and_raises_token_request_error():
    http_post = make_http_post([ConnectionRefusedError("connection refused")])
    client = ServiceAuthClient(
        base_url="http://security-service:3000",
        client_id="svc-a",
        client_secret="s3cr3t",
        http_post=http_post,
    )

    with pytest.raises(TokenRequestError):
        client.get_token()


def test_malformed_body_fails_closed():
    http_post = make_http_post([(200, "not-json{{{")])
    client = ServiceAuthClient(
        base_url="http://security-service:3000",
        client_id="svc-a",
        client_secret="s3cr3t",
        http_post=http_post,
    )

    with pytest.raises(TokenRequestError):
        client.get_token()


def test_non_200_status_fails_closed():
    http_post = make_http_post([(401, json.dumps({"error": "invalid client", "code": "INVALID_CREDENTIALS"}))])
    client = ServiceAuthClient(
        base_url="http://security-service:3000",
        client_id="svc-a",
        client_secret="wrong",
        http_post=http_post,
    )

    with pytest.raises(TokenRequestError):
        client.get_token()


def test_response_missing_required_fields_fails_closed():
    http_post = make_http_post([(200, json.dumps({"tokenType": "Bearer"}))])
    client = ServiceAuthClient(
        base_url="http://security-service:3000",
        client_id="svc-a",
        client_secret="s3cr3t",
        http_post=http_post,
    )

    with pytest.raises(TokenRequestError):
        client.get_token()


def test_concurrent_callers_during_refresh_share_a_single_request():
    """20 threads calling get_token() concurrently on a cold cache must produce
    exactly ONE HTTP request ("single-flight"), and every thread must observe
    the same resulting token -- proving no stampede against the identity
    provider.
    """
    call_count = {"n": 0}
    call_lock = threading.Lock()
    release = threading.Event()

    def slow_http_post(url, payload, timeout):
        with call_lock:
            call_count["n"] += 1
        # Hold every thread here until they have all had a chance to arrive,
        # to make a stampede observable if single-flight were broken.
        release.wait(timeout=5)
        return 200, token_body(access_token="tok-shared", expires_in=3600)

    client = ServiceAuthClient(
        base_url="http://security-service:3000",
        client_id="svc-a",
        client_secret="s3cr3t",
        http_post=slow_http_post,
    )

    results = []
    errors = []

    def worker():
        try:
            results.append(client.get_token())
        except Exception as error:  # noqa: BLE001
            errors.append(error)

    threads = [threading.Thread(target=worker) for _ in range(20)]
    for t in threads:
        t.start()
    time.sleep(0.2)  # let every thread reach the blocking HTTP call
    release.set()
    for t in threads:
        t.join(timeout=5)

    assert not errors, f"unexpected errors: {errors}"
    assert call_count["n"] == 1, f"expected exactly 1 HTTP call, got {call_count['n']}"
    assert len(results) == 20
    assert all(r.access_token == "tok-shared" for r in results)


def test_concurrent_refresh_failure_is_shared_by_followers():
    """If the leader's refresh fails, followers must also fail closed rather
    than silently proceeding unauthenticated.
    """
    release = threading.Event()

    def failing_http_post(url, payload, timeout):
        release.wait(timeout=5)
        raise ConnectionRefusedError("provider unreachable")

    client = ServiceAuthClient(
        base_url="http://security-service:3000",
        client_id="svc-a",
        client_secret="s3cr3t",
        http_post=failing_http_post,
    )

    errors = []

    def worker():
        try:
            client.get_token()
        except Exception as error:  # noqa: BLE001
            errors.append(error)

    threads = [threading.Thread(target=worker) for _ in range(5)]
    for t in threads:
        t.start()
    time.sleep(0.2)
    release.set()
    for t in threads:
        t.join(timeout=5)

    assert len(errors) == 5
    assert all(isinstance(e, TokenRequestError) for e in errors)
