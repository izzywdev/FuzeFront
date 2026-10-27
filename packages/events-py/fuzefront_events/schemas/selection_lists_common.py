"""Shared building blocks for the selection-lists.* event schemas — mirror of
shared/src/kafka/schemas/selection-lists.common.ts (patterns, limits, scalars,
snapshots, the actor discriminated union).

Fidelity note: scalar formats, enums, nullability, snapshots and the common
event base are mirrored faithfully. The deep seed-request refinements (unique
keys/codes across a seed, per-seed item ceilings) are validated at shape level
here (required fields, enums, array caps) — the authoritative, exhaustive seed
validation lives in selection-list-service's own contract; a Python consumer
does not re-run it.
"""

from __future__ import annotations

import re
from typing import Any

from ._validate import _V, discriminated

# ── patterns ───────────────────────────────────────────────────────────
KEY_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$")
ITEM_CODE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$")
SLUG_RE = KEY_RE
SEED_REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
ORG_ID_RE = re.compile(r"^org_[0-9a-z]+$")
USER_ID_RE = re.compile(r"^usr_[0-9a-z]+$")
LIST_ID_RE = re.compile(r"^front_sl_[0-9a-z]+$")
ITEM_ID_RE = re.compile(r"^front_sli_[0-9a-z]+$")

# ── enums ──────────────────────────────────────────────────────────────
LOCALES = ("en", "es", "fr", "de", "pt", "ru", "zh", "ja", "hi", "ar", "he")
ROLES = (
    "list-owner",
    "list-editor",
    "list-contributor",
    "list-translator",
    "list-viewer",
)
VISIBILITIES = ("private", "org", "platform")
LIFECYCLE_STATUS = ("active", "archived")
SEED_SCOPES = ("org", "user")

# ── limits ─────────────────────────────────────────────────────────────
NAME_MAX = 200
DESCRIPTION_MAX = 2000
MAX_ITEMS_PER_LIST = 500
MAX_LISTS_PER_SEED = 20
MAX_ITEMS_PER_SEED = 2000
MAX_SEED_REQUEST_BYTES = 900000
MAX_ATTESTATION_TOKEN_LENGTH = 4096
MESSAGE_MAX = 1000
MAX_FORK_ITEMS = 5000


# ── scalars (TypeID-shaped strings) ────────────────────────────────────
def org_id(v: _V, field: str, **kw: Any) -> None:
    v.string(field, pattern=ORG_ID_RE, max_len=255, **kw)


def user_id(v: _V, field: str, **kw: Any) -> None:
    v.string(field, pattern=USER_ID_RE, max_len=255, **kw)


def list_id(v: _V, field: str, **kw: Any) -> None:
    v.string(field, pattern=LIST_ID_RE, max_len=255, **kw)


def item_id(v: _V, field: str, **kw: Any) -> None:
    v.string(field, pattern=ITEM_ID_RE, max_len=255, **kw)


# ── actor (discriminated union on `type`) ──────────────────────────────
def _actor_user(value: Any) -> dict:
    v = _V("slActor.user", value)
    v.enum("type", ("user",))
    user_id(v, "userId")
    return v.done()


def _actor_system(value: Any) -> dict:
    v = _V("slActor.system", value)
    v.enum("type", ("system",))
    v.enum("principal", ("selection-list-service",))
    v.string("seedSource", nullable=True, pattern=SLUG_RE)
    return v.done()


def validate_actor(value: Any) -> dict:
    return discriminated("slActor", value, "type", {"user": _actor_user, "system": _actor_system})


# ── provenance + snapshots ─────────────────────────────────────────────
def _seed_provenance(value: Any) -> dict:
    v = _V("slSeedProvenance", value)
    v.string("source", pattern=SLUG_RE)
    v.string("packKey", pattern=SLUG_RE)
    v.integer("packVersion", gt=0)
    v.boolean("userModified")
    return v.done()


def _fork_provenance(value: Any) -> dict:
    v = _V("slForkProvenance", value)
    list_id(v, "listId")
    org_id(v, "organizationId")
    v.integer("listRevision", gt=0)
    v.datetime("forkedAt")
    return v.done()


def list_snapshot(value: Any) -> dict:
    v = _V("slListSnapshot", value)
    list_id(v, "listId")
    v.string("key", pattern=KEY_RE, min_len=2, max_len=64)
    v.enum("sourceLocale", LOCALES)
    v.enum("status", LIFECYCLE_STATUS)
    v.string("name", min_len=1, max_len=NAME_MAX)
    v.string("description", nullable=True, max_len=DESCRIPTION_MAX)
    v.nested("seed", _seed_provenance, nullable=True)
    v.enum("visibility", VISIBILITIES, required=False)
    v.nested("forkedFrom", _fork_provenance, required=False, nullable=True)
    v.datetime("createdAt")
    v.datetime("updatedAt")
    return v.done()


def item_snapshot(value: Any) -> dict:
    v = _V("slItemSnapshot", value)
    item_id(v, "itemId")
    v.string("code", pattern=ITEM_CODE_RE, min_len=1, max_len=63)
    v.string("label", min_len=1, max_len=NAME_MAX)
    v.string("description", nullable=True, max_len=DESCRIPTION_MAX)
    v.integer("sortOrder", ge=0)
    v.enum("status", LIFECYCLE_STATUS)
    v.nested("seed", _seed_provenance, nullable=True)
    item_id(v, "originItemId", required=False, nullable=True)
    v.datetime("createdAt")
    v.datetime("updatedAt")
    return v.done()


def apply_event_base(v: _V) -> None:
    """Populate the fields shared by most list/item events (slListEventBaseV1)."""
    v.uuid("eventId")
    org_id(v, "organizationId")
    v.nested("actor", validate_actor)
    list_id(v, "listId")
    v.string("listKey", pattern=KEY_RE, min_len=2, max_len=64)
    v.integer("listRevision", gt=0)
