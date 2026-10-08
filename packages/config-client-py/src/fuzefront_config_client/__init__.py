"""
fuzefront-config-client -- Python client for the FuzeFront config-service.

Namespaced, hierarchical key/value configuration with typed key metadata and
provenance-carrying resolution. Zero runtime dependencies -- uses
``urllib.request`` (stdlib only).

Hand-authored from ``services/config-service/openapi.yaml`` v1.0.0 -- the
frozen contract. That spec is the single source of truth; the Node client
``@fuzefront/config-client`` (FFRNT-153) and this package (FFRNT-259) are
both projections of it. If the two disagree, the spec wins and one of them
is the bug.

Quick start::

    from fuzefront_config_client import ConfigClient, Scope, ScopeType, is_not_modified

    client = ConfigClient(
        base_url="http://fuzefront-config-service:3011",
        token="<bearer-token>",
    )
    resolved = client.get_effective_config(
        "fuzefront.chat", Scope(scope_type=ScopeType.ORG, scope_id=org_id)
    )
    if not is_not_modified(resolved):
        for entry in resolved.entries:
            print(entry.key, entry.value, entry.source, entry.locked)
"""

from ._paginator import paginate
from .client import (
    NOT_MODIFIED,
    ConditionalEffectiveConfig,
    ConfigClient,
    NotModified,
    TokenProvider,
    is_not_modified,
)
from .errors import ConfigApiError, is_config_api_error
from .types import (
    KEY_DEFINITION_ID_PREFIX,
    NAMESPACE_ID_PREFIX,
    SCOPE_CHAIN,
    ConfigErrorBody,
    ConfigErrorCode,
    ConfigErrorDetail,
    ConfigOperation,
    ConfigOperationType,
    ConfigWriteRequest,
    ConfigWriteResult,
    EffectiveConfig,
    EffectiveConfigEntry,
    KeyDefinition,
    KeyDefinitionInput,
    KeyDefinitionManifest,
    KeyDefinitionManifestResult,
    Namespace,
    NamespaceCreate,
    Paged,
    PageInfo,
    Precedence,
    Scope,
    ScopeType,
    ValueType,
)

__version__ = "1.0.0"

__all__ = [
    "KEY_DEFINITION_ID_PREFIX",
    # Identifier constants
    "NAMESPACE_ID_PREFIX",
    "NOT_MODIFIED",
    "SCOPE_CHAIN",
    "ConditionalEffectiveConfig",
    # Errors
    "ConfigApiError",
    # Client
    "ConfigClient",
    "ConfigErrorBody",
    "ConfigErrorCode",
    "ConfigErrorDetail",
    "ConfigOperation",
    "ConfigOperationType",
    "ConfigWriteRequest",
    "ConfigWriteResult",
    "EffectiveConfig",
    "EffectiveConfigEntry",
    "KeyDefinition",
    "KeyDefinitionInput",
    "KeyDefinitionManifest",
    "KeyDefinitionManifestResult",
    "Namespace",
    "NamespaceCreate",
    "NotModified",
    "PageInfo",
    "Paged",
    "Precedence",
    # Types
    "Scope",
    # Enums
    "ScopeType",
    "TokenProvider",
    "ValueType",
    "is_config_api_error",
    "is_not_modified",
    # Paginator
    "paginate",
]
