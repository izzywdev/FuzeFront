"""Schema validation — a valid payload parses and a broken one is rejected, for a
representative topic in every domain (app / billing / identity / notify / portal
/ chat / config / selection-lists)."""

from __future__ import annotations

import copy

import pytest

from fuzefront_events import SchemaValidationError, schema_for_topic

U = "11111111-1111-1111-1111-111111111111"
U2 = "22222222-2222-2222-2222-222222222222"
TS = "2026-01-01T00:00:00Z"

# A valid payload per topic (one per domain + a few edge cases).
VALID = {
    "app.registered": {
        "slug": "picker", "name": "Picker", "mode": "portal",
        "integrationType": "module-federation", "builtin": False,
        "organizationId": None, "registeredAt": TS,
    },
    "app.heartbeat": {"slug": "picker", "status": "online", "seenAt": TS},
    "billing.llm.usage": {
        "userId": U, "orgId": U2, "model": "gpt", "promptTokens": 1,
        "completionTokens": 2, "totalTokens": 3, "conversationId": U, "timestamp": TS,
    },
    "billing.payment.completed": {
        "productKey": "p", "externalOrderId": "o", "entityType": "user",
        "entityId": U, "stripeSessionId": "s", "stripePaymentIntentId": None,
        "amountTotalCents": 100, "currency": "usd", "status": "paid", "occurredAt": TS,
    },
    "identity.user.created": {"userId": U, "email": "a@b.co", "intent": "signup"},
    "identity.org.created": {
        "organizationId": U, "slug": "acme", "name": "Acme", "type": "organization",
        "parentId": None, "ownerId": None, "isActive": True,
    },
    "identity.org.deleted": {"organizationId": U, "slug": "acme", "ownerId": None, "cascade": "soft"},
    "identity.membership.added": {"organizationId": U, "userId": U2, "role": "admin"},
    "identity.invitation.created": {
        "organizationId": U, "invitationId": U2, "invitedByUserId": U, "role": "member",
        "memberType": "employee", "channel": "email", "email": "x@y.co", "expiresAt": TS,
    },
    "identity.authorization.changed": {
        "organizationId": U, "subjectId": U2, "change": "membership_added", "role": "admin",
    },
    "notify.email.requested": {
        "to": "a@b.co", "template": "welcome", "vars": {}, "correlationId": "c1",
    },
    "portal.created": {
        "portalId": "prt_1", "slug": "s", "organizationId": U,
        "ownerEmail": "a@b.co", "status": "active",
    },
    "chat.response.chunk": {
        "userId": "u", "conversationId": "c", "messageId": "m", "sequence": 0, "type": "delta",
    },
    "config.changed": {
        "namespace": "theme", "scope": {"scopeType": "org", "scopeId": "o1"},
        "changedKeys": ["primaryColor"],
    },
}


def _sl_base():
    return {
        "eventId": U, "organizationId": "org_abc",
        "actor": {"type": "user", "userId": "usr_x"},
        "listId": "front_sl_1", "listKey": "countries", "listRevision": 1,
    }


def _sl_list_snapshot():
    return {
        "listId": "front_sl_1", "key": "countries", "sourceLocale": "en",
        "status": "active", "name": "Countries", "description": None, "seed": None,
        "createdAt": TS, "updatedAt": TS,
    }


VALID["selection-lists.list.created"] = {**_sl_base(), "list": _sl_list_snapshot()}
VALID["selection-lists.access.granted"] = {
    "eventId": U, "organizationId": "org_abc",
    "actor": {"type": "user", "userId": "usr_x"},
    "listId": "front_sl_1", "listKey": "countries", "userId": "usr_y",
    "role": "list-viewer", "previousRole": None,
}


@pytest.mark.parametrize("topic", sorted(VALID))
def test_valid_payload_parses(topic):
    validator = schema_for_topic(topic)
    assert validator is not None, f"{topic} should be registered"
    out = validator(VALID[topic])
    assert isinstance(out, dict)


def test_missing_required_field_rejected():
    bad = copy.deepcopy(VALID["identity.org.created"])
    del bad["slug"]
    with pytest.raises(SchemaValidationError):
        schema_for_topic("identity.org.created")(bad)


def test_bad_enum_rejected():
    bad = copy.deepcopy(VALID["identity.org.deleted"])
    bad["cascade"] = "nope"
    with pytest.raises(SchemaValidationError):
        schema_for_topic("identity.org.deleted")(bad)


def test_invitation_channel_refinement():
    # channel 'whatsapp' requires phone, not email.
    bad = copy.deepcopy(VALID["identity.invitation.created"])
    bad["channel"] = "whatsapp"
    with pytest.raises(SchemaValidationError):
        schema_for_topic("identity.invitation.created")(bad)


def test_config_changed_is_strict():
    bad = copy.deepcopy(VALID["config.changed"])
    bad["unexpected"] = 1
    with pytest.raises(SchemaValidationError):
        schema_for_topic("config.changed")(bad)


def test_list_archived_requires_archived_status():
    base = {**_sl_base(), "list": {**_sl_list_snapshot(), "status": "active"}}
    with pytest.raises(SchemaValidationError):
        schema_for_topic("selection-lists.list.archived")(base)
    base["list"]["status"] = "archived"
    assert schema_for_topic("selection-lists.list.archived")(base)


def test_unregistered_billing_topics_publish_raw():
    for t in (
        "billing.trial.ending", "billing.payment.failed",
        "billing.tenant.registered", "billing.payment_method.updated",
    ):
        assert schema_for_topic(t) is None
