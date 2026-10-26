"""Per-topic payload validators mirroring shared/src/kafka/schemas.

Re-exports every ``validate_*`` function from the domain modules. The topic ->
validator mapping lives in ``fuzefront_events.registry`` (mirror of
SCHEMA_BY_TOPIC); the four unregistered billing schemas and the two unregistered
identity.session schemas are defined here but are intentionally NOT in that
registry (they publish raw on the Node side too).
"""

from __future__ import annotations

from . import lifecycle, selection_lists
from .lifecycle import (
    validate_app_activated,
    validate_app_heartbeat,
    validate_app_registered,
    validate_app_suspended,
    validate_billing_llm_usage,
    validate_billing_payment_completed,
    validate_billing_payment_failed,
    validate_billing_payment_method_updated,
    validate_billing_subscription_changed,
    validate_billing_tenant_registered,
    validate_billing_trial_ending,
    validate_billing_usage_recorded,
    validate_chat_response_chunk,
    validate_config_changed,
    validate_identity_authorization_changed,
    validate_identity_invitation_accepted,
    validate_identity_invitation_created,
    validate_identity_membership_added,
    validate_identity_membership_removed,
    validate_identity_org_created,
    validate_identity_org_deleted,
    validate_identity_org_updated,
    validate_identity_session_issued,
    validate_identity_session_revoked,
    validate_identity_user_created,
    validate_identity_user_deleted,
    validate_identity_user_updated,
    validate_notify_email_requested,
    validate_notify_email_status,
    validate_portal_created,
)
from .selection_lists import (
    validate_access_granted,
    validate_access_revoked,
    validate_item_archived,
    validate_item_created,
    validate_item_deleted,
    validate_item_reordered,
    validate_item_updated,
    validate_list_archived,
    validate_list_created,
    validate_list_deleted,
    validate_list_forked,
    validate_list_updated,
    validate_seed_completed,
    validate_seed_failed,
    validate_seed_requested,
    validate_translation_deleted,
    validate_translation_upserted,
    validate_visibility_changed,
)

__all__ = [name for name in dir() if name.startswith("validate_")]
