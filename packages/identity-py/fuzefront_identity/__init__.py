"""fuzefront-identity — server-owned entity identifiers for Python microservices.

Policy: ``governance/identifier-standard.md``. The service that owns an entity
mints its id; clients never supply one. Ids are opaque past the prefix.

The Python peer of ``@fuzefront/shared/identity``. Both implementations are
pinned by the same TypeID spec vectors and the same entity-prefix registry, so a
reference minted by either is accepted by the other.
"""

from .codec import (
    bytes_to_uuid,
    decode_suffix,
    encode_suffix,
    is_uuid,
    is_valid_suffix,
    uuid_to_bytes,
    uuidv7_bytes,
)
from .graph_create import (
    GraphCreateError,
    GraphCreateMiddleware,
    resolve_graph,
)
from .ids import (
    IdentityError,
    assert_ref,
    configure_identity,
    entity_type_of,
    from_uuid,
    is_id,
    mint_id,
    parse_id,
    to_uuid,
    try_parse_id,
)
from .registry import (
    ENTITY_PREFIXES,
    ENTITY_TYPES,
    is_entity_type,
    prefix_for,
    type_for_prefix,
)

__version__ = "1.0.0"

__all__ = [
    "ENTITY_PREFIXES",
    "ENTITY_TYPES",
    "GraphCreateError",
    "GraphCreateMiddleware",
    "IdentityError",
    "assert_ref",
    "bytes_to_uuid",
    "configure_identity",
    "decode_suffix",
    "encode_suffix",
    "entity_type_of",
    "from_uuid",
    "is_entity_type",
    "is_id",
    "is_uuid",
    "is_valid_suffix",
    "mint_id",
    "parse_id",
    "prefix_for",
    "resolve_graph",
    "to_uuid",
    "try_parse_id",
    "type_for_prefix",
    "uuid_to_bytes",
    "uuidv7_bytes",
]
