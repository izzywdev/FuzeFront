"""Payload validators for the app / billing / identity / notify / portal / chat /
config event families — a Python mirror of the corresponding ``*SchemaV1`` Zod
schemas in shared/src/kafka/schemas. Field names are camelCase (wire contract).

Each ``validate_*`` returns the validated payload dict or raises
``SchemaValidationError``. Enum sets and nullability match the Zod source.
"""

from __future__ import annotations

from typing import Any

from ._validate import _V

ENTITY_TYPES = ("user", "organization")

# ── app.* ──────────────────────────────────────────────────────────────


def validate_app_registered(p: Any) -> dict:
    v = _V("app.registered", p)
    v.string("slug")
    v.string("name")
    v.enum("mode", ("portal", "standalone"))
    v.enum("integrationType", ("module-federation", "iframe", "web-component", "spa"))
    v.boolean("builtin")
    v.uuid("organizationId", required=False, nullable=True)
    v.datetime("registeredAt")
    return v.done()


def validate_app_activated(p: Any) -> dict:
    v = _V("app.activated", p)
    v.string("slug")
    v.uuid("organizationId", required=False, nullable=True)
    v.uuid("actorUserId", required=False)
    v.datetime("activatedAt")
    return v.done()


def validate_app_suspended(p: Any) -> dict:
    v = _V("app.suspended", p)
    v.string("slug")
    v.uuid("organizationId", required=False, nullable=True)
    v.uuid("actorUserId", required=False)
    v.datetime("suspendedAt")
    return v.done()


def validate_app_heartbeat(p: Any) -> dict:
    v = _V("app.heartbeat", p)
    v.string("slug")
    v.enum("status", ("online", "degraded"))
    v.record("metadata", required=False)
    v.datetime("seenAt")
    return v.done()


# ── billing.* ──────────────────────────────────────────────────────────


def validate_billing_llm_usage(p: Any) -> dict:
    v = _V("billing.llm.usage", p)
    v.uuid("userId")
    v.uuid("orgId")
    v.string("model")
    v.integer("promptTokens", ge=0)
    v.integer("completionTokens", ge=0)
    v.integer("totalTokens", ge=0)
    v.uuid("conversationId")
    v.datetime("timestamp")
    return v.done()


def validate_billing_usage_recorded(p: Any) -> dict:
    v = _V("billing.usage.recorded", p)
    v.uuid("entityId")
    v.enum("entityType", ENTITY_TYPES)
    v.string("meterEventName")
    v.integer("quantity", gt=0)
    v.datetime("occurredAt")
    return v.done()


def validate_billing_subscription_changed(p: Any) -> dict:
    v = _V("billing.subscription.changed", p)
    v.uuid("entityId")
    v.enum("entityType", ENTITY_TYPES)
    v.string("planTier")
    v.string("status")
    v.integer("seatQuantity", required=False)
    v.string("stripeSubscriptionId")
    return v.done()


def validate_billing_payment_completed(p: Any) -> dict:
    v = _V("billing.payment.completed", p)
    v.string("productKey", min_len=1)
    v.string("externalOrderId", min_len=1)
    v.enum("entityType", ENTITY_TYPES)
    v.uuid("entityId")
    v.string("stripeSessionId", min_len=1)
    v.string("stripePaymentIntentId", nullable=True)
    v.integer("amountTotalCents", ge=0)
    v.string("currency")
    v.enum("status", ("paid", "failed", "expired"))
    v.string("occurredAt")  # plain string, not .datetime() on the Node side
    return v.done()


# -- unregistered billing schemas (defined, not in SCHEMA_BY_TOPIC) --


def validate_billing_trial_ending(p: Any) -> dict:
    v = _V("billing.trial.ending", p)
    v.uuid("entityId")
    v.enum("entityType", ENTITY_TYPES)
    v.datetime("trialEnd")
    v.string("planTier")
    return v.done()


def validate_billing_payment_failed(p: Any) -> dict:
    v = _V("billing.payment.failed", p)
    v.uuid("entityId")
    v.enum("entityType", ENTITY_TYPES)
    v.string("invoiceId")
    v.integer("amountDue", ge=0)
    v.string("currency", min_len=3, max_len=3)
    return v.done()


