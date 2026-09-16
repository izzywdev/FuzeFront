"""
Wire types for the FuzeFront config-service.

Hand-authored from ``services/config-service/openapi.yaml`` v1.0.0 -- the
frozen contract. This is a **projection** of that spec, in parity with the
Node client ``@fuzefront/config-client`` (``config-client/src/types.ts``).
Where the two disagree, the spec wins and one of these two files is the bug.

Field casing mirrors the Python idiom (``snake_case``); the wire JSON is
``camelCase`` and is normalised at the client boundary (see ``client.py``).
The one exception is ``Scope``, whose ``(scope_type, scope_id)`` shape is
shared by requests and responses and is (de)serialised via
``scope_to_wire`` / ``scope_from_wire`` in this module, because both
``client.py`` and ``errors.py`` need it (an error body carries a ``Scope``
on ``LOCKED_BY_ANCESTOR``).

All classes use ``dataclasses`` and ``enum`` only -- zero third-party deps,
matching every other Python package in this repo (``identity-py``,
``selection-list-client-py``).
"""

from __future__ import annotations

import enum
from dataclasses import dataclass, field
from typing import Any, Generic, TypeVar

# ---------------------------------------------------------------------------
# Identifier prefixes (opaque past the prefix -- never parse further)
# ---------------------------------------------------------------------------

NAMESPACE_ID_PREFIX = "cns_"
KEY_DEFINITION_ID_PREFIX = "ckd_"

# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------


class ScopeType(str, enum.Enum):
    """A tier of the resolution chain. ``platform`` is a singleton (no ``scope_id``)."""

    PLATFORM = "platform"
    PORTAL = "portal"
    ORG = "org"
    USER = "user"


# Every scope tier, in resolution order (least specific first).
SCOPE_CHAIN: tuple = (ScopeType.PLATFORM, ScopeType.PORTAL, ScopeType.ORG, ScopeType.USER)


class ValueType(str, enum.Enum):
    """The kind of value a key holds. Drives validation and editor rendering."""

    STRING = "string"
    NUMBER = "number"
    BOOLEAN = "boolean"
    ENUM = "enum"
    JSON = "json"
    DURATION = "duration"
    URL = "url"
    EMAIL = "email"
    COLOR = "color"
    SECRET = "secret"


class Precedence(str, enum.Enum):
    """
    Which end of the chain wins.

    ``MOST_SPECIFIC_WINS`` (the default) lets a user's value beat their org's;
    ``LEAST_SPECIFIC_WINS`` reverses it so an org-level setting overrides a
    user-specific one. The response shape is identical either way -- no
    consumer should branch on this.
    """

    MOST_SPECIFIC_WINS = "most-specific-wins"
    LEAST_SPECIFIC_WINS = "least-specific-wins"


class ConfigOperationType(str, enum.Enum):
    """
    What to do with one key at the target scope.

    ``UNSET`` removes this scope's override so the key resolves from its
    parent again -- not the same as setting the parent's current value,
    which pins a copy that stops following it.
    """

    SET = "set"
    UNSET = "unset"
    LOCK = "lock"
    UNLOCK = "unlock"


class ConfigErrorCode(str, enum.Enum):
    """
    Machine-readable failure reason from the contract's error envelope.

    Callers branch on this, never on ``message``, which is human-facing and
    may change without a contract version bump.

    ``UNKNOWN`` is client-only: never emitted by the service. It is what
    this client reports when a response is not a contract response at all --
    an ingress ``502``, a proxy timeout, an HTML error page. Mapping those
    onto a real contract code would send the caller down the wrong recovery
    path, so they get their own value (matches the Node client exactly).
    """

    VALIDATION_ERROR = "VALIDATION_ERROR"
    UNAUTHENTICATED = "UNAUTHENTICATED"
    FORBIDDEN = "FORBIDDEN"
    NOT_FOUND = "NOT_FOUND"
    LOCKED_BY_ANCESTOR = "LOCKED_BY_ANCESTOR"
    VERSION_CONFLICT = "VERSION_CONFLICT"
    SCOPE_NOT_ALLOWED = "SCOPE_NOT_ALLOWED"
    INCOMPATIBLE_DEFINITION = "INCOMPATIBLE_DEFINITION"
    SECRET_UNAVAILABLE = "SECRET_UNAVAILABLE"
    RATE_LIMITED = "RATE_LIMITED"
    UNKNOWN = "UNKNOWN"


