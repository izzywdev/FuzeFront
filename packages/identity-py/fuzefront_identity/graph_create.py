"""Graph create: ``lid`` in, ``idMap`` out.

Semantics mirror ``shared/src/identity/graph-create.ts`` exactly, including the
error codes, so a graph accepted by a Node service is accepted identically by a
Python one.

Each node carries a document-scoped local id (``lid``) and references it as
``"lid:<local>"`` — JSON:API 1.1 ``lid``, SCIM ``bulkId`` (RFC 7644 3.7.2) and
OData ``$batch`` Content-ID all solve this the same way. Deliberately NOT the
``id`` field: a placeholder there would put ``id`` back in create bodies and
degrade the rule to "id must be present but fake", which is unenforceable.

Every id is minted UP FRONT and substituted in, so handlers never learn ``lid``
existed, ``idMap`` is just the allocation table, and reference cycles resolve
without a deferred second write.
"""

from __future__ import annotations

import re
from typing import Any, Dict, Iterable, Optional, Set, Tuple

from .ids import mint_id
from .registry import is_entity_type

_LID_REF = re.compile(r"^lid:(.+)$")

# Permitted shape of a local id, matching the ``LocalId`` schema published in the
# contract (1-64 chars) and the TypeScript LID_FORMAT. Enforced because ``lid``
# values are echoed back as ``idMap`` KEYS — the one place client-controlled text
# crosses into a response — and because a contract that declares a bound the
# implementation does not enforce is not a bound at all.
_LID_FORMAT = re.compile(r"^[A-Za-z0-9_.:-]{1,64}$")

DEFAULT_MAX_NODES = 500
DEFAULT_MAX_DEPTH = 32

MUTATING_METHODS = frozenset({"POST", "PUT", "PATCH"})


