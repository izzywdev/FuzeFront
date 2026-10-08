# Event contract changelog

## 1.3.0 (`@fuzefront/shared` 1.3.0) — Envelope v2 (additive)

- Added `EnvelopeV2Schema`, `EnvelopeV1Schema`, `parseEnvelope()`, `envelopePartitionKey()` and the
  pattern constants to `@fuzefront/shared/kafka` (`shared/src/kafka/envelope.ts`, re-exported from
  `types.ts`). v1 `FuzeEvent<T>` is unchanged; **no producer's output changes** (Wave C).
- Added `contracts/events/envelope.v2.schema.json` (JSON Schema 2020-12) and
  `contracts/events/tables.md` (`event_outbox` v2, `processed_events`, `aggregate_version`).
- Added `packages/conformance-vectors` (envelope valid/invalid, dedupe, version-guard).
- Registered TypeID prefix `evt` (`event`) in `packages/identity` and `packages/identity-py` and in
  `scripts/gate_identifier.py` `SPINE_PREFIXES`. No collision with any existing prefix.
