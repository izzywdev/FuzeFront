"""Broker seam. The relay and consumer talk to a :class:`Publisher`, so tests (and
the in-memory broker in :mod:`fuzefront_events.testkit`) never need Kafka."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Protocol


class Publisher(Protocol):
    async def send(
        self,
        topic: str,
        key: bytes | None,
        value: bytes,
        headers: Sequence[tuple[str, bytes]] = (),
    ) -> None:
        """Deliver one message and return only after the broker acknowledged it. Raise on failure."""


class AIOKafkaPublisher:
    """``Publisher`` over ``aiokafka.AIOKafkaProducer`` (acks=all, idempotent)."""

    def __init__(self, bootstrap_servers: str, **producer_kwargs):
        self._bootstrap = bootstrap_servers
        self._kwargs = producer_kwargs
        self._producer = None

    async def start(self) -> None:
        from aiokafka import AIOKafkaProducer

        kwargs = {"acks": "all", "enable_idempotence": True, **self._kwargs}
        self._producer = AIOKafkaProducer(bootstrap_servers=self._bootstrap, **kwargs)
        await self._producer.start()

    async def stop(self) -> None:
        if self._producer is not None:
            await self._producer.stop()
            self._producer = None

    async def send(self, topic, key, value, headers=()):
        if self._producer is None:
            raise RuntimeError("AIOKafkaPublisher not started")
        await self._producer.send_and_wait(topic, value=value, key=key, headers=list(headers) or None)
