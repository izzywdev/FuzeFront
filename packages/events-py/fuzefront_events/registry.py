"""Topic -> payload-validator registry — mirror of SCHEMA_BY_TOPIC in
shared/src/kafka/registry.ts.

Maps every topic that has a registered schema (42 of the 46 topics) to its
Python validator. The four unregistered billing topics (trial.ending,
payment.failed, tenant.registered, payment_method.updated) are deliberately
absent, matching the Node registry: they publish raw. ``schema_for_topic``
returns None for them, and the publisher then sends the payload unvalidated.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from types import MappingProxyType
from typing import Any

from . import schemas as s
from .topics import TOPICS

Validator = Callable[[Any], dict]

SCHEMA_BY_TOPIC: Mapping[str, Validator] = MappingProxyType(
    {
        TOPICS["APP_REGISTERED"]: s.validate_app_registered,
        TOPICS["APP_ACTIVATED"]: s.validate_app_activated,
        TOPICS["APP_SUSPENDED"]: s.validate_app_suspended,
        TOPICS["APP_HEARTBEAT"]: s.validate_app_heartbeat,
        TOPICS["BILLING_LLM_USAGE"]: s.validate_billing_llm_usage,
        TOPICS["BILLING_USAGE_RECORDED"]: s.validate_billing_usage_recorded,
        TOPICS["BILLING_SUBSCRIPTION_CHANGED"]: s.validate_billing_subscription_changed,
        TOPICS["BILLING_PAYMENT_COMPLETED"]: s.validate_billing_payment_completed,
        TOPICS["IDENTITY_USER_CREATED"]: s.validate_identity_user_created,
        TOPICS["IDENTITY_USER_UPDATED"]: s.validate_identity_user_updated,
        TOPICS["IDENTITY_USER_DELETED"]: s.validate_identity_user_deleted,
        TOPICS["IDENTITY_ORG_CREATED"]: s.validate_identity_org_created,
        TOPICS["IDENTITY_ORG_UPDATED"]: s.validate_identity_org_updated,
        TOPICS["IDENTITY_ORG_DELETED"]: s.validate_identity_org_deleted,
        TOPICS["IDENTITY_MEMBERSHIP_ADDED"]: s.validate_identity_membership_added,
        TOPICS["IDENTITY_MEMBERSHIP_REMOVED"]: s.validate_identity_membership_removed,
        TOPICS["IDENTITY_INVITATION_CREATED"]: s.validate_identity_invitation_created,
        TOPICS["IDENTITY_INVITATION_ACCEPTED"]: s.validate_identity_invitation_accepted,
        TOPICS["IDENTITY_AUTHORIZATION_CHANGED"]: s.validate_identity_authorization_changed,
        TOPICS["NOTIFY_EMAIL_REQUESTED"]: s.validate_notify_email_requested,
        TOPICS["NOTIFY_EMAIL_STATUS"]: s.validate_notify_email_status,
        TOPICS["PORTAL_CREATED"]: s.validate_portal_created,
        TOPICS["CHAT_RESPONSE_CHUNK"]: s.validate_chat_response_chunk,
        TOPICS["CONFIG_CHANGED"]: s.validate_config_changed,
        TOPICS["SELECTION_LISTS_LIST_CREATED"]: s.validate_list_created,
        TOPICS["SELECTION_LISTS_LIST_UPDATED"]: s.validate_list_updated,
        TOPICS["SELECTION_LISTS_LIST_ARCHIVED"]: s.validate_list_archived,
        TOPICS["SELECTION_LISTS_LIST_DELETED"]: s.validate_list_deleted,
        TOPICS["SELECTION_LISTS_LIST_FORKED"]: s.validate_list_forked,
        TOPICS["SELECTION_LISTS_VISIBILITY_CHANGED"]: s.validate_visibility_changed,
        TOPICS["SELECTION_LISTS_ITEM_CREATED"]: s.validate_item_created,
        TOPICS["SELECTION_LISTS_ITEM_UPDATED"]: s.validate_item_updated,
        TOPICS["SELECTION_LISTS_ITEM_ARCHIVED"]: s.validate_item_archived,
        TOPICS["SELECTION_LISTS_ITEM_DELETED"]: s.validate_item_deleted,
        TOPICS["SELECTION_LISTS_ITEM_REORDERED"]: s.validate_item_reordered,
        TOPICS["SELECTION_LISTS_TRANSLATION_UPSERTED"]: s.validate_translation_upserted,
        TOPICS["SELECTION_LISTS_TRANSLATION_DELETED"]: s.validate_translation_deleted,
        TOPICS["SELECTION_LISTS_ACCESS_GRANTED"]: s.validate_access_granted,
        TOPICS["SELECTION_LISTS_ACCESS_REVOKED"]: s.validate_access_revoked,
        TOPICS["SELECTION_LISTS_SEED_REQUESTED"]: s.validate_seed_requested,
        TOPICS["SELECTION_LISTS_SEED_COMPLETED"]: s.validate_seed_completed,
        TOPICS["SELECTION_LISTS_SEED_FAILED"]: s.validate_seed_failed,
    }
)


def schema_for_topic(topic: str) -> Validator | None:
    """Return the validator for ``topic``, or None if it publishes raw."""
    return SCHEMA_BY_TOPIC.get(topic)
