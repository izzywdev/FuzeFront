"""ASGI middleware tests, driven against a bare ASGI app.

No Starlette/FastAPI here on purpose: the middleware is pure ASGI so it installs
into any Python microservice, and testing it against the raw protocol is what
proves that.
"""

import asyncio
import json

import pytest

from fuzefront_identity import GraphCreateMiddleware, entity_type_of

AGGREGATE = {"customer", "invoice"}


def make_app(record):
    """A minimal ASGI app that records the body it received and echoes JSON."""

    async def app(scope, receive, send):
        message = await receive()
        record["body"] = json.loads(message["body"]) if message.get("body") else None
        record["state"] = scope.get("state", {})
        payload = json.dumps(record.get("respond_with", {"status": "created"})).encode()
        await send(
            {
                "type": "http.response.start",
                "status": 201,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(payload)).encode()),
                ],
            }
        )
        await send({"type": "http.response.body", "body": payload, "more_body": False})

    return app


def call(middleware, body, method="POST"):
    """Drive one request through the middleware and collect the response."""
    scope = {
        "type": "http",
        "method": method,
        "headers": [(b"content-type", b"application/json")],
        "state": {},
    }
    raw = json.dumps(body).encode() if body is not None else b""
    sent = []

    async def receive():
        return {"type": "http.request", "body": raw, "more_body": False}

    async def send(message):
        sent.append(message)

    asyncio.run(middleware(scope, receive, send))

    start = next(m for m in sent if m["type"] == "http.response.start")
    chunks = b"".join(m.get("body", b"") for m in sent if m["type"] == "http.response.body")
    return start, json.loads(chunks) if chunks else None


def test_rewrites_body_and_merges_id_map():
    record = {}
    middleware = GraphCreateMiddleware(make_app(record), aggregate=AGGREGATE)

    start, payload = call(
        middleware,
        {
            "type": "customer",
            "lid": "1",
            "name": "Acme",
            "invoices": [{"type": "invoice", "lid": "2", "customerId": "lid:1"}],
        },
    )

    assert start["status"] == 201

    # The handler saw real ids and no lid.
    assert "lid" not in record["body"]
    assert entity_type_of(record["body"]["id"]) == "customer"
    assert record["body"]["invoices"][0]["customerId"] == record["body"]["id"]

    # ...and idMap reached the client without the handler doing anything.
    assert payload["status"] == "created"
    assert payload["idMap"]["1"] == record["body"]["id"]
    assert payload["idMap"]["2"] == record["body"]["invoices"][0]["id"]


def test_content_length_matches_the_decorated_body():
    # The decorated payload is longer than the handler's; a stale content-length
    # here truncates the response on the wire.
    record = {}
    middleware = GraphCreateMiddleware(make_app(record), aggregate=AGGREGATE)
    start, payload = call(middleware, {"type": "customer", "lid": "1"})

    declared = int(dict(start["headers"])[b"content-length"])
    assert declared == len(json.dumps(payload).encode())


def test_exposes_id_map_on_scope_state():
    record = {}
    middleware = GraphCreateMiddleware(make_app(record), aggregate=AGGREGATE)
    call(middleware, {"type": "customer", "lid": "1"})
    assert "1" in record["state"]["id_map"]


def test_does_not_clobber_a_handler_supplied_id_map():
    record = {"respond_with": {"idMap": {"custom": "kept"}}}
    middleware = GraphCreateMiddleware(make_app(record), aggregate=AGGREGATE)
    _, payload = call(middleware, {"type": "customer", "lid": "1"})
    assert payload == {"idMap": {"custom": "kept"}}


def test_returns_422_on_a_client_supplied_id():
    record = {}
    middleware = GraphCreateMiddleware(make_app(record), aggregate=AGGREGATE)
    start, payload = call(middleware, {"type": "customer", "lid": "1", "id": "cus_x"})

    assert start["status"] == 422
    assert payload["code"] == "CLIENT_SUPPLIED_ID"
    assert payload["error"] == "unprocessable_entity"
    assert "body" not in record  # the handler was never reached


def test_returns_422_on_a_cross_aggregate_node():
    record = {}
    middleware = GraphCreateMiddleware(make_app(record), aggregate=AGGREGATE)
    start, payload = call(middleware, {"type": "portal", "lid": "1"})
    assert start["status"] == 422
    assert payload["code"] == "CROSS_AGGREGATE_LID"


def test_passes_reads_straight_through():
    record = {}
    middleware = GraphCreateMiddleware(make_app(record), aggregate=AGGREGATE)
    start, payload = call(middleware, {"type": "customer", "lid": "1"}, method="GET")
    assert start["status"] == 201
    # Untouched: the lid is still there because the middleware never ran.
    assert record["body"]["lid"] == "1"
    assert "idMap" not in payload


def test_leaves_non_json_bodies_alone():
    record = {}
    middleware = GraphCreateMiddleware(make_app(record), aggregate=AGGREGATE)

    scope = {"type": "http", "method": "POST", "headers": [], "state": {}}
    sent = []

    async def receive():
        return {"type": "http.request", "body": b"not json at all", "more_body": False}

    async def send(message):
        sent.append(message)

    async def app(scope, receive, send):
        message = await receive()
        record["raw"] = message["body"]
        await send({"type": "http.response.start", "status": 204, "headers": []})
        await send({"type": "http.response.body", "body": b"", "more_body": False})

    asyncio.run(GraphCreateMiddleware(app, aggregate=AGGREGATE)(scope, receive, send))
    assert record["raw"] == b"not json at all"


def test_does_not_decorate_when_nothing_was_created():
    record = {}
    middleware = GraphCreateMiddleware(make_app(record), aggregate=AGGREGATE)
    _, payload = call(middleware, {"name": "no lid here"})
    assert payload == {"status": "created"}
