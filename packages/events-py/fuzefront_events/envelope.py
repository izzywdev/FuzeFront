"""Envelope v2 — the contract (data-consistency standard section 3).

Python twin of ``shared/src/kafka/envelope.ts``. Validation is driven by the
language-neutral ``envelope.v2.schema.json`` (a byte-identical vendored copy of
``contracts/events/envelope.v2.schema.json``; a test asserts it stays identical),
so the Zod, JSON-Schema and Python validators are pinned to one source and to
``packages/conformance-vectors/events/envelopes.*.json``.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime
from functools import lru_cache

# Package requires Python >=3.11 (pyproject); importlib.resources is the zip-safe way to read data.
# nosemgrep: python.lang.compatibility.python37.python37-compatibility-importlib2
from importlib import resources
from typing import Any

from fuzefront_identity import mint_id
from jsonschema import Draft202012Validator

#: Keys that exist only in v2; any of them present routes the input to the v2 parser.
V2_ONLY_KEYS = (
    "eventId",
    "schemaVersion",
    "aggregateType",
    "aggregateId",
    "aggregateVersion",
    "producer",
    "causationId",
)

TOPIC_PATTERN = r"^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)+$"

_V1_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["version", "topic", "correlationId", "occurredAt", "payload"],
    "properties": {
        "version": {"type": "string", "minLength": 1},
        "topic": {"type": "string", "pattern": TOPIC_PATTERN},
        "correlationId": {"type": "string", "minLength": 1},
        "occurredAt": {
            "type": "string",
            "pattern": r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$",
        },
        "payload": {},
    },
}


class EnvelopeError(ValueError):
    """Raised when an envelope fails validation. ``errors`` lists every violation."""

    def __init__(self, errors: list[str]):
        super().__init__("; ".join(errors))
        self.errors = errors


@lru_cache(maxsize=1)
def load_v2_schema() -> dict[str, Any]:
    text = resources.files("fuzefront_events").joinpath("envelope.v2.schema.json").read_text("utf-8")
    return json.loads(text)


@lru_cache(maxsize=1)
def _v2_validator() -> Draft202012Validator:
    # No FormatChecker on purpose: the schema's `pattern` already enforces the
    # mandatory offset, and format validators vary by installed extras.
    return Draft202012Validator(load_v2_schema())


@lru_cache(maxsize=1)
def _v1_validator() -> Draft202012Validator:
    return Draft202012Validator(_V1_SCHEMA)


def _errors(validator: Draft202012Validator, instance: Any) -> list[str]:
    return [
        f"{'/'.join(str(p) for p in e.absolute_path) or '<root>'}: {e.message}"
        for e in sorted(validator.iter_errors(instance), key=lambda e: list(map(str, e.absolute_path)))
    ]


def validate_envelope(envelope: Any) -> list[str]:
    """Return the list of v2 violations (empty = valid). Never raises on bad input."""
    if not isinstance(envelope, dict):
        return ["<root>: must be an object"]
    return _errors(_v2_validator(), envelope)


@dataclass(frozen=True)
class NormalizedEnvelope:
    """What consumers code against while v1 and v2 coexist.

    For v1 the aggregate/event fields are ``None`` — a consumer that needs dedupe
    or version-guarding must reject (or fall back to topic+partition+offset for)
    v1. ``schema_version`` is the v1 ``version`` string verbatim, or ``str(n)`` for v2.
    """

    envelope_version: int
    topic: str
    schema_version: str
    correlation_id: str
    occurred_at: str
    payload: Any
    event_id: str | None = None
    aggregate_type: str | None = None
    aggregate_id: str | None = None
    aggregate_version: int | None = None
    producer: str | None = None
    causation_id: str | None = None


@dataclass(frozen=True)
class ParseResult:
    success: bool
    envelope: NormalizedEnvelope | None = None
    errors: tuple[str, ...] = ()


def parse_envelope(data: Any) -> ParseResult:
    """Accept a v1 or v2 envelope (already JSON-decoded); normalize. Never raises.

    Routing matches the TS ``parseEnvelope``: ANY v2-only key present means the
    input must be a complete, valid v2 envelope — a half-v2 object is rejected,
    never silently treated as v1.
    """
    is_v2 = isinstance(data, dict) and any(k in data for k in V2_ONLY_KEYS)
    if is_v2:
        errs = _errors(_v2_validator(), data)
        if errs:
            return ParseResult(False, errors=tuple(errs))
        return ParseResult(
            True,
            NormalizedEnvelope(
                envelope_version=2,
                topic=data["topic"],
                schema_version=str(data["schemaVersion"]),
                correlation_id=data["correlationId"],
                occurred_at=data["occurredAt"],
                payload=data["payload"],
                event_id=data["eventId"],
                aggregate_type=data["aggregateType"],
                aggregate_id=data["aggregateId"],
                aggregate_version=data["aggregateVersion"],
                producer=data["producer"],
                causation_id=data.get("causationId"),
            ),
        )
    if not isinstance(data, dict):
        return ParseResult(False, errors=("<root>: must be an object",))
    errs = _errors(_v1_validator(), data)
    if errs:
        return ParseResult(False, errors=tuple(errs))
    return ParseResult(
        True,
        NormalizedEnvelope(
            envelope_version=1,
            topic=data["topic"],
            schema_version=data["version"],
            correlation_id=data["correlationId"],
            occurred_at=data["occurredAt"],
            payload=data["payload"],
        ),
    )


def parse_envelope_bytes(raw: bytes | str) -> ParseResult:
    """JSON-decode a Kafka message value then :func:`parse_envelope`."""
    try:
        data = json.loads(raw)
    except (ValueError, TypeError) as exc:  # UnicodeDecodeError is a ValueError
        return ParseResult(False, errors=(f"<root>: not valid JSON ({exc})",))
    return parse_envelope(data)


def partition_key(envelope: dict[str, Any] | NormalizedEnvelope) -> str:
    """Kafka message key for a v2 envelope: the aggregate id (one entity's events stay ordered)."""
    if isinstance(envelope, NormalizedEnvelope):
        if envelope.aggregate_id is None:
            raise ValueError("v1 envelopes have no aggregate id; keep your existing key")
        return envelope.aggregate_id
    return envelope["aggregateId"]


def format_occurred_at(when: datetime) -> str:
    """RFC 3339 with an explicit offset. Naive datetimes are taken as UTC."""
    if when.tzinfo is None:
        when = when.replace(tzinfo=UTC)
    s = when.astimezone(UTC).isoformat()
    return s.replace("+00:00", "Z")


def build_event(
    *,
    topic: str,
    aggregate_type: str,
    aggregate_id: str,
    aggregate_version: int,
    producer: str,
    payload: Any,
    correlation_id: str,
    schema_version: int = 1,
    causation_id: str | None = None,
    occurred_at: datetime | str | None = None,
) -> dict[str, Any]:
    """Build and validate a v2 envelope. ``eventId`` is minted here, never supplied.

    Returns the wire-form (camelCase) dict. Raises :class:`EnvelopeError`.
    """
    if isinstance(occurred_at, str):
        occurred = occurred_at
    else:
        occurred = format_occurred_at(occurred_at or datetime.now(UTC))
    env: dict[str, Any] = {
        "eventId": mint_id("event"),
        "topic": topic,
        "schemaVersion": schema_version,
        "aggregateType": aggregate_type,
        "aggregateId": aggregate_id,
        "aggregateVersion": aggregate_version,
        "producer": producer,
        "occurredAt": occurred,
        "correlationId": correlation_id,
        "payload": payload,
    }
    if causation_id is not None:
        env["causationId"] = causation_id
    errs = validate_envelope(env)
    if errs:
        raise EnvelopeError(errs)
    return env
