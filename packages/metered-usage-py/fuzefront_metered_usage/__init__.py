"""fuzefront-metered-usage -- metered usage Kafka producer for FuzeFront-family services.

Emits ``billing.usage`` events consumed by ``services/billing-service`` which
flushes them to Stripe Billing Meter Events.  Use :class:`MeteringClient`
directly for fine-grained control, or mount the framework middleware for
automatic per-request ``api_calls`` tracking.

Framework integrations are in optional extras:

- ``fastapi``: :mod:`fuzefront_metered_usage.fastapi_middleware`
- ``flask``: :mod:`fuzefront_metered_usage.flask_middleware`

Convenience helpers for common meter types:

- :func:`~fuzefront_metered_usage.helpers.emit_token_usage`
- :func:`~fuzefront_metered_usage.helpers.emit_storage_usage`
"""

from .client import EntityType, MeteringClient, UsageEvent

__all__ = [
    "EntityType",
    "MeteringClient",
    "UsageEvent",
]

__version__ = "1.0.0"
