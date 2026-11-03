"""Payload validators for the selection-lists.* event family — mirror of the
``selectionLists*SchemaV1`` schemas in shared/src/kafka/schemas. Uses the shared
building blocks in ``selection_lists_common``. Field names are camelCase.

The INBOUND ``seed.requested`` schema is mirrored fully, including its strict
nested objects and the ``refineSeedLists`` cross-list rules (unique list keys,
unique item codes per list, the per-seed item ceiling, and the translation
source-locale / duplicate-locale rules), so a Python producer cannot emit a
request the Node consumer would reject.
"""

from __future__ import annotations

from typing import Any

from ._validate import _V, discriminated, unique
from .selection_lists_common import (
    DESCRIPTION_MAX,
    ITEM_CODE_RE,
    KEY_RE,
    LOCALES,
    MAX_FORK_ITEMS,
    MAX_ITEMS_PER_LIST,
    MAX_ITEMS_PER_SEED,
    MAX_LISTS_PER_SEED,
    MESSAGE_MAX,
    NAME_MAX,
    ROLES,
    SEED_REQUEST_ID_RE,
    SEED_SCOPES,
    SLUG_RE,
    VISIBILITIES,
    apply_event_base,
    item_id,
    item_snapshot,
    list_id,
    list_snapshot,
    org_id,
    user_id,
    validate_actor,
)

# ── list.* ─────────────────────────────────────────────────────────────


def validate_list_created(p: Any) -> dict:
    v = _V("selection-lists.list.created", p)
    apply_event_base(v)
    v.nested("list", list_snapshot)
    return v.done()


def validate_list_updated(p: Any) -> dict:
    v = _V("selection-lists.list.updated", p)
    apply_event_base(v)
    v.nested("list", list_snapshot)
    v.string_array(
        "changedFields",
        min_len=1,
        allowed=("key", "sourceLocale", "status", "name", "description"),
    )
    # Node declares previousKey `slListKeyV1.nullable()` — REQUIRED and present,
    # may be null (NOT `.optional()`). A list.updated whose key did not change
    # still carries `previousKey: null`; omitting the field is rejected. So
    # required=True (the default) is correct here; required=False would accept a
    # payload the Node consumer rejects.
    v.string("previousKey", nullable=True, pattern=KEY_RE)
    out = v.done()
    key_changed = "key" in out["changedFields"]
    if key_changed and out.get("previousKey") is None:
        raise v.fail("previousKey must be set when 'key' is in changedFields")
    if not key_changed and out.get("previousKey") is not None:
        raise v.fail("previousKey must be null unless 'key' is in changedFields")
    return out


def validate_list_archived(p: Any) -> dict:
    v = _V("selection-lists.list.archived", p)
    apply_event_base(v)
    v.nested("list", list_snapshot)
    out = v.done()
    if out["list"]["status"] != "archived":
        raise v.fail("list.status must be 'archived'")
    return out


def validate_list_deleted(p: Any) -> dict:
    v = _V("selection-lists.list.deleted", p)
    apply_event_base(v)
    return v.done()


def _fork_source(value: Any) -> dict:
    sv = _V("selection-lists.list.forked.source", value)
    list_id(sv, "listId")
    org_id(sv, "organizationId")
    sv.string("listKey", pattern=KEY_RE, min_len=2, max_len=64)
    sv.integer("listRevision", gt=0)
    return sv.done()


def _item_map_entry(value: Any) -> dict:
    sv = _V("selection-lists.list.forked.itemMap", value)
    item_id(sv, "originItemId")
    item_id(sv, "itemId")
    return sv.done()


