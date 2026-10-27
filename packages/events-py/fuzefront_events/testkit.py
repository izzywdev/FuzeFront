"""Test helpers: in-memory broker double and delivery-fault helpers.

broker = InMemoryBroker(partitions=3)
await drain_once(sf, broker)                 # relay -> broker
msgs = broker.messages("identity.org.updated")
for m in duplicate(shuffle(msgs, seed=1), times=2):
    await processor.process(m)               # at-least-once, out of order
"""

from __future__ import annotations

import random
import zlib
from collections.abc import Callable, Iterable, Sequence

from .consumer import EventProcessor, Message


class InMemoryBroker:
    """``Publisher`` double: records messages with per-partition offsets; can inject failures."""

    def __init__(self, partitions: int = 1):
        self.partitions = partitions
        self._log: list[Message] = []
        self._offsets: dict[tuple[str, int], int] = {}
        self.fail_if: Callable[[str, bytes | None, bytes], bool] | None = None
        self.sent_headers: list[Sequence[tuple[str, bytes]]] = []

    def fail_topic(self, topic: str) -> None:
        self.fail_if = lambda t, k, v: t == topic

    def heal(self) -> None:
        self.fail_if = None

    async def send(self, topic, key, value, headers=()):
        if self.fail_if is not None and self.fail_if(topic, key, value):
            raise ConnectionError(f"broker unavailable for {topic}")
        part = (zlib.crc32(key) % self.partitions) if key else 0
        off = self._offsets.get((topic, part), 0)
        self._offsets[(topic, part)] = off + 1
        self._log.append(Message(topic, part, off, key, value))
        self.sent_headers.append(tuple(headers))

    def messages(self, topic: str | None = None) -> list[Message]:
        return [m for m in self._log if topic is None or m.topic == topic]


def duplicate(messages: Iterable[Message], times: int = 2) -> list[Message]:
    """Each message ``times`` times, back to back (broker redelivery)."""
    return [m for m in messages for _ in range(times)]


def shuffle(messages: Iterable[Message], seed: int = 0) -> list[Message]:
    """Deterministic reordering (cross-partition / rebalance reorder)."""
    out = list(messages)
    random.Random(seed).shuffle(out)
    return out


def replay(messages: Iterable[Message]) -> list[Message]:
    """The whole stream delivered a second time (offset reset / reprocess)."""
    msgs = list(messages)
    return msgs + msgs


async def deliver(processor: EventProcessor, messages: Iterable[Message]) -> list[str]:
    """Feed messages to a processor in order; return the outcome per message."""
    return [await processor.process(m) for m in messages]
