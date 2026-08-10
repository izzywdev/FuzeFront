"""Mint, parse and assert entity identifiers.

Semantics mirror ``shared/src/identity/id.ts`` exactly — same acceptance, same
rejection, same error codes — so a reference is valid or invalid identically
whichever language evaluates it.
"""

from __future__ import annotations

from typing import Any, Iterable, Optional, Set

from .codec import (
    bytes_to_uuid,
    decode_suffix,
    encode_suffix,
    is_uuid,
    is_valid_suffix,
    uuid_to_bytes,
    uuidv7_bytes,
)
from .registry import prefix_for, type_for_prefix


class IdentityError(ValueError):
    """Raised when a value is not a valid id for the expected entity type."""

    def __init__(self, code: str, expected_type: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.expected_type = expected_type


# Types whose stored rows still carry bare UUIDs, which ``parse_id`` therefore
# accepts alongside the prefixed form. Default strict: a service adopting
# parse_id on an existing surface must widen this explicitly for types it has
# not yet backfilled. Defaulting the other way would let a service keep
# accepting untyped ids simply by forgetting to configure anything.
_legacy_uuid_types: Set[str] = set()


def configure_identity(legacy_uuid_types: Iterable[str] = ()) -> None:
    """Replace identity configuration. Call once at service bootstrap."""
    global _legacy_uuid_types
    _legacy_uuid_types = set(legacy_uuid_types)


def get_legacy_uuid_types() -> Set[str]:
    return set(_legacy_uuid_types)


def _split(raw: str) -> Optional[tuple[str, str]]:
    separator = raw.rfind("_")
    if separator <= 0 or separator == len(raw) - 1:
        return None
    return raw[:separator], raw[separator + 1 :]


def mint_id(entity_type: str) -> str:
    """Mint a fresh, server-owned id for ``entity_type``. The ONLY constructor."""
    return f"{prefix_for(entity_type)}_{encode_suffix(uuidv7_bytes())}"


def parse_id(entity_type: str, raw: Any) -> str:
    """Validate that ``raw`` is an id of ``entity_type`` and return it.

    Raises ``IdentityError`` when the value belongs to a different entity type —
    the attack this standard exists to stop. The check is a string compare: no
    network, no cache, no database, and correct even when the owning service is
    unreachable.
    """
    if not isinstance(raw, str) or not raw:
        raise IdentityError(
            "MALFORMED_ID", entity_type, f"expected a {entity_type} id, received {type(raw).__name__}"
        )

    parts = _split(raw)
    if parts is None:
        if is_uuid(raw):
            if entity_type in _legacy_uuid_types:
                return raw
            raise IdentityError(
                "LEGACY_NOT_PERMITTED",
                entity_type,
                f"bare UUID supplied for {entity_type}; prefixed ids are required for this type",
            )
        raise IdentityError("MALFORMED_ID", entity_type, f"not a valid {entity_type} id")

    prefix, suffix = parts
    expected = prefix_for(entity_type)
    if prefix != expected:
        actual = type_for_prefix(prefix)
        raise IdentityError(
            "PREFIX_MISMATCH" if actual else "UNKNOWN_PREFIX",
            entity_type,
            (
                f"expected a {entity_type} id ({expected}_), received a {actual} id ({prefix}_)"
                if actual
                else f"expected a {entity_type} id ({expected}_), received unregistered prefix {prefix}_"
            ),
        )

    if not is_valid_suffix(suffix):
        raise IdentityError("MALFORMED_ID", entity_type, f"{entity_type} id has a malformed suffix")

    return raw


def assert_ref(entity_type: str, raw: Any) -> str:
    """Validate a REFERENCE to an entity of ``entity_type`` — the L0 check.

    Answers "is this the right kind of thing", the only question a local check
    can answer without the owning service. Existence is L1 and above.
    """
    return parse_id(entity_type, raw)


def try_parse_id(entity_type: str, raw: Any) -> Optional[str]:
    try:
        return parse_id(entity_type, raw)
    except IdentityError:
        return None


def is_id(entity_type: str, raw: Any) -> bool:
    return try_parse_id(entity_type, raw) is not None


def to_uuid(entity_id: str) -> str:
    """Wire form -> storage form. A legacy bare UUID passes through unchanged."""
    parts = _split(entity_id)
    if parts is None:
        return entity_id
    return bytes_to_uuid(decode_suffix(parts[1]))


def from_uuid(entity_type: str, value: str) -> str:
    """Storage form -> wire form. The exact inverse of ``to_uuid``."""
    return f"{prefix_for(entity_type)}_{encode_suffix(uuid_to_bytes(value))}"


def entity_type_of(raw: str) -> Optional[str]:
    """The entity type ``raw`` declares itself to be.

    For generic plumbing (audit logs, tracing) — never for authorization, which
    comes from the token and policy, never from the shape of an id.
    """
    parts = _split(raw)
    if parts is None or not is_valid_suffix(parts[1]):
        return None
    return type_for_prefix(parts[0])
