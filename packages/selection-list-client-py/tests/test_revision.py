"""
Client projection of contract 4.2.0: ``SelectionList.revision`` and the
fork-vs-source comparison.

Same in-process stub server as ``test_client.py``. Verifies only how the
client parses the field and what the helper answers -- never the service's
behaviour.
"""

from __future__ import annotations

import dataclasses
from typing import Any

import pytest
from fuzefront_selection_list_client import (
    ForkSourceComparison,
    SelectionListClient,
    compare_fork_to_source,
)
from test_client import StubServer

_NOW = "2026-10-05T12:00:00Z"
_SOURCE = "front_sl_01h455vb4pex5vsknk084sn02q"
_FORK = "front_sl_01h455vb4pex5vsknk084sn03r"


def _wire(**over: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "id": _SOURCE,
        "organization_id": "org_01h455vb4pex5vsknk084sn0pf",
        "key": "priority",
        "source_locale": "en",
        "status": "active",
        "name": "Priority",
        "resolved_locale": "en",
        "is_machine": False,
        "seed": None,
        "visibility": "platform",
        "forked_from": None,
        "editable": False,
        "revision": 9,
        "created_by": "system:platform",
        "created_at": _NOW,
        "updated_at": _NOW,
    }
    base.update(over)
    return base


def _fork_wire(**over: Any) -> dict[str, Any]:
    return _wire(
        id=_FORK,
        organization_id="org_01h455vb4pex5vsknk084sn02q",
        visibility="org",
        editable=True,
        revision=12,
        forked_from={
            "list_id": _SOURCE,
            "organization_id": "org_01h455vb4pex5vsknk084sn0pf",
            "revision": 7,
            "forked_at": _NOW,
        },
        created_by="usr_01h455vb4pex5vsknk084sn02q",
        **over,
    )


def _get(payload: dict[str, Any]) -> Any:
    def handler(h: Any, parsed: Any, qs: dict, body: Any) -> None:
        h.send_json(payload)

    with StubServer({("GET", f"/v1/selection-lists/{payload['id']}"): handler}) as srv:
        return SelectionListClient(base_url=srv.base_url, token="t").get_list(payload["id"])


def test_revision_is_parsed() -> None:
    assert _get(_wire()).revision == 9


@pytest.mark.parametrize("raw", ["absent", None, 0, -1, "9", True, 1.5])
def test_absent_or_unusable_revision_is_unknown(raw: Any) -> None:
    payload = _wire()
    if raw == "absent":
        del payload["revision"]
    else:
        payload["revision"] = raw
    sl = _get(payload)
    assert sl.revision is None
    assert compare_fork_to_source(_get(_fork_wire()), sl) is ForkSourceComparison.UNKNOWN


def test_behind_and_up_to_date() -> None:
    fork = _get(_fork_wire())
    assert compare_fork_to_source(fork, _get(_wire())) is ForkSourceComparison.BEHIND
    assert compare_fork_to_source(fork, _get(_wire(revision=7))) is ForkSourceComparison.UP_TO_DATE


def test_compares_provenance_not_the_forks_own_revision() -> None:
    fork = _get(_fork_wire())
    fork = dataclasses.replace(fork, revision=1)
    assert compare_fork_to_source(fork, _get(_wire())) is ForkSourceComparison.BEHIND


def test_not_a_fork_wrong_source_or_lower_revision_is_unknown() -> None:
    source = _get(_wire())
    fork = _get(_fork_wire())
    assert compare_fork_to_source(source, source) is ForkSourceComparison.UNKNOWN
    other = dataclasses.replace(source, id="front_sl_01h455vb4pex5vsknk084sn04s")
    assert compare_fork_to_source(fork, other) is ForkSourceComparison.UNKNOWN
    lower = dataclasses.replace(source, revision=6)
    assert compare_fork_to_source(fork, lower) is ForkSourceComparison.UNKNOWN


def test_never_reads_updated_at() -> None:
    newer = dataclasses.replace(_get(_wire()), revision=None, updated_at="2030-01-01T00:00:00Z")
    assert compare_fork_to_source(_get(_fork_wire()), newer) is ForkSourceComparison.UNKNOWN


def test_wire_values() -> None:
    assert [c.value for c in ForkSourceComparison] == ["behind", "up-to-date", "unknown"]
