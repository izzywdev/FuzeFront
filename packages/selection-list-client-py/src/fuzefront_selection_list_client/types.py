"""
Wire types for the selection-list-service.

Hand-authored from ``services/selection-list-service/openapi.yaml`` v4.0.0.
The spec is the source of truth: when it changes, the spec is amended first
and this file updated in the same PR.

Field casing mirrors the contract exactly: resource payloads are ``snake_case``
(mirroring storage), while the pagination envelope uses ``snake_case`` for the
Python idiom; the wire names are ``camelCase`` and are normalised in the
client layer.

All classes use ``dataclasses`` and ``typing`` only -- no third-party deps.
"""

from __future__ import annotations

import enum
from dataclasses import dataclass
from typing import Generic, TypeVar

# ---------------------------------------------------------------------------
# Identifier prefix constants (opaque past the prefix)
# ---------------------------------------------------------------------------

SELECTION_LIST_ID_PREFIX = "front_sl_"
SELECTION_LIST_ITEM_ID_PREFIX = "front_sli_"

# ---------------------------------------------------------------------------
# Authorship principals (contract ``AuthorPrincipal``, 4.0.0)
# ---------------------------------------------------------------------------

USER_ID_PREFIX = "usr_"
"""Wire prefix of a user id."""
SYSTEM_PRINCIPAL_PREFIX = "system:"
"""Wire prefix of a system principal (``^system:[a-z0-9-]+$``)."""
DELETED_USER_SENTINEL = "[deleted-user]"
"""Exact sentinel that replaces a user id once that user is deleted. Not an id."""


class AuthorPrincipalKind(str, enum.Enum):
    """Which form an ``AuthorPrincipal`` (``created_by`` / ``granted_by``) takes."""

    USER = "user"
    SYSTEM = "system"
    DELETED_USER = "deleted-user"
    UNKNOWN = "unknown"


def author_principal_kind(value: str) -> AuthorPrincipalKind:
    """
    Classify a ``created_by`` / ``granted_by`` value from the string alone.

    The three contract forms -- a ``usr_`` user id, a ``system:<service>``
    principal (rows written by seeding), and the ``[deleted-user]`` sentinel --
    are disjoint by prefix. Only the prefix is inspected; ids are opaque past it.
    """
    if value == DELETED_USER_SENTINEL:
        return AuthorPrincipalKind.DELETED_USER
    if value.startswith(SYSTEM_PRINCIPAL_PREFIX):
        return AuthorPrincipalKind.SYSTEM
    if value.startswith(USER_ID_PREFIX):
        return AuthorPrincipalKind.USER
    return AuthorPrincipalKind.UNKNOWN


def is_user_author(value: str) -> bool:
    """True only when ``value`` is a ``usr_`` user id (safe to look up as a user)."""
    return author_principal_kind(value) is AuthorPrincipalKind.USER

# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

LOCALES = ("en", "es", "fr", "de", "pt", "ru", "zh", "ja", "hi", "ar", "he")


class LifecycleStatus(str, enum.Enum):
    """Lifecycle state. ``archived`` rows are hidden from pickers but still resolve."""

    ACTIVE = "active"
    ARCHIVED = "archived"


class StatusFilter(str, enum.Enum):
    """Lifecycle filter accepted by the collection endpoints."""

    ACTIVE = "active"
    ARCHIVED = "archived"
    ALL = "all"


class SelectionListAccessRole(str, enum.Enum):
    """A ReBAC role held on one selection-list instance. Roles do not stack."""

    LIST_OWNER = "list-owner"
    LIST_EDITOR = "list-editor"
    LIST_CONTRIBUTOR = "list-contributor"
    LIST_TRANSLATOR = "list-translator"
    LIST_VIEWER = "list-viewer"


class QuotaScope(str, enum.Enum):
    """The ceiling a ``QUOTA_EXCEEDED`` decision was made against."""

    ORG_LISTS = "org_lists"
    USER_LISTS = "user_lists"
    LIST_ITEMS = "list_items"
    LIST_LOCALES = "list_locales"


class SelectionListErrorCode(str, enum.Enum):
    """
    Stable machine-readable error code. Branch on this, never on ``message``.

    ``UNKNOWN`` is client-only: emitted when a response body is not a
    contract response at all (e.g. an ingress 502 or an HTML error page).
    """

    VALIDATION_ERROR = "VALIDATION_ERROR"
    UNAUTHENTICATED = "UNAUTHENTICATED"
    FORBIDDEN = "FORBIDDEN"
    NOT_FOUND = "NOT_FOUND"
    CONFLICT = "CONFLICT"
    QUOTA_EXCEEDED = "QUOTA_EXCEEDED"
    UNKNOWN = "UNKNOWN"


# ---------------------------------------------------------------------------
# Pagination envelope
# ---------------------------------------------------------------------------


@dataclass
class Page:
    """
    Cursor pagination envelope, identical across every Fuze service
    (``governance/pagination-standard.md`` S1).
    """

    next_cursor: str | None
    """Opaque cursor for the next page; ``None`` on the last page."""
    has_more: bool
    """Whether a further page exists."""
    total: int | None = None
    """Total rows matching the filter, when cheap enough to compute."""


T = TypeVar("T")


@dataclass
class PagedResponse(Generic[T]):
    """A page of ``T`` plus its cursor envelope."""

    items: list[T]
    page: Page


# ---------------------------------------------------------------------------
# Seed provenance
# ---------------------------------------------------------------------------