def validate_billing_tenant_registered(p: Any) -> dict:
    v = _V("billing.tenant.registered", p)
    v.uuid("entityId")
    v.enum("entityType", ("organization",))
    v.string("stripeCustomerId")
    return v.done()


def validate_billing_payment_method_updated(p: Any) -> dict:
    v = _V("billing.payment_method.updated", p)
    v.uuid("entityId")
    v.enum("entityType", ENTITY_TYPES)
    v.string("stripeCustomerId")
    v.string("paymentMethodId")
    v.string("brand", required=False)
    v.string("last4", required=False)
    return v.done()


# ── identity.* ─────────────────────────────────────────────────────────

_ORG_TYPES = ("platform", "organization", "personal")
_CASCADE = ("soft", "hard")


def validate_identity_user_created(p: Any) -> dict:
    v = _V("identity.user.created", p)
    v.uuid("userId")
    v.email("email")
    v.string("firstName", required=False)
    v.string("lastName", required=False)
    v.enum("intent", ("signup", "org-invite"))
    return v.done()


def validate_identity_user_updated(p: Any) -> dict:
    v = _V("identity.user.updated", p)
    v.uuid("userId")
    v.email("email")
    v.string("firstName", required=False)
    v.string("lastName", required=False)
    v.uuid("homePortalId", required=False, nullable=True)
    return v.done()


def validate_identity_user_deleted(p: Any) -> dict:
    v = _V("identity.user.deleted", p)
    v.uuid("userId")
    v.email("email")
    v.enum("cascade", _CASCADE)
    return v.done()


def _org_snapshot(name: str, p: Any) -> dict:
    v = _V(name, p)
    v.uuid("organizationId")
    v.string("slug")
    v.string("name")
    v.enum("type", _ORG_TYPES)
    v.uuid("parentId", nullable=True)
    v.uuid("ownerId", nullable=True)
    v.boolean("isActive")
    return v.done()


def validate_identity_org_created(p: Any) -> dict:
    return _org_snapshot("identity.org.created", p)


def validate_identity_org_updated(p: Any) -> dict:
    return _org_snapshot("identity.org.updated", p)


def validate_identity_org_deleted(p: Any) -> dict:
    v = _V("identity.org.deleted", p)
    v.uuid("organizationId")
    v.string("slug")
    v.uuid("ownerId", nullable=True)
    v.enum("cascade", _CASCADE)
    return v.done()


def _membership_change(name: str, p: Any) -> dict:
    v = _V(name, p)
    v.uuid("organizationId")
    v.uuid("userId")
    v.string("role")
    return v.done()


def validate_identity_membership_added(p: Any) -> dict:
    return _membership_change("identity.membership.added", p)


def validate_identity_membership_removed(p: Any) -> dict:
    return _membership_change("identity.membership.removed", p)


_INVITE_ROLES = ("admin", "member", "viewer")
_INVITE_MEMBER_TYPES = ("employee", "customer")
_INVITE_CHANNELS = ("email", "whatsapp")


def validate_identity_invitation_created(p: Any) -> dict:
    v = _V("identity.invitation.created", p)
    v.uuid("organizationId")
    v.uuid("invitationId")
    v.uuid("invitedByUserId")
    v.enum("role", _INVITE_ROLES)
    v.enum("memberType", _INVITE_MEMBER_TYPES)
    v.enum("channel", _INVITE_CHANNELS)
    v.uuid("inviteeUserId", required=False)
    v.email("email", required=False)
    v.phone_e164("phone", required=False)
    v.datetime("expiresAt")
    out = v.done()
    # Refinements: email required for the email channel, phone for whatsapp.
    if out["channel"] == "email" and not out.get("email"):
        raise v.fail("email is required when channel is 'email'")
    if out["channel"] == "whatsapp" and not out.get("phone"):
        raise v.fail("phone is required when channel is 'whatsapp'")
    return out