# ---------------------------------------------------------------------------
# Scope -- polymorphic reference, always carries its type
# ---------------------------------------------------------------------------


@dataclass
class Scope:
    """
    A point in the resolution chain.

    Polymorphic references always carry their type: a bare id is never
    resolved (``governance/identifier-standard.md``).
    """

    scope_type: ScopeType
    """Which tier."""
    scope_id: str | None = None
    """The portal, organization or user. ``None`` exactly when ``scope_type`` is ``platform``."""


def enum_value(x: Any) -> Any:
    return x.value if isinstance(x, enum.Enum) else x


def scope_to_wire(scope: Scope) -> dict:
    return {"scopeType": enum_value(scope.scope_type), "scopeId": scope.scope_id}


def scope_from_wire(raw: dict | None) -> Scope | None:
    if raw is None:
        return None
    return Scope(scope_type=ScopeType(raw["scopeType"]), scope_id=raw.get("scopeId"))


# ---------------------------------------------------------------------------
# Namespaces
# ---------------------------------------------------------------------------


@dataclass
class Namespace:
    """A configuration namespace owned by one application."""

    id: str
    """Service-minted TypeID (``cns_...``)."""
    namespace: str
    """The dotted namespace name."""
    display_name: str
    """Human-facing name shown as the editor's section heading."""
    created_at: str
    """When the namespace was first registered."""
    description: str | None = None
    owner_app_id: str | None = None


@dataclass
class NamespaceCreate:
    """Registration body. Carries no ``id`` -- the service mints it."""

    namespace: str
    display_name: str
    description: str | None = None
    owner_app_id: str | None = None


# ---------------------------------------------------------------------------
# Key definitions (the catalog)
# ---------------------------------------------------------------------------


@dataclass
class KeyDefinition:
    """What a key **is**: presentation, validation, where it may be set, who may change it."""

    id: str
    """Service-minted TypeID (``ckd_...``)."""
    key: str
    display_name: str
    value_type: ValueType
    default_value: Any
    """Bottom of the resolution chain. Always present, so every key resolves to something."""
    allowed_scopes: list[ScopeType]
    is_system: bool
    is_hidden: bool
    is_secret: bool
    is_readonly: bool
    precedence: Precedence
    requires_restart: bool
    description: str | None = None
    help_url: str | None = None
    category: str | None = None
    sort_order: int | None = None
    tags: list[str] | None = None
    schema: dict[str, Any] | None = None
    enum_values: list[Any] | None = None
    deprecated_at: str | None = None
    replaced_by: str | None = None


@dataclass
class KeyDefinitionInput:
    """One key as declared by an owning application. Carries no ``id``."""

    key: str
    display_name: str
    value_type: ValueType
    default_value: Any
    allowed_scopes: list[ScopeType]
    description: str | None = None
    help_url: str | None = None
    category: str | None = None
    sort_order: int | None = None
    tags: list[str] | None = None
    schema: dict[str, Any] | None = None
    enum_values: list[Any] | None = None
    is_system: bool = False
    is_hidden: bool = False
    is_secret: bool = False
    is_readonly: bool = False
    precedence: Precedence | None = None
    requires_restart: bool = False
    replaced_by: str | None = None


@dataclass
class KeyDefinitionManifest:
    """The set of key definitions an application declares for one namespace."""

    keys: list[KeyDefinitionInput]
    complete: bool = False
    """
    Whether this manifest is the **whole** catalog for the namespace. Only
    when ``True`` does an omitted key get deprecated.
    """


@dataclass
class KeyDefinitionManifestResult:
    """What reconciling a manifest changed."""

    created: list[str] = field(default_factory=list)
    updated: list[str] = field(default_factory=list)
    deprecated: list[str] = field(default_factory=list)
    unchanged: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Effective configuration
# ---------------------------------------------------------------------------


