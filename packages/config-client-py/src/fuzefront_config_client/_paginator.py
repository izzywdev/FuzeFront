"""
Cursor-paginator helper.

``paginate()`` walks every page of a cursor-paginated config-service
endpoint, yielding items one at a time, so no consumer hand-rolls the
cursor loop -- the platform pagination standard's guarantee (no gaps, no
duplicates under concurrent writes) only holds if the cursor is echoed back
verbatim and the walk stops correctly, both easy to get subtly wrong.

Usage::

    for ns in client.paginate(client.list_namespaces):
        print(ns.namespace)
"""

from __future__ import annotations

from typing import Callable, Generator, Optional, TypeVar

from .types import Paged

T = TypeVar("T")


def paginate(
    fetch_page: Callable[..., "Paged[T]"],
    *,
    cursor: Optional[str] = None,
    limit: Optional[int] = None,
    **kwargs: object,
) -> Generator[T, None, None]:
    """
    Walk every page of a cursor-paginated endpoint, yielding one item at a time.

    :param fetch_page: Callable accepting ``cursor``/``limit`` keyword
        arguments and returning a :class:`~fuzefront_config_client.types.Paged`.
    :param cursor: Starting cursor. ``None`` begins from the first page.
    :param limit: Page size forwarded to each call. ``None`` lets the
        server apply its default.
    :param kwargs: Extra keyword arguments forwarded verbatim on every call.
    """
    current_cursor: Optional[str] = cursor
    while True:
        call_kwargs: dict = dict(kwargs)
        if limit is not None:
            call_kwargs["limit"] = limit
        if current_cursor is not None:
            call_kwargs["cursor"] = current_cursor

        page = fetch_page(**call_kwargs)

        for item in page.items:
            yield item

        if not page.page_info.has_next_page or page.page_info.next_cursor is None:
            return

        current_cursor = page.page_info.next_cursor