def validate_identity_invitation_accepted(p: Any) -> dict:
    v = _V("identity.invitation.accepted", p)
    v.uuid("organizationId")
    v.uuid("invitationId")
    v.uuid("userId")
    v.enum("role", _INVITE_ROLES)
    v.enum("memberType", _INVITE_MEMBER_TYPES)
    return v.done()


def validate_identity_authorization_changed(p: Any) -> dict:
    v = _V("identity.authorization.changed", p)
    v.uuid("organizationId")
    v.uuid("subjectId")
    v.enum(
        "change",
        ("membership_added", "membership_removed", "membership_role_changed"),
    )
    v.string("role", required=False, min_len=1, max_len=64)
    return v.done()


# -- unregistered identity.session.* (defined, not in SCHEMA_BY_TOPIC) --


def validate_identity_session_issued(p: Any) -> dict:
    v = _V("identity.session.issued", p)
    v.uuid("userId")
    v.string("sessionId")
    v.uuid("tenantId", nullable=True)
    v.enum("authMode", ("legacy-hs256", "oidc-jwks"))
    v.url("issuer", required=False, nullable=True)  # Node: z.string().url().nullable().optional()
    v.integer("expiresAt", gt=0)  # epoch seconds
    v.datetime("issuedAt")
    return v.done()


def validate_identity_session_revoked(p: Any) -> dict:
    v = _V("identity.session.revoked", p)
    v.uuid("userId")
    v.string("sessionId")
    v.enum("reason", ("logout", "admin-revoke", "rotation", "expired"))
    v.datetime("revokedAt")
    return v.done()


# ── notify.* ───────────────────────────────────────────────────────────

SUPPORTED_EMAIL_TEMPLATES = (
    "welcome",
    "org-invite",
    "membership-change",
    "fuzepicker-mention",
    "fuzepicker-reply",
    "verify-email",
    "password-reset",
)


def validate_notify_email_requested(p: Any) -> dict:
    v = _V("notify.email.requested", p)
    v.email("to")
    v.enum("template", SUPPORTED_EMAIL_TEMPLATES)
    v.record("vars")
    v.string("orgId", required=False)
    v.string("correlationId")
    return v.done()


def validate_notify_email_status(p: Any) -> dict:
    v = _V("notify.email.status", p)
    v.string("correlationId")
    v.email("to")
    v.string("template")
    v.enum("status", ("sent", "failed", "dead-lettered"))
    v.string("error", required=False)
    v.string("providerMessageId", required=False)
    v.string("attemptedAt")  # ISO-8601 plain string on the Node side
    return v.done()


# ── portal.* ───────────────────────────────────────────────────────────


def validate_portal_created(p: Any) -> dict:
    v = _V("portal.created", p)
    v.string("portalId")
    v.string("slug")
    v.uuid("organizationId")
    v.email("ownerEmail")
    v.enum(
        "status",
        ("provisioning", "provisioned-pending-invite", "active", "suspended"),
    )
    return v.done()


# ── chat.* ─────────────────────────────────────────────────────────────


def validate_chat_response_chunk(p: Any) -> dict:
    v = _V("chat.response.chunk", p)
    v.string("userId", min_len=1)
    v.string("conversationId", min_len=1)
    v.string("messageId", min_len=1)
    v.integer("sequence", ge=0)
    v.enum("type", ("start", "delta", "done", "error"))
    v.string("delta", required=False)
    return v.done()


# ── config.changed ─────────────────────────────────────────────────────


def _config_scope(value: Any) -> dict:
    sv = _V("config.changed.scope", value)
    sv.enum("scopeType", ("platform", "portal", "org", "user"))
    sv.string("scopeId", nullable=True)
    return sv.done()


def validate_config_changed(p: Any) -> dict:
    v = _V("config.changed", p)
    v.string("namespace", min_len=1)
    v.nested("scope", _config_scope)
    v.string_array("changedKeys", min_len=1)
    # changedKeys elements must be non-empty strings.
    for k in v.out["changedKeys"]:
        if not isinstance(k, str) or len(k) < 1:
            raise v.fail("changedKeys elements must be non-empty strings")
    return v.done(strict=True)
