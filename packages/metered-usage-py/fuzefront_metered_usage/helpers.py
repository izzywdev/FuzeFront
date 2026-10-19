"""Convenience helpers for common meter event types.

These wrap :meth:`~fuzefront_metered_usage.client.MeteringClient.emit`
with a predetermined ``meter_event_name`` so call sites are concise and
consistent across the fleet.

Example::

    from fuzefront_metered_usage import MeteringClient
    from fuzefront_metered_usage.helpers import emit_token_usage, emit_storage_usage

    client = MeteringClient.from_env(service_name="llm-proxy")
    emit_token_usage(client, entity_id=org_id, tokens=response.usage.total_tokens)
    emit_storage_usage(client, entity_id=org_id, bytes_=len(uploaded_file))
"""

from __future__ import annotations

from datetime import datetime, timezone

from .client import EntityType, MeteringClient, UsageEvent


def emit_token_usage(
    client: MeteringClient,
    entity_id: str,
    tokens: int,
    entity_type: EntityType = "organization",
) -> None:
    """Emit a ``tokens_consumed`` usage event.

    Args:
        client: An active :class:`~fuzefront_metered_usage.client.MeteringClient`.
        entity_id: Organization or user id to bill.
        tokens: Number of tokens consumed.
        entity_type: ``'organization'`` (default) or ``'user'``.
    """
    client.emit(
        UsageEvent(
            meter_event_name="tokens_consumed",
            quantity=float(tokens),
            entity_type=entity_type,
            entity_id=entity_id,
            timestamp=datetime.now(timezone.utc).isoformat(),
        )
    )


def emit_storage_usage(
    client: MeteringClient,
    entity_id: str,
    bytes_: int,
    entity_type: EntityType = "organization",
) -> None:
    """Emit a ``storage_bytes`` usage event.

    Args:
        client: An active :class:`~fuzefront_metered_usage.client.MeteringClient`.
        entity_id: Organization or user id to bill.
        bytes_: Number of bytes to record.
        entity_type: ``'organization'`` (default) or ``'user'``.
    """
    client.emit(
        UsageEvent(
            meter_event_name="storage_bytes",
            quantity=float(bytes_),
            entity_type=entity_type,
            entity_id=entity_id,
            timestamp=datetime.now(timezone.utc).isoformat(),
        )
    )