def validate_list_forked(p: Any) -> dict:
    v = _V("selection-lists.list.forked", p)
    apply_event_base(v)
    v.nested("list", list_snapshot)
    v.nested("source", _fork_source)
    v.array("itemMap", _item_map_entry, max_len=MAX_FORK_ITEMS)
    out = v.done()
    if out["source"]["organizationId"] == out["organizationId"]:
        raise v.fail("a fork must cross organizations (source.org != fork.org)")
    if out["source"]["listKey"] != out["listKey"]:
        raise v.fail("source.listKey must equal the fork listKey")
    if out["list"].get("visibility") == "platform":
        # Mirrors selectionListsListForkedSchemaV1: a fork is never a platform list.
        raise v.fail("a fork is never a platform list")
    unique(v.name, (m["originItemId"] for m in out["itemMap"]), "origin itemId")
    unique(v.name, (m["itemId"] for m in out["itemMap"]), "fork itemId")
    return out


def validate_visibility_changed(p: Any) -> dict:
    v = _V("selection-lists.visibility.changed", p)
    apply_event_base(v)
    v.nested("list", list_snapshot)
    v.enum("previousVisibility", VISIBILITIES)
    v.enum("visibility", VISIBILITIES)
    out = v.done()
    if out["previousVisibility"] == out["visibility"]:
        raise v.fail("visibility must actually change")
    if out["previousVisibility"] == "platform":
        raise v.fail("a platform list's visibility cannot be changed")
    if out["list"].get("visibility") not in (None, out["visibility"]):
        raise v.fail("list.visibility must equal the new visibility")
    return out


# ── item.* ─────────────────────────────────────────────────────────────


def validate_item_created(p: Any) -> dict:
    v = _V("selection-lists.item.created", p)
    apply_event_base(v)
    v.nested("item", item_snapshot)
    return v.done()


def validate_item_updated(p: Any) -> dict:
    v = _V("selection-lists.item.updated", p)
    apply_event_base(v)
    v.nested("item", item_snapshot)
    v.string_array(
        "changedFields",
        min_len=1,
        allowed=("label", "description", "sortOrder", "status"),
    )
    return v.done()


def validate_item_archived(p: Any) -> dict:
    v = _V("selection-lists.item.archived", p)
    apply_event_base(v)
    v.nested("item", item_snapshot)
    out = v.done()
    if out["item"]["status"] != "archived":
        raise v.fail("item.status must be 'archived'")
    return out


def validate_item_deleted(p: Any) -> dict:
    v = _V("selection-lists.item.deleted", p)
    apply_event_base(v)
    item_id(v, "itemId")
    v.string("code", pattern=ITEM_CODE_RE, min_len=1, max_len=63)
    return v.done()


def _reorder_entry(value: Any) -> dict:
    sv = _V("selection-lists.item.reordered.order", value)
    item_id(sv, "itemId")
    sv.string("code", pattern=ITEM_CODE_RE, min_len=1, max_len=63)
    sv.integer("sortOrder", ge=0)
    return sv.done()


def validate_item_reordered(p: Any) -> dict:
    v = _V("selection-lists.item.reordered", p)
    apply_event_base(v)
    v.array("order", _reorder_entry, min_len=1, max_len=MAX_ITEMS_PER_LIST)
    return v.done()


# ── translation.* ──────────────────────────────────────────────────────


def _upsert_target(value: Any) -> dict:
    def _list(val: Any) -> dict:
        sv = _V("translation.target.list", val)
        sv.enum("kind", ("list",))
        sv.string("name", min_len=1, max_len=NAME_MAX)
        sv.string("description", nullable=True, max_len=DESCRIPTION_MAX)
        return sv.done()

    def _item(val: Any) -> dict:
        sv = _V("translation.target.item", val)
        sv.enum("kind", ("item",))
        item_id(sv, "itemId")
        sv.string("itemCode", pattern=ITEM_CODE_RE)
        sv.string("label", min_len=1, max_len=NAME_MAX)
        sv.string("description", nullable=True, max_len=DESCRIPTION_MAX)
        return sv.done()

    return discriminated("translation.target", value, "kind", {"list": _list, "item": _item})


def validate_translation_upserted(p: Any) -> dict:
    v = _V("selection-lists.translation.upserted", p)
    apply_event_base(v)
    v.enum("locale", LOCALES)
    v.boolean("isMachine")
    v.nested("target", _upsert_target)
    return v.done()


