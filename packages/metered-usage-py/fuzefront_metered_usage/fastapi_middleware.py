"""FastAPI / Starlette ASGI middleware for automatic per-request metering.

Requires the ``fastapi`` extra::

    pip install "fuzefront-metered-usage[fastapi]"

Usage::

    from fuzefront_metered_usage import MeteringClient
    from fuzefront_metered_usage.fastapi_middleware import MeteringMiddleware

    client = MeteringClient.from_env(service_name="my-service")
    app.add_middleware(
        MeteringMiddleware,
        client=client,
        organization_id=lambda req: req.state.org_id,
    )
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import datetime, timezone

try:
    from starlette.middleware.base import BaseHTTPMiddleware
    from starlette.requests import Request
    from starlette.responses import Response
except ImportError as error:  # pragma: no cover
    raise ImportError(
        "fuzefront_metered_usage.fastapi_middleware requires the 'fastapi' extra: "
        'pip install "fuzefront-metered-usage[fastapi]"'
    ) from error

from .client import EntityType, MeteringClient, UsageEvent

logger = logging.getLogger(__name__)


class MeteringMiddleware(BaseHTTPMiddleware):
    """ASGI middleware that emits ``meter_event_name='api_calls'`` quantity=1
    after every request that is not explicitly skipped.

    The event is emitted AFTER the response is produced so the HTTP status
    code is available to the ``skip`` predicate.  The middleware never
    raises -- any error is logged and the response is returned unchanged.

    Args:
        app: The ASGI application to wrap.
        client: A :class:`~fuzefront_metered_usage.client.MeteringClient`
            instance.
        organization_id: Callable ``(Request) -> str | None`` that extracts
            the organization (or user) id from the request.  When it returns
            ``None`` or raises, the event is not emitted.
        entity_type: ``'organization'`` (default) or ``'user'``.
        meter: Meter event name (default ``'api_calls'``).
        skip: Optional callable ``(Request) -> bool``.  When it returns
            ``True`` the event is suppressed.  Also called on health-check
            paths, OPTIONS requests, etc.

    Example::

        app.add_middleware(
            MeteringMiddleware,
            client=client,
            organization_id=lambda req: req.state.org_id,
            skip=lambda req: req.url.path.startswith("/health"),
        )
    """

    def __init__(
        self,
        app,
        *,
        client: MeteringClient,
        organization_id: Callable,
        entity_type: EntityType = "organization",
        meter: str = "api_calls",
        skip: Callable | None = None,
    ) -> None:
        super().__init__(app)
        self._client = client
        self._organization_id = organization_id
        self._entity_type = entity_type
        self._meter = meter
        self._skip = skip

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        response = await call_next(request)

        try:
            if self._skip is not None and self._skip(request):
                return response

            try:
                entity_id = self._organization_id(request)
            except Exception:
                logger.warning(
                    "metered-usage: organization_id() raised for %s %s; event suppressed",
                    request.method,
                    request.url.path,
                    exc_info=True,
                )
                return response

            if not entity_id:
                return response

            self._client.emit(
                UsageEvent(
                    meter_event_name=self._meter,
                    quantity=1,
                    entity_type=self._entity_type,
                    entity_id=str(entity_id),
                    timestamp=datetime.now(timezone.utc).isoformat(),
                )
            )
        except Exception:
            logger.warning(
                "metered-usage: unexpected error in MeteringMiddleware; event suppressed",
                exc_info=True,
            )

        return response
