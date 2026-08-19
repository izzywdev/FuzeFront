# FQ-18 repository onboarding

Subtask traceability:

| Concern | Implementation | Verification |
|---|---|---|
| Backend contract | `repositoryInputSchema` captures GitHub installation, repository, branch, kind, scan globs, Jira bindings, and ownership | schema/type-check |
| GitHub access | `POST /api/v1/repositories/verify` and the create route verify installation read access and the configured branch before persistence | `repository-onboarding.test.ts` |
| Tenant authorization | repository administration asks FuzeFront Security for session identity and `fuzequality.repository` permission; the tenant comes only from the verified identity | fail-closed middleware and type-check |
| Persistence/idempotency | tenant-scoped upsert and unique index; repeat onboarding updates configuration without duplication | `store.onboarding.test.ts` |
| Security/error handling | no installation token is persisted or returned; GitHub errors are converted to stable redacted errors; production rejects local paths | `repository-onboarding.test.ts` |
| Product design/frontend | blocked by the repository design-first gate: no approved `design/frames/fuzequality-repository-onboarding` artifact exists | no React UI changes in this branch |

The UI should be implemented only after a product-design-only frames PR is approved. The existing prototype modal is not an approved source of truth and does not meet the complete FQ-18 input/state inventory.