def _delete_target(value: Any) -> dict:
    def _list(val: Any) -> dict:
        sv = _V("translation.target.list", val)
        sv.enum("kind", ("list",))
        return sv.done()

    def _item(val: Any) -> dict:
        sv = _V("translation.target.item", val)
        sv.enum("kind", ("item",))
        item_id(sv, "itemId")
        sv.string("itemCode", pattern=ITEM_CODE_RE)
        return sv.done()

    return discriminated("translation.target", value, "kind", {"list": _list, "item": _item})


def validate_translation_deleted(p: Any) -> dict:
    v = _V("selection-lists.translation.deleted", p)
    apply_event_base(v)
    v.enum("locale", LOCALES)
    v.nested("target", _delete_target)
    return v.done()


# ── access.* (no listRevision; not the common base) ────────────────────


def validate_access_granted(p: Any) -> dict:
    v = _V("selection-lists.access.granted", p)
    v.uuid("eventId")
    org_id(v, "organizationId")
    v.nested("actor", validate_actor)
    list_id(v, "listId")
    v.string("listKey", pattern=KEY_RE, min_len=2, max_len=64)
    user_id(v, "userId")
    v.enum("role", ROLES)
    v.enum("previousRole", ROLES, nullable=True)
    return v.done()


def validate_access_revoked(p: Any) -> dict:
    v = _V("selection-lists.access.revoked", p)
    v.uuid("eventId")
    org_id(v, "organizationId")
    v.nested("actor", validate_actor)
    list_id(v, "listId")
    v.string("listKey", pattern=KEY_RE, min_len=2, max_len=64)
    user_id(v, "userId")
    v.enum("role", ROLES)
    return v.done()


# ── seed.* (shape-level; see fidelity note) ────────────────────────────


# seed.requested is INBOUND and its Node schema is fully strict with cross-list
# refinements (selectionListsSeedRequestedSchemaV1 + refineSeedLists). These
# validators mirror that faithfully — every nested object is strict and the
# refineSeedLists rules are enforced — so a Python producer cannot emit a
# request the Node consumer would reject + dead-letter. `_seed_source` /
# `_seed_pack` are shared with the (non-strict) seed OUTCOME base, so their
# strictness is caller-controlled.


def _seed_source(value: Any, *, allow_platform: bool = True, strict: bool = False) -> dict:
    sv = _V("seed.source", value)
    sv.string("app", pattern=SLUG_RE)
    sv.string("service", min_len=1, max_len=128)
    # Only seed.requested forbids the reserved 'platform' source (an app may not
    # impersonate the service's own default packs). The OUTCOME events
    # (seed.completed / seed.failed) legitimately carry source.app='platform'
    # for platform-default seeding — the Node slSeedOutcomeBaseV1 uses the plain
    # slSeedSourceV1 with no such refinement, so rejecting it here diverged.
    if not allow_platform and sv.out["app"] == "platform":
        raise sv.fail("'platform' is reserved for the service's own packs (seed.requested only)")
    return sv.done(strict=strict)


def _seed_pack(value: Any, *, strict: bool = False) -> dict:
    sv = _V("seed.pack", value)
    sv.string("key", pattern=SLUG_RE)
    sv.integer("version", gt=0)
    return sv.done(strict=strict)


_SEED_TRIGGERS = ("org-created", "app-installed", "app-upgraded", "backfill", "manual")


# Non-source-locale translations carried on a seed list/item. Mirror of the
# strict slSeedListTranslationV1 / slSeedItemTranslationV1: validated AND
# preserved (dropping them would lose localized content a caller passed in).
_MAX_SEED_TRANSLATIONS = len(LOCALES) - 1


def _seed_list_translation(value: Any) -> dict:
    tv = _V("seed.list.translation", value)
    tv.enum("locale", LOCALES)
    tv.string("name", min_len=1, max_len=NAME_MAX)
    tv.string("description", required=False, max_len=DESCRIPTION_MAX)
    return tv.done(strict=True)


