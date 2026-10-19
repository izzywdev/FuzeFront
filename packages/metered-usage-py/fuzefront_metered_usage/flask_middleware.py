"""Flask ``after_request`` helper for automatic per-request metering.

Requires the ``flask`` extra::

    pip install "fuzefront-metered-usage[flask]"

Usage::

    from fuzefront_metered_usage import MeteringClient
    from fuzefront_metered_usage.flask_middleware import register_metering

    client = MeteringClient.from_env(service_name="my-service")

    def get_org_id(req):
        return getattr(req, "org_id", None)

    register_metering(app, client=client, organization_id=get_org_id)
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from collections.abc import Callable

try:
    from flask import Flask
    from flask import request as flask_request
except ImportError as error:  # pragma: no cover
    raise ImportError(
        "fuzefront_metered_usage.flask_middleware requires the 'flask' extra: "
        'pip install "fuzefront-metered-usage[flask]"'
    ) from error

from .client import EntityType, MeteringClient, UsageEvent

logger = logging.getLogger(__name__)


def register_metering(
    app: Flask,
    *,
    client: MeteringClient,
    organization_id: Callable,
    entity_type: EntityType = "organization",
    meter: str = "api_calls",
    skip: Callable | None = None,
) -> None:
    """Register an ``after_request`` hook that emits a usage event for every
    request not explicitly skipped.

    The hook never raises -- any error is logged and the response is returned
    unchanged.

    Args:
        app: The Flask application instance.
        client: A :class:`~fuzefront_metered_usage.client.MeteringClient`.
        organization_id: Callable ``(flask.Request) -> str | None`` that
            extracts the org/user id.  ``None`` return suppresses the event.
        entity_type: ``'organization'`` (default) or ``'user'``.
        meter: Meter event name (default ``'api_calls'``).
        skip: Optional callable ``(flask.Request) -> bool``.  ``True`` return
            suppresses the event.

    Example::

        register_metering(
            app,
            client=client,
            organization_id=lambda req: g.get("org_id"),
            skip=lambda req: req.path.startswith("/health"),
        )
    """

    @app.after_request
    def _emit_usage(response):
        try:
            req = flask_request._get_current_object()

            if skip is not None and skip(req):
                return response

            try:
                entity_id = organization_id(req)
            except Exception:
                logger.warning(
                    "metered-usage: organization_id() raised for %s %s; event suppressed",
                    req.method,
                    req.path,
                    exc_info=True,
                )
                return response

            if not entity_id:
                return response

            client.emit(
                UsageEvent(
                    meter_event_name=meter,
                    quantity=1,
                    entity_type=entity_type,
                    entity_id=str(entity_id),
                    timestamp=datetime.now(timezone.utc).isoformat(),
                )
            )
        except Exception:
            logger.warning(
                "metered-usage: unexpected error in Flask metering hook; event suppressed",
                exc_info=True,
            )
        return response
