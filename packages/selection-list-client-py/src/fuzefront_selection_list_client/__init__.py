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

from .client import SelectionListClient, TokenProvider
from .errors import SelectionListApiError
from ._paginator import paginate
from .types import (
    # Pagination
    Page,
    PagedResponse,
    # Selection lists
    SelectionList,
    CreateListRequest,
    UpdateListRequest,
    # Items
    SelectionListItem,
    CreateItemRequest,
    UpdateItemRequest,
    # Translations
    Translation,
    SelectionListItemTranslation,
    UpsertListTranslationRequest,
    UpsertItemTranslationRequest,
    AutofillRequest,
    AutofillResult,
    # Access
    AccessEntry,
    # Quota
    QuotaInfo,
    SelectionListQuotaStatus,
    # Resolve
    ResolveResult,
    ResolveResponse,
    # Enums
    LifecycleStatus,
    StatusFilter,
    SelectionListAccessRole,
    QuotaScope,
    SelectionListErrorCode,
)

__all__ = [
    # Client
    "SelectionListClient",
    "TokenProvider",
    # Errors
    "SelectionListApiError",
    # Paginator
    "paginate",
    # Types
    "Page",
    "PagedResponse",
    "SelectionList",
    "CreateListRequest",
    "UpdateListRequest",
    "SelectionListItem",
    "CreateItemRequest",
    "UpdateItemRequest",
    "Translation",
    "SelectionListItemTranslation",
    "UpsertListTranslationRequest",
    "UpsertItemTranslationRequest",
    "AutofillRequest",
    "AutofillResult",
    "AccessEntry",
    "QuotaInfo",
    "SelectionListQuotaStatus",
    "ResolveResult",
    "ResolveResponse",
    # Enums
    "LifecycleStatus",
    "StatusFilter",
    "SelectionListAccessRole",
    "QuotaScope",
    "SelectionListErrorCode",
]
