"""Entity type -> wire prefix registry.

MUST stay byte-for-byte in agreement with the TypeScript registry at
``shared/src/identity/registry.ts``. A prefix that differs between the two
implementations means a reference minted by a Node service is rejected by a
Python service (and vice versa) — a cross-language outage that no single-language
test can catch. ``scripts/gate_identifier.py --registry-parity`` compares the two
files on every CI run for exactly this reason.
"""

from __future__ import annotations

from types import MappingProxyType
from typing import Mapping, Optional

#: Wire prefixes, keyed by entity type. Prefix must match ``^[a-z][a-z_]{1,62}$``.
ENTITY_PREFIXES: Mapping[str, str] = MappingProxyType(
    {
        # platform
        "portal": "prt",
        "organization": "org",
        "user": "usr",
        "app": "app",
        # billing
        "customer": "cus",
        "subscription": "sub",
        "payment": "pay",
        "invoice": "inv",
        "credit": "crd",
        # identity — the remaining spine entities the FFRNT-185 rollout mints.
        # "ivt" not "inv": invoice already owns "inv", and a prefix collision
        # inside one registry would defeat the whole point of the prefix.
        "invitation": "ivt",
        "membership": "mbr",
        "session": "ses",
        "mfaFactor": "mfa",
        # messaging
        "conversation": "cnv",
        "message": "msg",
        "notification": "ntf",
        # selection-list-service — product-local types, namespaced front_ per the
        # namespace gate (gate_identifier.py --namespace). Prefixes are permanent once
        # shipped: changing one is a wire-breaking change for every stored reference.
        "selectionList": "front_sl",
        "selectionListItem": "front_sli",
        # config-service (FF-EPIC-17) — bare spine prefixes, not front_-namespaced:
        # config-service is FuzeFront-hosted for the whole family (same tier as
        # the billing/messaging sets above), and the frozen contract
        # (services/config-service/openapi.yaml, FFRNT-153) already declares
        # these as bare "cns_"/"ckd_". Mirrored in scripts/gate_identifier.py
        # SPINE_PREFIXES so --namespace accepts them.
        "namespace": "cns",
        "keyDefinition": "ckd",
        # "configHistory" — FF-EPIC-18 (FFRNT-280), the append-only change
        # trail ("GET /v1/config/history") and reveal-once secret audit
        # ("POST /v1/config/secrets/reveal") both write. Bare "cvh_", same
        # reasoning as "cns_"/"ckd_" above. MUST stay in parity with
        # packages/identity/src/registry.ts (registry-parity gate).
        "configHistory": "cvh",
    }
)

_TYPE_BY_PREFIX: Mapping[str, str] = MappingProxyType(
    {prefix: entity_type for entity_type, prefix in ENTITY_PREFIXES.items()}
)

ENTITY_TYPES = tuple(ENTITY_PREFIXES)


def prefix_for(entity_type: str) -> str:
    """The wire prefix owning ``entity_type``."""
    try:
        return ENTITY_PREFIXES[entity_type]
    except KeyError:
        raise KeyError(f"unregistered entity type {entity_type!r}") from None


def type_for_prefix(prefix: str) -> Optional[str]:
    """The entity type owning ``prefix``, or ``None`` when unregistered."""
    return _TYPE_BY_PREFIX.get(prefix)


def is_entity_type(value: str) -> bool:
    return value in ENTITY_PREFIXES
