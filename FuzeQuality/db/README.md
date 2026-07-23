# FuzeQuality PostgreSQL model

PostgreSQL is the authoritative store for FuzeQuality catalog, mapping, review, and coverage state. ChromaDB is a replaceable retrieval index and Kafka is transport; neither owns authoritative decisions.

## Migration contract

- Migrations are ordered, forward-only, transactional, and safe to re-run.
- The deployment runner uses the dedicated FuzeQuality service role and database supplied through a Sealed Secret. Runtime services never receive database-superuser credentials.
- Production migrations run in an Argo CD PreSync Job, not during application startup. The Helm wiring belongs to the deployment task.
- Entity primary keys are UUIDs. Stable source identities and unique constraints make rescans and redelivered events idempotent.
- `organization_id` is the FuzeFront tenant boundary. It is a UUID copied from the platform security context; it cannot have a cross-database foreign key.
- Internal graph relationships use foreign keys. JSONB is reserved for source-specific documents, bounded evidence, and immutable snapshot payloads.
- Repository removal sets `repositories.enabled = false`; it does not erase revisions, reviews, or snapshots.

## Evidence and authority

The model separates four concepts that must not be collapsed:

1. `test_targets` records how static analysis associates a test with one catalog target.
2. `test_expectations` records policy-derived or reviewed expected behavior.
3. `coverage_evidence` connects an expectation to an assertion-bearing test and records whether the evidence is accepted.
4. `coverage_snapshots` stores immutable totals with the exact revision set and policy version.

Semantic suggestions remain in `suggestions` until a FuzeFront-authenticated principal records a `review_decision`. Unreviewed suggestions therefore cannot become authoritative coverage.

## Traceability and safety

Repository scans, AI analyses, review decisions, findings, snapshots, and outbox events carry correlation or revision metadata. Diagnostics stored by workers must already be redacted; this schema deliberately has no credential, access-token, or clone-URL secret columns. Canonical repository URLs containing embedded credentials fail their database check.

Suppressed findings require an owner, reason, and expiry. Review decisions are append-only. Consumers deduplicate both by event identity and by Kafka position.

## Local contract test

Run the dependency-free structural checks from the repository root:

```bash
node --test FuzeQuality/db/tests/001_initial.contract.test.mjs
```

An integration test against PostgreSQL will be added with the migration runner task; it must apply this migration twice and compare the resulting catalog objects.
