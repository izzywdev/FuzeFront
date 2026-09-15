"""
fuzefront-selection-list-client — Python client for the FuzeFront SelectionList service.

Zero runtime dependencies. Uses ``urllib.request`` (stdlib only).

Quick start::

    from fuzefront_selection_list_client import SelectionListClient

    client = SelectionListClient(
        base_url="http://fuzefront-selection-list-service:3011",
        token="<bearer-token>",
    )
    page = client.get_lists()
"""

from ._paginator import paginate
from .client import SelectionListClient, TokenProvider
from .errors import SelectionListApiError
from .types import (
    # Access
    AccessEntry,
    AutofillRequest,
    AutofillResult,
    CreateItemRequest,
    CreateListRequest,
    # Enums
    LifecycleStatus,
    # Pagination
    Page,
    PagedResponse,
    # Quota
    QuotaInfo,
    QuotaScope,
    ResolveResponse,
    # Resolve
    ResolveResult,
    # Selection lists
    SelectionList,
    SelectionListAccessRole,
    SelectionListErrorCode,
    # Items
    SelectionListItem,
    SelectionListItemTranslation,
    SelectionListQuotaStatus,
    StatusFilter,
    # Translations
    Translation,
    UpdateItemRequest,
    UpdateListRequest,
    UpsertItemTranslationRequest,
    UpsertListTranslationRequest,
)

__all__ = [
    "AccessEntry",
    "AutofillRequest",
    "AutofillResult",
    "CreateItemRequest",
    "CreateListRequest",
    # Enums
    "LifecycleStatus",
    # Types
    "Page",
    "PagedResponse",
    "QuotaInfo",
    "QuotaScope",
    "ResolveResponse",
    "ResolveResult",
    "SelectionList",
    "SelectionListAccessRole",
    # Errors
    "SelectionListApiError",
    # Client
    "SelectionListClient",
    "SelectionListErrorCode",
    "SelectionListItem",
    "SelectionListItemTranslation",
    "SelectionListQuotaStatus",
    "StatusFilter",
    "TokenProvider",
    "Translation",
    "UpdateItemRequest",
    "UpdateListRequest",
    "UpsertItemTranslationRequest",
    "UpsertListTranslationRequest",
    # Paginator
    "paginate",
]
