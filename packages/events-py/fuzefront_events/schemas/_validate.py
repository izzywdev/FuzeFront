"""Small stdlib validation toolkit for the event payload schemas.

Zero third-party deps (no pydantic) — mirrors the per-field Zod checks on the
Node side with plain helpers that raise ``SchemaValidationError``. Every schema
validator returns the validated payload dict on success (a shallow copy of the
recognised keys) so callers can rely on the contract shape.

Field names stay camelCase (the wire contract) throughout.
"""

from __future__ import annotations

import re
from typing import Any, Callable, Iterable, Mapping, Optional, Sequence

from ..errors import SchemaValidationError

_UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
    r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)
# Deliberately permissive, like Zod's z.string().email() (not RFC-complete).
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_E164_RE = re.compile(r"^\+[1-9]\d{1,14}$")
# ISO-8601 UTC, mirroring Zod z.string().datetime() with its defaults EXACTLY:
# a trailing 'Z' is REQUIRED (no tz-less value, no numeric offset — those need
# z's { offset: true }, which the payload schemas don't use). Deliberately NOT
# calendar-range-validated: Zod 3.22's default .datetime() also accepts
# '2026-99-99T99:99:99Z', so adding a range check here would make this Python
# mirror REJECT values the Node contract ACCEPTS — a parity break in the other
# direction. The only Node divergence to close is the required 'Z'.
_DATETIME_RE = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$"
)

_MISSING = object()

Validator = Callable[[Any], Any]


