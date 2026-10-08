"""
Regression test: the client's id-prefix constants must agree with the frozen
OpenAPI spec and the identity registry (the service mints with the registry).

Previously the constants said ``sl_`` / ``sli_`` while the spec, registry and
service all use ``front_sl_`` / ``front_sli_``. Contract wins.
"""

from __future__ import annotations

import re
from pathlib import Path

from fuzefront_selection_list_client.types import (
    SELECTION_LIST_ID_PREFIX,
    SELECTION_LIST_ITEM_ID_PREFIX,
)

_REPO = Path(__file__).resolve().parents[3]
_SPEC = _REPO / "services" / "selection-list-service" / "openapi.yaml"
_REGISTRY = _REPO / "packages" / "identity-py" / "fuzefront_identity" / "registry.py"


def test_constants_are_namespaced() -> None:
    assert SELECTION_LIST_ID_PREFIX == "front_sl_"
    assert SELECTION_LIST_ITEM_ID_PREFIX == "front_sli_"


def test_constants_match_spec_patterns() -> None:
    spec = _SPEC.read_text()
    assert f"pattern: '^{SELECTION_LIST_ID_PREFIX}[0-9a-z]+$'" in spec
    assert f"pattern: '^{SELECTION_LIST_ITEM_ID_PREFIX}[0-9a-z]+$'" in spec


def test_constants_match_identity_registry() -> None:
    registry = _REGISTRY.read_text()
    list_prefix = re.search(r'"selectionList":\s*"([^"]+)"', registry)
    item_prefix = re.search(r'"selectionListItem":\s*"([^"]+)"', registry)
    assert list_prefix and item_prefix
    assert SELECTION_LIST_ID_PREFIX == f"{list_prefix.group(1)}_"
    assert SELECTION_LIST_ITEM_ID_PREFIX == f"{item_prefix.group(1)}_"
