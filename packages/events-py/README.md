# fuzefront-events (Python)

Python mirror of FuzeFront's Kafka event contract — the same topics, payload
schemas and `FuzeEvent` envelope that `shared/src/kafka` defines for Node —
plus a transactional-outbox writer and relay for Python services, mirroring
`backend/core/src/events`.

This is the Python half of the family event contract referenced by
`shared/src/kafka/registry.ts` and `governance/event-envelope-policy.json`
(`parity.pythonMirror = packages/events-py/fuzefront_events`). Topic and schema
coverage is kept in lockstep with the TypeScript source by
`tests/test_contract_parity.py`, which reads the live `.ts` files and fails on
drift.

## Install

Distributed as a GitHub Release asset (private; not on PyPI), like the other
`@fuzefront` Python packages:

```
pip install https://github.com/izzywdev/FuzeFront/releases/download/events-py-v1.0.0/fuzefront_events-1.0.0-py3-none-any.whl
```

Optional extras for the concrete adapters:

- `fuzefront-events[postgres]` — the `psycopg`-backed outbox DB adapter.
- `fuzefront-events[kafka]` — the `confluent-kafka`-backed producer adapter.

The core (topics, schemas, envelope, and the outbox/relay **logic**) is
stdlib-only; Postgres and Kafka are injected, so the drain/enqueue logic is
unit-testable with in-memory fakes and no running broker or database.

## Usage

```python
from fuzefront_events import (
    TOPICS, build_envelope, schema_for_topic, enqueue_event,
    drain_outbox_once, make_outbox_publisher,
)

# Validate + publish via the outbox (inside your DB transaction):
enqueue_event(db, TOPICS["IDENTITY_ORG_CREATED"], payload, correlation_id)

# A relay drains pending rows to Kafka:
result = drain_outbox_once(db, publish=publisher.publish,
                           on_dead_letter=publisher.dead_letter)
```

See `shared/src/kafka` (contract) and `backend/core/src/events` (outbox/relay)
for the authoritative Node implementations this mirrors.