class GraphCreateError(ValueError):
    """Raised when a create graph is malformed or violates the standard."""

    def __init__(self, code: str, path: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.path = path

    def as_response(self) -> Dict[str, Any]:
        """The canonical 422 body, identical to the Node middleware's."""
        return {
            "error": "unprocessable_entity",
            "code": self.code,
            "message": str(self),
            "path": self.path,
        }


def resolve_graph(
    body: Any,
    aggregate: Iterable[str],
    max_nodes: int = DEFAULT_MAX_NODES,
    max_depth: int = DEFAULT_MAX_DEPTH,
) -> Tuple[Any, Dict[str, str]]:
    """Validate a create graph, mint an id per ``lid`` node, resolve references.

    ``aggregate`` is the set of entity types this service OWNS. A ``lid`` node
    declaring anything else is rejected: a graph spanning services cannot be
    created atomically, so cross-service entities must be referenced by their
    existing ids rather than created here.

    Returns ``(rewritten_body, id_map)``. Mutates nothing.
    """
    owned: Set[str] = set(aggregate)
    id_map: Dict[str, str] = {}
    node_count = 0

    def collect(value: Any, path: str, depth: int) -> None:
        nonlocal node_count
        if depth > max_depth:
            raise GraphCreateError("GRAPH_TOO_DEEP", path, f"graph exceeds {max_depth} levels")
        if isinstance(value, list):
            for index, item in enumerate(value):
                collect(item, f"{path}/{index}", depth + 1)
            return
        if not isinstance(value, dict):
            return

        if "id" in value:
            raise GraphCreateError(
                "CLIENT_SUPPLIED_ID",
                path,
                "ids are minted by the owning service and must not be supplied on create",
            )

        if "lid" in value:
            lid = value["lid"]
            if not isinstance(lid, str) or not _LID_FORMAT.match(lid):
                raise GraphCreateError(
                    "MALFORMED_LID", path, "lid must be 1-64 characters of [A-Za-z0-9_.:-]"
                )
            if lid in id_map:
                raise GraphCreateError("DUPLICATE_LID", path, f"lid {lid!r} is declared twice")
            node_count += 1
            if node_count > max_nodes:
                raise GraphCreateError("GRAPH_TOO_LARGE", path, f"graph exceeds {max_nodes} nodes")

            entity_type = value.get("type")
            if not isinstance(entity_type, str):
                raise GraphCreateError("MISSING_TYPE", path, "a lid node must declare its entity type")
            if not is_entity_type(entity_type):
                raise GraphCreateError("UNKNOWN_TYPE", path, f"unregistered entity type {entity_type!r}")
            if entity_type not in owned:
                raise GraphCreateError(
                    "CROSS_AGGREGATE_LID",
                    path,
                    f"{entity_type} is owned by another service; reference it by its "
                    "existing id instead of creating it here",
                )

            id_map[lid] = mint_id(entity_type)

        for key, child in value.items():
            collect(child, f"{path}/{key}", depth + 1)

    collect(body, "", 0)

    def rewrite(value: Any, path: str) -> Any:
        if isinstance(value, list):
            return [rewrite(item, f"{path}/{index}") for index, item in enumerate(value)]
        if isinstance(value, str):
            match = _LID_REF.match(value)
            if not match:
                return value
            target = match.group(1)
            resolved = id_map.get(target)
            if resolved is None:
                raise GraphCreateError(
                    "UNKNOWN_LID", path, f"reference to undeclared lid {target!r}"
                )
            return resolved
        if not isinstance(value, dict):
            return value

        out: Dict[str, Any] = {}
        for key, child in value.items():
            if key == "lid":
                continue  # document-scoped; never persisted
            out[key] = rewrite(child, f"{path}/{key}")
        lid = value.get("lid")
        if isinstance(lid, str):
            out["id"] = id_map[lid]
        return out

    return rewrite(body, ""), id_map


# ---------------------------------------------------------------------------
# ASGI middleware (FastAPI / Starlette)
# ---------------------------------------------------------------------------


class GraphCreateMiddleware:
    """Pure-ASGI middleware applying :func:`resolve_graph` to JSON create bodies.

    Deliberately stdlib-only — no Starlette import — so the package installs into
    any Python microservice regardless of framework, and works under FastAPI,
    Starlette or any bare ASGI app::

        app.add_middleware(GraphCreateMiddleware, aggregate={"customer", "invoice"})

    Handlers downstream receive a body whose ids are already minted and whose
    references are already resolved, and the ``idMap`` is merged into the JSON
    response automatically — so a route opts in by doing nothing at all.
    """

    def __init__(
        self,
        app: Any,
        aggregate: Iterable[str],
        max_nodes: int = DEFAULT_MAX_NODES,
        max_depth: int = DEFAULT_MAX_DEPTH,
    ) -> None:
        self.app = app
        self.aggregate = set(aggregate)
        self.max_nodes = max_nodes
        self.max_depth = max_depth

    async def __call__(self, scope: Dict[str, Any], receive: Any, send: Any) -> None:
        import json

        if scope.get("type") != "http" or scope.get("method", "").upper() not in MUTATING_METHODS:
            await self.app(scope, receive, send)
            return

        raw = await _read_body(receive)
        if not raw:
            await self.app(scope, _replay(raw), send)
            return

        try:
            parsed = json.loads(raw)
        except ValueError:
            # Not JSON — not ours to interpret; hand it on untouched.
            await self.app(scope, _replay(raw), send)
            return

        try:
            rewritten, id_map = resolve_graph(
                parsed, self.aggregate, self.max_nodes, self.max_depth
            )
        except GraphCreateError as err:
            await _send_json(send, 422, err.as_response())
            return

        new_body = json.dumps(rewritten).encode()
        scope = dict(scope)
        scope["headers"] = _with_content_length(scope.get("headers", []), len(new_body))
        scope.setdefault("state", {})["id_map"] = id_map

        if not id_map:
            await self.app(scope, _replay(new_body), send)
            return

        await self.app(scope, _replay(new_body), _decorating_send(send, id_map))


async def _read_body(receive: Any) -> bytes:
    chunks = []
    while True:
        message = await receive()
        if message["type"] != "http.request":
            break
        chunks.append(message.get("body", b""))
        if not message.get("more_body", False):
            break
    return b"".join(chunks)


def _replay(body: bytes) -> Any:
    """A ``receive`` callable that replays ``body`` to the downstream app."""
    sent = False

    async def receive() -> Dict[str, Any]:
        nonlocal sent
        if sent:
            return {"type": "http.disconnect"}
        sent = True
        return {"type": "http.request", "body": body, "more_body": False}

    return receive


def _with_content_length(headers: Any, length: int) -> list:
    out = [(k, v) for k, v in headers if k.lower() != b"content-length"]
    out.append((b"content-length", str(length).encode()))
    return out


def _decorating_send(send: Any, id_map: Dict[str, str]) -> Any:
    """Wrap ``send`` so a JSON object response gains ``idMap``.

    The rewritten payload changes length, so the buffered body is emitted with a
    corrected content-length rather than the handler's original.
    """
    import json

    state: Dict[str, Any] = {"start": None, "chunks": [], "json": False}

    async def send_wrapper(message: Dict[str, Any]) -> None:
        if message["type"] == "http.response.start":
            headers = message.get("headers", [])
            state["json"] = any(
                k.lower() == b"content-type" and b"application/json" in v.lower()
                for k, v in headers
            )
            if not state["json"]:
                await send(message)
                return
            state["start"] = message
            return

        if message["type"] == "http.response.body" and state["json"]:
            state["chunks"].append(message.get("body", b""))
            if message.get("more_body", False):
                return

            raw = b"".join(state["chunks"])
            body = raw
            try:
                payload = json.loads(raw)
                if isinstance(payload, dict) and "idMap" not in payload:
                    body = json.dumps({**payload, "idMap": id_map}).encode()
            except ValueError:
                pass

            start = dict(state["start"])
            start["headers"] = _with_content_length(start.get("headers", []), len(body))
            await send(start)
            await send({"type": "http.response.body", "body": body, "more_body": False})
            return

        await send(message)

    return send_wrapper


async def _send_json(send: Any, status: int, payload: Dict[str, Any]) -> None:
    import json

    body = json.dumps(payload).encode()
    await send(
        {
            "type": "http.response.start",
            "status": status,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode()),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body, "more_body": False})
