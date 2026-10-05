from fuzefront_events import OUTBOX_V2_SQL, PROCESSED_EVENTS_SQL, event_outbox, processed_events

# Column names per contracts/events/tables.md
OUTBOX_COLS = {
    "id",
    "event_id",
    "topic",
    "payload",
    "aggregate_type",
    "aggregate_id",
    "aggregate_version",
    "producer",
    "correlation_id",
    "causation_id",
    "schema_version",
    "status",
    "attempts",
    "last_error",
    "created_at",
    "sent_at",
}


def test_outbox_columns_match_contract():
    assert {c.name for c in event_outbox.columns} == OUTBOX_COLS
    nullable = {c.name for c in event_outbox.columns if c.nullable}
    assert nullable == {"causation_id", "last_error", "sent_at"}
    for col in OUTBOX_COLS:
        assert col in OUTBOX_V2_SQL


def test_processed_events_pk_and_sql():
    assert [c.name for c in processed_events.primary_key.columns] == ["consumer", "event_id"]
    assert "PRIMARY KEY (consumer, event_id)" in PROCESSED_EVENTS_SQL


def test_outbox_constraints_present():
    names = {c.name for c in event_outbox.constraints}
    assert {
        "uq_event_outbox_event_id",
        "uq_event_outbox_aggregate_version",
        "ck_event_outbox_aggregate_version_pos",
    } <= names
    assert "WHERE status = 'pending'" in OUTBOX_V2_SQL
