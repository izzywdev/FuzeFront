"""Schema validation — a valid payload parses and a broken one is rejected, for a
representative topic in every domain (app / billing / identity / notify / portal
/ chat / config / selection-lists)."""

from __future__ import annotations

import copy

import pytest

# Submodule imports: the payload-schema mirror is stdlib-only, so its tests
# stay runnable without the async runtime's deps (aiokafka/sqlalchemy/…).
from fuzefront_events.errors import SchemaValidationError
from fuzefront_events.registry import schema_for_topic

U = "11111111-1111-1111-1111-111111111111"
U2 = "22222222-2222-2222-2222-222222222222"
TS = "2026-01-01T00:00:00Z"

# A valid payload per topic (one per domain + a few edge cases).
VALID = {
    "app.registered": {
        "slug": "picker",
        "name": "Picker",
        "mode": "portal",
        "integrationType": "module-federation",
        "builtin": False,
        "organizationId": None,
        "registeredAt": TS,
    },
    "app.heartbeat": {"slug": "picker", "status": "online", "seenAt": TS},
    "billing.llm.usage": {
        "userId": U,
        "orgId": U2,
        "model": "gpt",
        "promptTokens": 1,
        "completionTokens": 2,
        "totalTokens": 3,
        "conversationId": U,
        "timestamp": TS,
    },
    "billing.payment.completed": {
        "productKey": "p",
        "externalOrderId": "o",
        "entityType": "user",
        "entityId": U,
        "stripeSessionId": "s",
        "stripePaymentIntentId": None,
        "amountTotalCents": 100,
        "currency": "usd",
        "status": "paid",
        "occurredAt": TS,
    },
    "identity.user.created": {"userId": U, "email": "a@b.co", "intent": "signup"},
    "identity.org.created": {
        "organizationId": U,
        "slug": "acme",
        "name": "Acme",
        "type": "organization",
        "parentId": None,
        "ownerId": None,
        "isActive": True,
    },
    "identity.org.deleted": {"organizationId": U, "slug": "acme", "ownerId": None, "cascade": "soft"},
    "identity.membership.added": {"organizationId": U, "userId": U2, "role": "admin"},
    "identity.invitation.created": {
        "organizationId": U,
        "invitationId": U2,
        "invitedByUserId": U,
        "role": "member",
        "memberType": "employee",
        "channel": "email",
        "email": "x@y.co",
        "expiresAt": TS,
    },
    "identity.authorization.changed": {
        "organizationId": U,
        "subjectId": U2,
        "change": "membership_added",
        "role": "admin",
    },
    "notify.email.requested": {
        "to": "a@b.co",
        "template": "welcome",
        "vars": {},
        "correlationId": "c1",
    },
    "portal.created": {
        "portalId": "prt_1",
        "slug": "s",
        "organizationId": U,
        "ownerEmail": "a@b.co",
        "status": "active",
    },
    "chat.response.chunk": {
        "userId": "u",
        "conversationId": "c",
        "messageId": "m",
        "sequence": 0,
        "type": "delta",
    },
    "config.changed": {
        "namespace": "theme",
        "scope": {"scopeType": "org", "scopeId": "o1"},
        "changedKeys": ["primaryColor"],
    },
}


def _sl_base():
    return {
        "eventId": U,
        "organizationId": "org_abc",
        "actor": {"type": "user", "userId": "usr_x"},
        "listId": "front_sl_1",
        "listKey": "countries",
        "listRevision": 1,
    }


def _sl_list_snapshot():
    return {
        "listId": "front_sl_1",
        "key": "countries",
        "sourceLocale": "en",
        "status": "active",
        "name": "Countries",
        "description": None,
        "seed": None,
        "createdAt": TS,
        "updatedAt": TS,
    }


VALID["selection-lists.list.created"] = {**_sl_base(), "list": _sl_list_snapshot()}
VALID["selection-lists.access.granted"] = {
    "eventId": U,
    "organizationId": "org_abc",
    "actor": {"type": "user", "userId": "usr_x"},
    "listId": "front_sl_1",
    "listKey": "countries",
    "userId": "usr_y",
    "role": "list-viewer",
    "previousRole": None,
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
        "billing.trial.ending",
        "billing.payment.failed",
        "billing.tenant.registered",
        "billing.payment_method.updated",
    ):
        assert schema_for_topic(t) is None


def test_datetime_requires_utc_z():
    # Mirrors Zod z.string().datetime() default: a trailing 'Z' is required; a
    # tz-less value or a numeric offset is rejected (the payload schemas don't
    # use { offset: true }).
    ok = copy.deepcopy(VALID["app.heartbeat"])
    ok["seenAt"] = "2026-01-01T00:00:00.500Z"
    assert schema_for_topic("app.heartbeat")(ok)
    for bad_ts in ("2026-01-01T00:00:00", "2026-01-01T00:00:00+02:00"):
        bad = copy.deepcopy(VALID["app.heartbeat"])
        bad["seenAt"] = bad_ts
        with pytest.raises(SchemaValidationError):
            schema_for_topic("app.heartbeat")(bad)


# -- seed.* edge cases (findings: platform source, seed-list shape) ----------

