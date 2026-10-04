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
from .seed import (
    SEED_COMPLETED_TOPIC,
    SEED_FAILED_TOPIC,
    SEED_LIMITS,
    SEED_REQUESTED_SCHEMA_VERSION,
    SEED_REQUESTED_TOPIC,
    SeedRequestValidationError,
    build_seed_request,
    build_seed_request_envelope,
    seed_request_kafka_key,
)
from .types import (
    DELETED_USER_SENTINEL,
    SYSTEM_PRINCIPAL_PREFIX,
    USER_ID_PREFIX,
    # Access
    AccessEntry,
    # Authorship
    AuthorPrincipalKind,
    AutofillRequest,
    AutofillResult,
    CreateItemRequest,
    CreateListRequest,
    ItemTranslationLocaleStatus,
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
    SeedProvenance,
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
    TranslationLocaleStatus,
    UpdateItemRequest,
    UpdateListRequest,
    UpsertItemTranslationRequest,
    UpsertListTranslationRequest,
    author_principal_kind,
    is_user_author,
)

__all__ = [
    "DELETED_USER_SENTINEL",
    # Seed requests (Kafka contract: selection-lists.seed.requested)
    "SEED_COMPLETED_TOPIC",
    "SEED_FAILED_TOPIC",
    "SEED_LIMITS",
    "SEED_REQUESTED_SCHEMA_VERSION",
    "SEED_REQUESTED_TOPIC",
    "SYSTEM_PRINCIPAL_PREFIX",
    "USER_ID_PREFIX",
    "AccessEntry",
    "AuthorPrincipalKind",
    "AutofillRequest",
    "AutofillResult",
    "CreateItemRequest",
    "CreateListRequest",
    "ItemTranslationLocaleStatus",
    # Enums
    "LifecycleStatus",
    # Types
    "Page",
    "PagedResponse",
    "QuotaInfo",
    "QuotaScope",
    "ResolveResponse",
    "ResolveResult",
    "SeedProvenance",
    "SeedRequestValidationError",
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
    "TranslationLocaleStatus",
    "UpdateItemRequest",
    "UpdateListRequest",
    "UpsertItemTranslationRequest",
    "UpsertListTranslationRequest",
    "author_principal_kind",
    "build_seed_request",
    "build_seed_request_envelope",
    "is_user_author",
    # Paginator
    "paginate",
    "seed_request_kafka_key",
]