@dataclass
class SeedProvenance:
    """
    Read-only provenance of a row created by seeding (contract ``SeedProvenance``).

    ``None`` on a user-authored row. Mirrors the event contract's
    ``slSeedProvenanceV1`` in snake_case.
    """

    source: str
    """Seed source: an app slug, or ``platform``."""
    pack_key: str
    """Seed-pack key."""
    pack_version: int
    """Version of the pack that last wrote this row (>= 1)."""
    user_modified: bool
    """Sticky ``True`` once a human edited the seeded content."""


# ---------------------------------------------------------------------------
# Selection lists
# ---------------------------------------------------------------------------


@dataclass
class SelectionList:
    """A selection list with its text resolved for one locale."""

    id: str
    organization_id: str
    key: str
    source_locale: str
    status: LifecycleStatus
    name: str
    resolved_locale: str
    is_machine: bool
    created_by: str
    """``AuthorPrincipal``: ``usr_`` id, ``system:<service>``, or ``[deleted-user]``."""
    created_at: str
    updated_at: str
    description: str | None = None
    item_count: int | None = None
    seed: SeedProvenance | None = None
    """Seed provenance; ``None`` for a user-authored list."""


@dataclass
class CreateListRequest:
    """Body for ``POST /v1/selection-lists``. Carries no ``id``."""

    key: str
    name: str
    source_locale: str | None = None
    description: str | None = None


@dataclass
class UpdateListRequest:
    """Partial update of a list. Every field is optional; at least one must be set."""

    key: str | None = None
    source_locale: str | None = None
    status: LifecycleStatus | None = None
    name: str | None = None
    description: str | None = None


# ---------------------------------------------------------------------------
# Items
# ---------------------------------------------------------------------------


@dataclass
class SelectionListItem:
    """One item of a selection list, with its text resolved for one locale."""

    id: str
    list_id: str
    code: str
    sort_order: int
    status: LifecycleStatus
    label: str
    resolved_locale: str
    is_machine: bool
    created_by: str
    """``AuthorPrincipal``: ``usr_`` id, ``system:<service>``, or ``[deleted-user]``."""
    created_at: str
    updated_at: str
    description: str | None = None
    seed: SeedProvenance | None = None
    """Seed provenance; ``None`` for a user-authored item."""


@dataclass
class CreateItemRequest:
    """Body for ``POST /v1/selection-lists/{listId}/items``. Carries no ``id``."""

    code: str
    label: str
    description: str | None = None
    sort_order: int | None = None


@dataclass
class UpdateItemRequest:
    """
    Partial update of an item. ``code`` is absent by design -- it is immutable
    after create.
    """

    label: str | None = None
    description: str | None = None
    sort_order: int | None = None
    status: LifecycleStatus | None = None


# ---------------------------------------------------------------------------
# Translations
# ---------------------------------------------------------------------------


@dataclass
class Translation:
    """A stored list translation for one locale."""

    list_id: str
    locale: str
    name: str
    is_machine: bool
    updated_at: str
    description: str | None = None
    source_hash: str | None = None


@dataclass
class SelectionListItemTranslation:
    """A stored item translation for one locale."""

    item_id: str
    locale: str
    label: str
    is_machine: bool
    updated_at: str
    description: str | None = None
    source_hash: str | None = None


@dataclass
class TranslationLocaleStatus:
    """
    Translation workbench summary for one locale of a selection list.

    Returned by ``GET /v1/selection-lists/{listId}/translations``.
    """

    locale: str
    completeness_pct: int
    machine_translated: bool
    source_changed: bool


@dataclass
class ItemTranslationLocaleStatus:
    """
    Translation workbench summary for one locale of a selection-list item.

    Returned by ``GET /v1/selection-lists/{listId}/items/{itemId}/translations``.
    """

    locale: str
    machine_translated: bool
    source_changed: bool


@dataclass
class UpsertListTranslationRequest:
    """Human-authored list text for one locale."""

    name: str
    description: str | None = None


@dataclass
class UpsertItemTranslationRequest:
    """Human-authored item text for one locale."""

    label: str
    description: str | None = None


@dataclass
class AutofillRequest:
    """Optional scoping for a machine-translation run."""

    overwrite_machine: bool = False
    item_ids: list[str] | None = None


@dataclass
class AutofillResult:
    """What a machine-translation run wrote and what it left alone."""

    locale: str
    source_locale: str
    list_translated: bool
    items_translated: int
    items_skipped: int


# ---------------------------------------------------------------------------
# Access
# ---------------------------------------------------------------------------


@dataclass
class AccessEntry:
    """One user's role on one selection list."""

    list_id: str
    user_id: str
    role: SelectionListAccessRole
    granted_by: str
    """``AuthorPrincipal``: ``usr_`` id, ``system:<service>``, or ``[deleted-user]``."""
    granted_at: str
    updated_at: str


# ---------------------------------------------------------------------------
# Quota
# ---------------------------------------------------------------------------


@dataclass
class QuotaInfo:
    """Current usage against one ceiling."""

    scope: QuotaScope
    applies_to: str
    limit: int
    current: int | None


@dataclass
class SelectionListQuotaStatus:
    """Quota ceilings and usage for the caller's organisation."""

    organization_id: str
    quotas: list[QuotaInfo]


# ---------------------------------------------------------------------------
# Resolve (hot path)
# ---------------------------------------------------------------------------


@dataclass
class ResolveResult:
    """The minimal resolution of one item id."""

    label: str
    locale: str
    is_machine: bool
    status: LifecycleStatus


@dataclass
class ResolveResponse:
    """
    Resolutions keyed by the id that was asked for, plus every id that could
    not be resolved. Together they always account for the whole request.
    """

    results: dict
    missing: list[str]
