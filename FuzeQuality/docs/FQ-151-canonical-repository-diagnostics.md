# FQ-151 canonical repository diagnostics

The repository onboarding backend exposes two complementary views:

- `POST /api/v1/repositories/verify` verifies the GitHub App installation and
  configured branch, returns the immutable head SHA, and previews conventional
  OpenAPI/Swagger candidates from that commit's tree. `candidatePreviewComplete`
  is false when GitHub truncates or cannot supply the tree; the exact-revision
  scanner remains authoritative.
- `GET /api/v1/repositories/{id}/catalog-status` returns freshness, immutable
  source and catalog revisions, scanner/config versions, candidate inventory,
  normalized counts, diagnostics, and findings.

Candidate status is intentionally distinct from coverage:

| Status | Meaning |
|---|---|
| `discovered` | Statically referenced configuration was found but is not itself executed |
| `parsed` | The candidate was read without an error diagnostic |
| `partial` | Useful catalog entities were retained alongside an error diagnostic |
| `invalid` | The candidate produced no catalog entities and has an error diagnostic |

`freshness` is one of `never`, `queued`, `running`, `failed`, `partial`,
`stale`, or `fresh`. A partial or stale repository is never presented as a
zero-coverage repository.

The scanner persists both revisions:

- `sourceRevision`: the 40-character GitHub commit requested by the Kafka
  command;
- `catalogRevision`: a deterministic digest of scanned inventory content.

The migration `006_repository_scan_details.sql` stores the latest projection as
JSONB while PostgreSQL remains authoritative for operations, tests, findings,
and diagnostics.
