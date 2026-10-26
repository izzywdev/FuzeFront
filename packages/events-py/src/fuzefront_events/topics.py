"""Kafka topic constants + helpers — a 1:1 mirror of shared/src/kafka/types.ts.

The ``TOPICS`` mapping, ``dlq_topic`` and ``partition_key_for_payload`` must stay
byte-identical in behaviour to the Node contract so that a Python producer and a
Node consumer (or vice versa) agree on topic names and partition keys. The
contract-parity test reads the live TypeScript source and fails on any drift.
"""

from __future__ import annotations

from types import MappingProxyType
from typing import Any, Mapping, Optional

# Mirror of the TS `TOPICS` object. Keys and values are identical to
# shared/src/kafka/types.ts (checked by tests/test_contract_parity.py).
TOPICS: Mapping[str, str] = MappingProxyType(
    {
        "APP_REGISTERED": "app.registered",
        "APP_ACTIVATED": "app.activated",
        "APP_SUSPENDED": "app.suspended",
        "APP_HEARTBEAT": "app.heartbeat",
        "BILLING_LLM_USAGE": "billing.llm.usage",
        "IDENTITY_USER_CREATED": "identity.user.created",
        "IDENTITY_USER_UPDATED": "identity.user.updated",
        "IDENTITY_USER_DELETED": "identity.user.deleted",
        "IDENTITY_ORG_CREATED": "identity.org.created",
        "IDENTITY_ORG_UPDATED": "identity.org.updated",
        "IDENTITY_ORG_DELETED": "identity.org.deleted",
        "IDENTITY_MEMBERSHIP_ADDED": "identity.membership.added",
        "IDENTITY_MEMBERSHIP_REMOVED": "identity.membership.removed",
        "IDENTITY_INVITATION_CREATED": "identity.invitation.created",
        "IDENTITY_INVITATION_ACCEPTED": "identity.invitation.accepted",
        "IDENTITY_AUTHORIZATION_CHANGED": "identity.authorization.changed",
        "NOTIFY_EMAIL_REQUESTED": "notify.email.requested",
        "NOTIFY_EMAIL_STATUS": "notify.email.status",
        "BILLING_USAGE_RECORDED": "billing.usage.recorded",
        "BILLING_SUBSCRIPTION_CHANGED": "billing.subscription.changed",
        "BILLING_PAYMENT_COMPLETED": "billing.payment.completed",
        "BILLING_TRIAL_ENDING": "billing.trial.ending",
        "BILLING_PAYMENT_FAILED": "billing.payment.failed",
        "BILLING_TENANT_REGISTERED": "billing.tenant.registered",
        "BILLING_PAYMENT_METHOD_UPDATED": "billing.payment_method.updated",
        "PORTAL_CREATED": "portal.created",
        "CHAT_RESPONSE_CHUNK": "chat.response.chunk",
        "CONFIG_CHANGED": "config.changed",
        "SELECTION_LISTS_LIST_CREATED": "selection-lists.list.created",
        "SELECTION_LISTS_LIST_UPDATED": "selection-lists.list.updated",
        "SELECTION_LISTS_LIST_ARCHIVED": "selection-lists.list.archived",
        "SELECTION_LISTS_LIST_DELETED": "selection-lists.list.deleted",
        "SELECTION_LISTS_LIST_FORKED": "selection-lists.list.forked",
        "SELECTION_LISTS_VISIBILITY_CHANGED": "selection-lists.visibility.changed",
        "SELECTION_LISTS_ITEM_CREATED": "selection-lists.item.created",
        "SELECTION_LISTS_ITEM_UPDATED": "selection-lists.item.updated",
        "SELECTION_LISTS_ITEM_ARCHIVED": "selection-lists.item.archived",
        "SELECTION_LISTS_ITEM_DELETED": "selection-lists.item.deleted",
        "SELECTION_LISTS_ITEM_REORDERED": "selection-lists.item.reordered",
        "SELECTION_LISTS_TRANSLATION_UPSERTED": "selection-lists.translation.upserted",
        "SELECTION_LISTS_TRANSLATION_DELETED": "selection-lists.translation.deleted",
        "SELECTION_LISTS_ACCESS_GRANTED": "selection-lists.access.granted",
        "SELECTION_LISTS_ACCESS_REVOKED": "selection-lists.access.revoked",
        "SELECTION_LISTS_SEED_REQUESTED": "selection-lists.seed.requested",
        "SELECTION_LISTS_SEED_COMPLETED": "selection-lists.seed.completed",
        "SELECTION_LISTS_SEED_FAILED": "selection-lists.seed.failed",
    }
)

# The set of topic string values, for O(1) membership checks.
TOPIC_VALUES = frozenset(TOPICS.values())


def dlq_topic(topic: str) -> str:
    """Return the dead-letter-queue topic name for ``topic`` (``<topic>.dlq``)."""
    return f"{topic}.dlq"


# Partition-key field fallback order. MUST match partitionKeyForPayload in
# shared/src/kafka/registry.ts so every language binding derives the key
# identically (all events for one entity stay ordered on one partition).
_PARTITION_KEY_FIELDS = ("organizationId", "userId", "portalId", "entityId", "appId")


def partition_key_for_payload(payload: Any) -> Optional[str]:
    """Derive the Kafka partition key from an event payload.

    Falls through organizationId -> userId -> portalId -> entityId -> appId,
    returning the first present, non-None value (coerced to str), else None
    (round-robin). Mirrors partitionKeyForPayload in registry.ts.
    """
    if not isinstance(payload, Mapping):
        return None
    for field in _PARTITION_KEY_FIELDS:
        value = payload.get(field)
        if value is not None:
            return str(value)
    return None
