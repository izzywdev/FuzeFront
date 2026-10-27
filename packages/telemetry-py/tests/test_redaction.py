"""Secret redaction, and that the list is the single family source of truth."""

import json
import os

from fuzefront_telemetry import redact, redaction_paths, redaction_source
from fuzefront_telemetry.redaction import REDACTED


def test_redacts_matching_keys_at_any_depth():
    payload = {
        "user": "u1",
        "password": "hunter2",
        "nested": {"token": "abc", "safe": "keep"},
        "list": [{"client_secret": "s"}, {"ok": 1}],
    }
    out = redact(payload)
    assert out["password"] == REDACTED
    assert out["nested"]["token"] == REDACTED
    assert out["nested"]["safe"] == "keep"
    assert out["list"][0]["client_secret"] == REDACTED
    assert out["list"][1]["ok"] == 1
    # input not mutated
    assert payload["password"] == "hunter2"


def test_header_keys_redacted_case_insensitively():
    out = redact({"Authorization": "Bearer x", "Cookie": "s=1", "Set-Cookie": "s=1"})
    assert out["Authorization"] == REDACTED
    assert out["Cookie"] == REDACTED
    assert out["Set-Cookie"] == REDACTED


def test_non_container_passthrough():
    assert redact("plain") == "plain"
    assert redact(42) == 42
    assert redact(None) is None


def test_list_covers_mandated_secret_keys():
    paths = redaction_paths()
    joined = " ".join(paths)
    for required in ("password", "token", "authorization", "cookie", "client_secret", "secret"):
        assert required in joined


def test_source_matches_governance_canonical():
    """The loaded list must equal the governance source of truth byte-for-byte."""
    src = redaction_source()
    assert os.path.isfile(src)
    with open(src, encoding="utf-8") as f:
        loaded = tuple(json.load(f)["paths"])
    assert loaded == redaction_paths()
