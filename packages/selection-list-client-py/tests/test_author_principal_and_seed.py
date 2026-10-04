"""
Contract 4.0.0: ``created_by`` / ``granted_by`` are an ``AuthorPrincipal`` (user
id, system principal, or the deleted-user sentinel) and lists/items carry a
read-only, nullable ``seed``. These tests pin the client to the spec text and to
the sentinel the service handler actually writes, so the three cannot drift.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fuzefront_selection_list_client import (
    DELETED_USER_SENTINEL,
    SYSTEM_PRINCIPAL_PREFIX,
    USER_ID_PREFIX,
    AuthorPrincipalKind,
    SeedProvenance,
    author_principal_kind,
    is_user_author,
)
from fuzefront_selection_list_client.client import (
    _parse_access_entry,
    _parse_item,
    _parse_selection_list,
)

_ROOT = Path(__file__).resolve().parents[3]
_SPEC = (_ROOT / "services" / "selection-list-service" / "openapi.yaml").read_text(encoding="utf-8")
_HANDLER = (
    _ROOT / "services" / "selection-list-service" / "src" / "events" / "user-deleted.handler.ts"
).read_text(encoding="utf-8")

_NOW = "2026-10-04T12:00:00Z"
_SEED = {"source": "platform", "pack_key": "platform-defaults", "pack_version": 1, "user_modified": False}


def _schema_block(name: str) -> str:
    """The YAML text of one ``components.schemas`` entry (4-space-indented name)."""
    start = _SPEC.index(f"\n    {name}:\n") + 1
    lines = _SPEC[start:].splitlines(keepends=True)
    out = [lines[0]]
    for line in lines[1:]:
        if line.startswith("    ") and not line.startswith("     ") and line.strip():
            break
        out.append(line)
    return "".join(out)


@pytest.mark.parametrize(
    ("value", "kind"),
    [
        ("usr_01h455vb4pex5vsknk084sn02q", AuthorPrincipalKind.USER),
        ("system:selection-list-service", AuthorPrincipalKind.SYSTEM),
        ("[deleted-user]", AuthorPrincipalKind.DELETED_USER),
        ("org_01h455vb4pex5vsknk084sn02q", AuthorPrincipalKind.UNKNOWN),
        ("", AuthorPrincipalKind.UNKNOWN),
    ],
)
def test_author_principal_kind(value: str, kind: AuthorPrincipalKind) -> None:
    assert author_principal_kind(value) is kind
    assert is_user_author(value) is (kind is AuthorPrincipalKind.USER)


def test_sentinel_matches_spec_and_handler() -> None:
    assert f"const: '{DELETED_USER_SENTINEL}'" in _schema_block("DeletedUserSentinel")
    assert f"const sentinel = '{DELETED_USER_SENTINEL}'" in _HANDLER


def test_prefixes_match_spec_patterns() -> None:
    assert f"pattern: '^{SYSTEM_PRINCIPAL_PREFIX}[a-z0-9-]+$'" in _schema_block("SystemPrincipal")
    assert f"pattern: '^{USER_ID_PREFIX}[0-9a-z]+$'" in _schema_block("UserId")
    author = _schema_block("AuthorPrincipal")
    for ref in ("UserId", "SystemPrincipal", "DeletedUserSentinel"):
        assert f"$ref: '#/components/schemas/{ref}'" in author


def test_seed_provenance_fields_match_spec() -> None:
    block = _schema_block("SeedProvenance")
    assert "required: [source, pack_key, pack_version, user_modified]" in block
    assert set(SeedProvenance.__dataclass_fields__) == {"source", "pack_key", "pack_version", "user_modified"}
    for resource in ("SelectionList", "SelectionListItem"):
        assert "\n        - seed\n" in _schema_block(resource), f"{resource} must require seed"


def _list(**over: object) -> dict:
    raw: dict = {
        "id": "front_sl_01h455vb4pex5vsknk084sn02q",
        "organization_id": "org_01h455vb4pex5vsknk084sn02q",
        "key": "priority",
        "source_locale": "en",
        "status": "active",
        "name": "Priority",
        "resolved_locale": "en",
        "is_machine": False,
        "seed": None,
        "created_by": "usr_01h455vb4pex5vsknk084sn02q",
        "created_at": _NOW,
        "updated_at": _NOW,
    }
    raw.update(over)
    return raw


def test_parses_seeded_list_with_system_author() -> None:
    sl = _parse_selection_list(_list(seed=_SEED, created_by="system:selection-list-service"))
    assert sl.seed == SeedProvenance("platform", "platform-defaults", 1, False)
    assert author_principal_kind(sl.created_by) is AuthorPrincipalKind.SYSTEM


def test_parses_user_list_with_null_seed_and_tolerates_absent_seed() -> None:
    assert _parse_selection_list(_list()).seed is None
    raw = _list()
    del raw["seed"]
    assert _parse_selection_list(raw).seed is None


def test_parses_item_with_deleted_author_and_seed() -> None:
    item = _parse_item(
        {
            "id": "front_sli_01h455vb4pex5vsknk084sn02q",
            "list_id": "front_sl_01h455vb4pex5vsknk084sn02q",
            "code": "HIGH",
            "sort_order": 300,
            "status": "active",
            "label": "High",
            "resolved_locale": "en",
            "is_machine": False,
            "seed": {**_SEED, "user_modified": True},
            "created_by": "[deleted-user]",
            "created_at": _NOW,
            "updated_at": _NOW,
        }
    )
    assert item.seed is not None
    assert item.seed.user_modified is True
    assert not is_user_author(item.created_by)


def test_parses_grant_with_deleted_granter() -> None:
    entry = _parse_access_entry(
        {
            "list_id": "front_sl_01h455vb4pex5vsknk084sn02q",
            "user_id": "usr_01h455vb4pex5vsknk084sn02q",
            "role": "list-viewer",
            "granted_by": "[deleted-user]",
            "granted_at": _NOW,
            "updated_at": _NOW,
        }
    )
    assert author_principal_kind(entry.granted_by) is AuthorPrincipalKind.DELETED_USER