def _seed_item_translation(value: Any) -> dict:
    tv = _V("seed.list.item.translation", value)
    tv.enum("locale", LOCALES)
    tv.string("label", min_len=1, max_len=NAME_MAX)
    tv.string("description", required=False, max_len=DESCRIPTION_MAX)
    return tv.done(strict=True)


def _check_seed_translations(sv: _V, translations: list, source_locale: str) -> None:
    """Mirror of checkTranslations (selection-lists.common.ts): no translation
    for the source locale (that text belongs in name/label), and no duplicate
    locale within one translations array."""
    seen: set = set()
    for t in translations:
        loc = t["locale"]
        if loc == source_locale:
            raise sv.fail(
                f"translation locale '{loc}' is the source locale; put that text in name/label instead"
            )
        if loc in seen:
            raise sv.fail(f"duplicate translation locale '{loc}'")
        seen.add(loc)


def _seed_item_spec(value: Any) -> dict:
    """One item to seed — mirror of the strict slSeedItemSpecV1."""
    sv = _V("seed.list.item", value)
    sv.string("code", pattern=ITEM_CODE_RE, min_len=1, max_len=63)
    sv.string("label", min_len=1, max_len=NAME_MAX)
    sv.string("description", required=False, max_len=DESCRIPTION_MAX)
    sv.array("translations", _seed_item_translation, required=False, max_len=_MAX_SEED_TRANSLATIONS)
    return sv.done(strict=True)


def _seed_list_spec(value: Any) -> dict:
    """One list to seed — mirror of the strict slSeedListSpecV1 plus the per-list
    refineSeedLists rules: unique item codes, and translations that are neither
    the source locale nor duplicated. The cross-LIST rules (unique list keys, the
    per-seed total-item ceiling) live in validate_seed_requested, which sees all
    lists. A malformed list (``null``, ``{}``, missing ``items``, unknown key)
    therefore fails locally rather than being dead-lettered by the Node consumer."""
    sv = _V("seed.list", value)
    sv.string("key", pattern=KEY_RE, min_len=2, max_len=64)
    sv.enum("sourceLocale", LOCALES)
    sv.string("name", min_len=1, max_len=NAME_MAX)
    sv.string("description", required=False, max_len=DESCRIPTION_MAX)
    sv.enum("visibility", VISIBILITIES, required=False)
    sv.array("translations", _seed_list_translation, required=False, max_len=_MAX_SEED_TRANSLATIONS)
    sv.array("items", _seed_item_spec, max_len=MAX_ITEMS_PER_LIST)
    out = sv.done(strict=True)
    source_locale = out["sourceLocale"]
    unique(sv.name, (it["code"] for it in out["items"]), "item code")
    _check_seed_translations(sv, out.get("translations", []), source_locale)
    for it in out["items"]:
        # Node checks item translations against the LIST's source locale.
        _check_seed_translations(sv, it.get("translations", []), source_locale)
    return out