@dataclass
class EffectiveConfigEntry:
    """
    One resolved setting.

    The provenance fields are the point: a consumer that reads only
    ``value`` cannot tell a value set here from one inherited or locked, and
    will render a form that misrepresents its own contents.
    """

    key: str
    value: Any
    """The resolved value. Always ``None`` for an ``is_secret`` key -- see ``is_set``."""
    source: Scope
    locked: bool
    editable: bool
    """Whether **this caller** may change it. A disabled input is a courtesy; the server refuses regardless."""
    definition: KeyDefinition
    is_set: bool | None = None
    """Whether a secret has a stored value. Present only for ``is_secret`` keys."""
    locked_by: Scope | None = None
    lock_reason: str | None = None
    warning: str | None = None


@dataclass
class EffectiveConfig:
    """A scope's fully-resolved configuration for one namespace."""

    namespace: str
    scope: Scope
    version: str
    """Monotonic version of the resolved view, matching the ``ETag``."""
    entries: list[EffectiveConfigEntry]


# ---------------------------------------------------------------------------
# Values -- writes
# ---------------------------------------------------------------------------


@dataclass
class ConfigOperation:
    """One operation against one key at the request's scope."""

    key: str
    op: ConfigOperationType
    value: Any = None
    """Required for ``set`` and ``lock``; rejected otherwise."""
    lock_reason: str | None = None


@dataclass
class ConfigWriteRequest:
    """A batch of operations against one scope, applied as a single transaction."""

    namespace: str
    scope: Scope
    operations: list[ConfigOperation]
    expected_version: str | None = None
    """The version/ETag last read. Refused with ``VERSION_CONFLICT`` if the resolved view moved."""
    reason: str | None = None


@dataclass
class ConfigWriteResult:
    """The outcome of an applied batch."""

    namespace: str
    scope: Scope
    version: str
    applied: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Pagination envelope
# ---------------------------------------------------------------------------


@dataclass
class PageInfo:
    """
    Cursor pagination envelope, per this contract's ``#/components/schemas/PageInfo``.

    Note this service's envelope key is ``has_next_page`` (no ``total``), which
    differs from some sibling services (e.g. selection-list uses
    ``has_more``/``total``) -- match the contract in hand, not a sibling client.
    """

    has_next_page: bool
    next_cursor: str | None = None


T = TypeVar("T")


@dataclass
class Paged(Generic[T]):
    """A page of ``T`` plus its cursor envelope."""

    items: list[T]
    page_info: PageInfo


def page_info_from_wire(raw: dict) -> PageInfo:
    return PageInfo(has_next_page=raw.get("hasNextPage", False), next_cursor=raw.get("nextCursor"))


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


@dataclass
class ConfigErrorDetail:
    """One field- or key-level problem within a failed request."""

    message: str
    key: str | None = None
    field: str | None = None
    allowed_values: list[Any] | None = None


def error_detail_from_wire(raw: dict) -> ConfigErrorDetail:
    return ConfigErrorDetail(
        message=raw["message"],
        key=raw.get("key"),
        field=raw.get("field"),
        allowed_values=raw.get("allowedValues"),
    )


@dataclass
class ConfigErrorBody:
    """The error envelope returned by every non-2xx response."""

    code: str
    message: str
    locked_by: Scope | None = None
    current_version: str | None = None
    details: list[ConfigErrorDetail] | None = None


__all__ = [
    "KEY_DEFINITION_ID_PREFIX",
    "NAMESPACE_ID_PREFIX",
    "SCOPE_CHAIN",
    "ConfigErrorBody",
    "ConfigErrorCode",
    "ConfigErrorDetail",
    "ConfigOperation",
    "ConfigOperationType",
    "ConfigWriteRequest",
    "ConfigWriteResult",
    "EffectiveConfig",
    "EffectiveConfigEntry",
    "KeyDefinition",
    "KeyDefinitionInput",
    "KeyDefinitionManifest",
    "KeyDefinitionManifestResult",
    "Namespace",
    "NamespaceCreate",
    "PageInfo",
    "Paged",
    "Precedence",
    "Scope",
    "ScopeType",
    "ValueType",
    "error_detail_from_wire",
    "page_info_from_wire",
    "scope_from_wire",
    "scope_to_wire",
]