class _V:
    """Bound validator for one schema: ``self.name`` labels every error."""

    def __init__(self, name: str, payload: Any):
        if not isinstance(payload, Mapping):
            raise SchemaValidationError(name, "payload must be an object")
        self.name = name
        self.payload = payload
        self.out: dict = {}

    def fail(self, msg: str) -> "SchemaValidationError":
        return SchemaValidationError(self.name, msg)

    # -- presence -------------------------------------------------------
    def _raw(self, field: str, required: bool) -> Any:
        if field not in self.payload:
            if required:
                raise self.fail(f"missing required field '{field}'")
            return _MISSING
        return self.payload[field]

    # -- scalar fields --------------------------------------------------
    def string(
        self,
        field: str,
        *,
        required: bool = True,
        nullable: bool = False,
        min_len: Optional[int] = None,
        max_len: Optional[int] = None,
        pattern: Optional[re.Pattern] = None,
    ) -> None:
        v = self._raw(field, required)
        if v is _MISSING:
            return
        if v is None:
            if nullable:
                self.out[field] = None
                return
            raise self.fail(f"field '{field}' must not be null")
        if not isinstance(v, str):
            raise self.fail(f"field '{field}' must be a string")
        if min_len is not None and len(v) < min_len:
            raise self.fail(f"field '{field}' shorter than {min_len}")
        if max_len is not None and len(v) > max_len:
            raise self.fail(f"field '{field}' longer than {max_len}")
        if pattern is not None and not pattern.match(v):
            raise self.fail(f"field '{field}' does not match required pattern")
        self.out[field] = v

    def enum(
        self,
        field: str,
        allowed: Sequence[str],
        *,
        required: bool = True,
        nullable: bool = False,
    ) -> None:
        v = self._raw(field, required)
        if v is _MISSING:
            return
        if v is None:
            if nullable:
                self.out[field] = None
                return
            raise self.fail(f"field '{field}' must not be null")
        if v not in allowed:
            raise self.fail(f"field '{field}' must be one of {list(allowed)}")
        self.out[field] = v

    def uuid(self, field: str, *, required: bool = True, nullable: bool = False) -> None:
        self.string(field, required=required, nullable=nullable, pattern=_UUID_RE)

    def email(self, field: str, *, required: bool = True, nullable: bool = False) -> None:
        self.string(field, required=required, nullable=nullable, pattern=_EMAIL_RE)

    def phone_e164(self, field: str, *, required: bool = True) -> None:
        self.string(field, required=required, pattern=_E164_RE)

    def datetime(self, field: str, *, required: bool = True, nullable: bool = False) -> None:
        self.string(field, required=required, nullable=nullable, pattern=_DATETIME_RE)

    def boolean(self, field: str, *, required: bool = True) -> None:
        v = self._raw(field, required)
        if v is _MISSING:
            return
        if not isinstance(v, bool):
            raise self.fail(f"field '{field}' must be a boolean")
        self.out[field] = v

    def integer(
        self,
        field: str,
        *,
        required: bool = True,
        nullable: bool = False,
        gt: Optional[int] = None,
        ge: Optional[int] = None,
    ) -> None:
        v = self._raw(field, required)
        if v is _MISSING:
            return
        if v is None:
            if nullable:
                self.out[field] = None
                return
            raise self.fail(f"field '{field}' must not be null")
        if isinstance(v, bool) or not isinstance(v, int):
            raise self.fail(f"field '{field}' must be an integer")
        if gt is not None and not v > gt:
            raise self.fail(f"field '{field}' must be > {gt}")
        if ge is not None and not v >= ge:
            raise self.fail(f"field '{field}' must be >= {ge}")
        self.out[field] = v

    def record(self, field: str, *, required: bool = True) -> None:
        """An arbitrary object map (Record<string, unknown>)."""
        v = self._raw(field, required)
        if v is _MISSING:
            return
        if not isinstance(v, Mapping):
            raise self.fail(f"field '{field}' must be an object")
        self.out[field] = dict(v)

    def nested(self, field: str, validator: Validator, *, required: bool = True, nullable: bool = False) -> None:
        v = self._raw(field, required)
        if v is _MISSING:
            return
        if v is None:
            if nullable:
                self.out[field] = None
                return
            raise self.fail(f"field '{field}' must not be null")
        try:
            self.out[field] = validator(v)
        except SchemaValidationError as e:
            raise self.fail(f"field '{field}': {e.reason}") from e

    def array(
        self,
        field: str,
        item: Validator,
        *,
        required: bool = True,
        min_len: Optional[int] = None,
        max_len: Optional[int] = None,
    ) -> None:
        v = self._raw(field, required)
        if v is _MISSING:
            return
        if not isinstance(v, (list, tuple)):
            raise self.fail(f"field '{field}' must be an array")
        if min_len is not None and len(v) < min_len:
            raise self.fail(f"field '{field}' must have at least {min_len} items")
        if max_len is not None and len(v) > max_len:
            raise self.fail(f"field '{field}' must have at most {max_len} items")
        out = []
        for i, el in enumerate(v):
            try:
                out.append(item(el))
            except SchemaValidationError as e:
                raise self.fail(f"field '{field}'[{i}]: {e.reason}") from e
        self.out[field] = out

    def string_array(
        self,
        field: str,
        *,
        required: bool = True,
        min_len: Optional[int] = None,
        allowed: Optional[Sequence[str]] = None,
    ) -> None:
        def _item(el: Any) -> str:
            if not isinstance(el, str):
                raise SchemaValidationError(self.name, "array element must be a string")
            if allowed is not None and el not in allowed:
                raise SchemaValidationError(self.name, f"element must be one of {list(allowed)}")
            return el

        self.array(field, _item, required=required, min_len=min_len)

    def passthrough(self, field: str, *, required: bool = True, nullable: bool = False) -> None:
        """Accept any value for ``field`` (used for opaque payload sub-trees)."""
        v = self._raw(field, required)
        if v is _MISSING:
            return
        if v is None and not nullable:
            raise self.fail(f"field '{field}' must not be null")
        self.out[field] = v

    def done(self, *, strict: bool = False) -> dict:
        if strict:
            extra = set(self.payload) - set(self.out)
            if extra:
                raise self.fail(f"unexpected field(s): {sorted(extra)}")
        return self.out


def discriminated(
    name: str,
    value: Any,
    key: str,
    branches: Mapping[str, Validator],
) -> dict:
    """Validate a discriminated union keyed on ``key`` (e.g. actor.type)."""
    if not isinstance(value, Mapping):
        raise SchemaValidationError(name, "must be an object")
    disc = value.get(key)
    if disc not in branches:
        raise SchemaValidationError(
            name, f"'{key}' must be one of {list(branches)}"
        )
    return branches[disc](value)


def unique(name: str, items: Iterable[Any], label: str) -> None:
    seen = set()
    for it in items:
        if it in seen:
            raise SchemaValidationError(name, f"duplicate {label}: {it!r}")
        seen.add(it)