def validate_seed_requested(p: Any) -> dict:
    v = _V("selection-lists.seed.requested", p)
    v.string("requestId", pattern=SEED_REQUEST_ID_RE)
    org_id(v, "organizationId")
    v.enum("scope", SEED_SCOPES)
    user_id(v, "userId", required=False)
    v.nested("source", lambda x: _seed_source(x, allow_platform=False, strict=True))
    v.nested("pack", lambda x: _seed_pack(x, strict=True))
    v.enum("trigger", _SEED_TRIGGERS)

    def _attestation(value: Any) -> dict:
        sv = _V("seed.attestation", value)
        sv.enum("kind", ("service-token",))
        sv.string("token", min_len=1, max_len=4096)
        return sv.done(strict=True)

    v.nested("attestation", _attestation)
    v.array("lists", _seed_list_spec, min_len=1, max_len=MAX_LISTS_PER_SEED)
    out = v.done(strict=True)
    if out["scope"] == "user" and not out.get("userId"):
        raise v.fail("userId is required when scope is 'user'")
    if out["scope"] == "org" and out.get("userId") is not None:
        raise v.fail("userId must be omitted when scope is 'org'")
    # refineSeedLists (selection-lists.common.ts) + the request superRefine: an
    # app request may not create a platform list; list keys are unique across the
    # seed; and the seed has a total-item ceiling.
    for lst in out["lists"]:
        if lst.get("visibility") == "platform":
            raise v.fail("an app seed request cannot create a platform (common) list; use 'org' or 'private'")
    unique(v.name, (lst["key"] for lst in out["lists"]), "list key")
    total_items = sum(len(lst.get("items", [])) for lst in out["lists"])
    if total_items > MAX_ITEMS_PER_SEED:
        raise v.fail(f"a seed may carry at most {MAX_ITEMS_PER_SEED} items in total (got {total_items})")
    return out


_SEED_OUTCOMES = ("applied", "upgraded", "already-applied", "superseded")
_SEED_FAIL_REASONS = (
    "SCOPE_UNSUPPORTED",
    "SEEDING_DISABLED",
    "ATTESTATION_INVALID",
    "SOURCE_NOT_ALLOWED",
    "NAMESPACE_VIOLATION",
    "LIMIT_EXCEEDED",
    "QUOTA_EXCEEDED",
    "KEY_CONFLICT",
    "PACK_CONTENT_MISMATCH",
    "ORG_UNKNOWN",
    "ORG_INACTIVE",
    "VALIDATION_ERROR",
    "INTERNAL_ERROR",
)


def _seed_outcome_base(v: _V) -> None:
    v.uuid("eventId")
    v.string("requestId", nullable=True, pattern=SEED_REQUEST_ID_RE)
    org_id(v, "organizationId")
    v.enum("scope", SEED_SCOPES)
    user_id(v, "userId", required=False)
    v.nested("source", _seed_source)
    v.nested("pack", _seed_pack)
    v.enum("trigger", _SEED_TRIGGERS)


def validate_seed_completed(p: Any) -> dict:
    v = _V("selection-lists.seed.completed", p)
    _seed_outcome_base(v)
    v.enum("outcome", _SEED_OUTCOMES)
    v.integer("appliedVersion", gt=0)

    def _list_outcome(value: Any) -> dict:
        sv = _V("seed.completed.list", value)
        list_id(sv, "listId", nullable=True)
        sv.string("key", pattern=KEY_RE)
        sv.enum(
            "action",
            ("created", "updated", "unchanged", "archived", "skipped-user-edited", "skipped-user-deleted"),
        )
        sv.integer("itemsCreated", ge=0)
        sv.integer("itemsUpdated", ge=0)
        sv.integer("itemsArchived", ge=0)
        sv.integer("itemsSkipped", ge=0)
        return sv.done()

    v.array("lists", _list_outcome, max_len=100)
    return v.done()


def validate_seed_failed(p: Any) -> dict:
    v = _V("selection-lists.seed.failed", p)
    _seed_outcome_base(v)
    v.enum("reason", _SEED_FAIL_REASONS)
    v.string("message", min_len=1, max_len=MESSAGE_MAX)
    v.boolean("retryable")

    def _detail(value: Any) -> dict:
        sv = _V("seed.failed.detail", value)
        sv.string("listKey", required=False, pattern=KEY_RE)
        sv.string("itemCode", required=False, pattern=ITEM_CODE_RE)
        sv.string("path", required=False, max_len=256)
        sv.enum(
            "quotaScope",
            ("org_lists", "list_items", "request_lists", "request_items"),
            required=False,
        )
        sv.integer("limit", required=False, ge=0)
        sv.integer("current", required=False, ge=0)
        sv.integer("requested", required=False, ge=0)
        return sv.done()

    v.array("details", _detail, max_len=50)
    return v.done()
