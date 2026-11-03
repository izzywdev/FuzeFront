"""Error types for the fuzefront-events contract mirror."""

from __future__ import annotations


class SchemaValidationError(ValueError):
    """Raised when an event payload fails its schema validation.

    Mirrors the role of a Zod parse error on the Node side: the producer must
    dead-letter rather than publish a payload that does not match the frozen
    contract.
    """

    def __init__(self, topic_or_schema: str, message: str) -> None:
        self.schema = topic_or_schema
        self.reason = message
        super().__init__(f"{topic_or_schema}: {message}")