_SEED_OUTCOME_PLATFORM = {
    "eventId": U,
    "requestId": None,
    "organizationId": "org_abc",
    "scope": "org",
    "source": {"app": "platform", "service": "selection-list-service"},
    "pack": {"key": "countries", "version": 1},
    "trigger": "org-created",
}


def test_seed_outcome_allows_platform_source():
    # Platform-default seeding emits outcome events with source.app='platform';
    # the Node slSeedOutcomeBaseV1 permits it, so the mirror must too.
    completed = {**_SEED_OUTCOME_PLATFORM, "outcome": "applied", "appliedVersion": 1, "lists": []}
    assert schema_for_topic("selection-lists.seed.completed")(completed)
    failed = {
        **_SEED_OUTCOME_PLATFORM,
        "reason": "INTERNAL_ERROR",
        "message": "boom",
        "retryable": True,
        "details": [],
    }
    assert schema_for_topic("selection-lists.seed.failed")(failed)


def _seed_requested(**over):
    base = {
        "requestId": "app:org_abc:countries:v1",
        "organizationId": "org_abc",
        "scope": "org",
        "source": {"app": "weather", "service": "weather-svc"},
        "pack": {"key": "countries", "version": 1},
        "trigger": "org-created",
        "attestation": {"kind": "service-token", "token": "tok"},
        "lists": [{"key": "countries", "sourceLocale": "en", "name": "Countries", "items": []}],
    }
    base.update(over)
    return base


def test_seed_requested_forbids_platform_source():
    bad = _seed_requested(source={"app": "platform", "service": "svc"})
    with pytest.raises(SchemaValidationError):
        schema_for_topic("selection-lists.seed.requested")(bad)


def test_seed_requested_valid_shape_parses():
    assert schema_for_topic("selection-lists.seed.requested")(_seed_requested())


def test_seed_requested_rejects_malformed_list_entries():
    for lists in ([None], [{}], [{"key": "countries", "sourceLocale": "en", "name": "C"}]):
        with pytest.raises(SchemaValidationError):
            schema_for_topic("selection-lists.seed.requested")(_seed_requested(lists=lists))


def test_seed_requested_org_scope_forbids_user_id():
    with pytest.raises(SchemaValidationError):
        schema_for_topic("selection-lists.seed.requested")(_seed_requested(userId="usr_x"))


def test_seed_requested_preserves_translations():
    # Valid list/item translations must survive validation (not be silently
    # dropped from the returned payload), mirroring slSeedListSpecV1/
    # slSeedItemSpecV1 which retain them.
    lists = [
        {
            "key": "countries",
            "sourceLocale": "en",
            "name": "Countries",
            "translations": [{"locale": "fr", "name": "Pays", "description": "La liste"}],
            "items": [
                {
                    "code": "US",
                    "label": "United States",
                    "translations": [{"locale": "fr", "label": "États-Unis"}],
                }
            ],
        }
    ]
    out = schema_for_topic("selection-lists.seed.requested")(_seed_requested(lists=lists))
    got = out["lists"][0]
    assert got["translations"] == [{"locale": "fr", "name": "Pays", "description": "La liste"}]
    assert got["items"][0]["translations"] == [{"locale": "fr", "label": "États-Unis"}]


def test_discriminator_non_string_type_rejected():
    # A non-string discriminator (actor.type == []) must raise
    # SchemaValidationError, not a bare TypeError from the `in` lookup.
    bad = {**_sl_base(), "actor": {"type": []}}
    with pytest.raises(SchemaValidationError):
        schema_for_topic("selection-lists.list.deleted")(bad)


def _fork_payload():
    return {
        "eventId": U,
        "organizationId": "org_fork",
        "actor": {"type": "user", "userId": "usr_x"},
        "listId": "front_sl_fork",
        "listKey": "countries",
        "listRevision": 1,
        "list": {
            "listId": "front_sl_fork",
            "key": "countries",
            "sourceLocale": "en",
            "status": "active",
            "name": "Countries",
            "description": None,
            "seed": None,
            "createdAt": TS,
            "updatedAt": TS,
        },
        "source": {
            "listId": "front_sl_src",
            "organizationId": "org_src",
            "listKey": "countries",
            "listRevision": 2,
        },
        "itemMap": [],
    }


def test_fork_valid_parses():
    assert schema_for_topic("selection-lists.list.forked")(_fork_payload())


def test_fork_rejects_platform_visibility():
    # Mirrors selectionListsListForkedSchemaV1: a fork is never a platform list.
    bad = _fork_payload()
    bad["list"]["visibility"] = "platform"
    with pytest.raises(SchemaValidationError):
        schema_for_topic("selection-lists.list.forked")(bad)


def test_seed_requested_rejects_bad_translation_locale():
    bad = _seed_requested(
        lists=[
            {
                "key": "countries",
                "sourceLocale": "en",
                "name": "Countries",
                "translations": [{"locale": "xx", "name": "Nope"}],
                "items": [],
            }
        ]
    )
    with pytest.raises(SchemaValidationError):
        schema_for_topic("selection-lists.seed.requested")(bad)
