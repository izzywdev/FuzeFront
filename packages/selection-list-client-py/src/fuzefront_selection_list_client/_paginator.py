"""
Cursor-paginator helper.

The ``paginate()`` generator walks every page of any cursor-paginated endpoint,
yielding items one at a time. It exists so no consumer hand-rolls the cursor
loop.

Usage::

    for item in paginate(lambda cursor=None: client.get_items(list_id, cursor=cursor)):
        process(item)
"""

from __future__ import annotations

from typing import Callable, Generator, Optional, TypeVar

from .types import PagedResponse

T = TypeVar("T")


def paginate(
    fetch_page: Callable[..., PagedResponse[T]],
    *,
    limit: Optional[int] = None,
    cursor: Optional[str] = None,
    **kwargs: object,
) -> Generator[T, None, None]:
    """
    Walk every page of a cursor-paginated endpoint, yielding one item at a time.

    :param fetch_page:
        Callable that accepts ``cursor`` (optional str) and ``limit``
        (optional int) keyword arguments and returns a PagedResponse.
    :param limit:
        Page size forwarded to each ``fetch_page`` call. ``None`` lets the
        server apply its default (50).
    :param cursor:
        Starting cursor. ``None`` begins from the first page.
    :param kwargs:
        Additional keyword arguments forwarded verbatim to ``fetch_page`` on
        every call (e.g. ``status``, ``locale``).
    """
    current_cursor: Optional[str] = cursor
    while True:
        call_kwargs: dict = dict(kwargs)
        if limit is not None:
            call_kwargs["limit"] = limit
        if current_cursor is not None:
            call_kwargs["cursor"] = current_cursor

        page_response: PagedResponse[T] = fetch_page(**call_kwargs)

        for item in page_response.items:
            yield item

        if not page_response.page.has_more or page_response.page.next_cursor is None:
            return

        current_cursor = page_response.page.next_cursor
