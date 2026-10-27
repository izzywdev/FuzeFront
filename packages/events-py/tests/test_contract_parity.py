"""Cross-language contract parity: the Python mirror must match the live Node
Kafka contract. Reads shared/src/kafka/types.ts and registry.ts directly and
fails on ANY drift (a topic in one language and not the other, or a registered
schema mismatch). This is the Python half of the `gate-event-envelope` parity
check (governance/event-envelope-policy.json -> parity.pythonMirror).
"""

from __future__ import annotations

import pathlib
import re

from fuzefront_events.registry import SCHEMA_BY_TOPIC
from fuzefront_events.topics import TOPICS

# packages/events-py/tests/<this> -> parents[3] == repo root
_REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
_TYPES_TS = _REPO_ROOT / "shared" / "src" / "kafka" / "types.ts"
_REGISTRY_TS = _REPO_ROOT / "shared" / "src" / "kafka" / "registry.ts"

_TOPIC_LINE = re.compile(r"^\s*([A-Z0-9_]+):\s*'([^']+)'", re.MULTILINE)
_REGISTRY_KEY = re.compile(r"\[TOPICS\.([A-Z0-9_]+)\]\s*:")


def _node_topics() -> dict:
    text = _TYPES_TS.read_text()
    block = text.split("export const TOPICS = {", 1)[1].split("} as const", 1)[0]
    return {k: v for k, v in _TOPIC_LINE.findall(block)}


def _node_registered_keys() -> set:
    text = _REGISTRY_TS.read_text()
    block = text.split("SCHEMA_BY_TOPIC", 1)[1].split("};", 1)[0]
    return set(_REGISTRY_KEY.findall(block))


def test_topics_match_node_exactly():
    node = _node_topics()
    assert dict(TOPICS) == node, (
        "Python TOPICS drifted from shared/src/kafka/types.ts.\n"
        f"missing in Python: {set(node) - set(TOPICS)}\n"
        f"extra in Python:   {set(TOPICS) - set(node)}\n"
        f"value mismatches:  "
        f"{ {k: (node[k], TOPICS[k]) for k in set(node) & set(TOPICS) if node[k] != TOPICS[k]} }"
    )


def test_registered_schema_topics_match_node():
    node_keys = _node_registered_keys()
    node_topic_values = {_node_topics()[k] for k in node_keys}
    py_topic_values = set(SCHEMA_BY_TOPIC)
    assert py_topic_values == node_topic_values, (
        "Python SCHEMA_BY_TOPIC drifted from shared/src/kafka/registry.ts.\n"
        f"registered in Node not Python: {node_topic_values - py_topic_values}\n"
        f"registered in Python not Node: {py_topic_values - node_topic_values}"
    )


def test_every_registered_validator_is_callable():
    for topic, validator in SCHEMA_BY_TOPIC.items():
        assert callable(validator), f"{topic} validator is not callable"
