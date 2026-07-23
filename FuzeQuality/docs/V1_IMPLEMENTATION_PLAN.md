# FuzeQuality V1 implementation plan

**Status:** Approved and in delivery  
**Product project:** Jira `FQ` (FuzeQuality)  
**Deployment:** Contabo production k3s through Helm and Argo CD  
**Public entry point:** `https://quality.prod.fuzefront.com`

## Outcome

V1 is a catalog-first quality intelligence product for selected `Fuze*`
repositories. It answers:

1. Which API operations and frontend surfaces exist?
2. Which deterministic test scenarios should exist for each subject?
3. Which assertion-bearing tests provide evidence, and which expectations are
   gaps?
4. Which Jira requirements and user flows map to those implementation and test
   subjects?
5. Which flows, requirements, implementations, and tests are orphaned, stale,
   incomplete, or ambiguous?

V1 deliberately separates explicit coverage from likely semantic matches.
Unreviewed AI output never changes authoritative coverage.

## V1 scope and deferrals

Included:

- read-only GitHub App repository onboarding;
- exact-commit default-branch checkout and deterministic scanning;
- OpenAPI 2.0, 3.0, and 3.1 cataloging;
- deterministic API expected-test matrices;
- React/TypeScript package, route, component, and state inventory;
- Jest, Vitest, Playwright, Pytest, Supertest, Schemathesis, and conventional
  test discovery;
- evidence mapping by explicit annotation, operation ID, method/route, source
  relationship, and reviewed semantics;
- read-only Jira epic/story ingestion and acceptance-criteria extraction;
- LiteLLM-assisted flow extraction and ChromaDB candidate retrieval;
- human review, versioned decisions, findings, and immutable coverage snapshots;
- portfolio, repository, API, frontend, requirement/flow, review, finding, and
  operations views.

Deferred to V1.1:

- Kiwi TCMS synchronization;
- ReportPortal execution history and failure analytics;
- Storybook hosting (missing stories are V1 findings);
- CI enforcement and release gates;
- automatic Jira mutation;
- an in-cluster model runtime.

## Runtime architecture

| Workload | Responsibility |
|---|---|
| `fuzequality-frontend` | React/Vite static application; API-only data access |
| `fuzequality-backend` | REST API, webhooks, repository administration, review decisions, catalog queries, outbox |
| `fuzequality-scanner` | Exact-commit checkout and deterministic repository inventory |
| `fuzequality-intelligence` | Jira ingestion, retrieval, structured AI suggestions, missing-flow analysis |
| `fuzequality-projector` | Coverage, findings, and immutable snapshot projection |
| `fuzequality-migrations` | Argo PreSync forward-only PostgreSQL migrations |
| `fuzequality-reconciler` | Periodic GitHub/Jira refresh and stale-work recovery |

Existing platform services are reused: PostgreSQL, Kafka, ChromaDB, LiteLLM,
FuzeFront security services, ingress, Prometheus, Grafana, Argo CD, and Sealed
Secrets. FuzeQuality does not deploy a second Authentik or authorization stack.
Human and machine authentication and product authorization go through
FuzeFront's existing security microservices.

```text
GitHub App / Jira
        |
        v
fuzequality-backend -> PostgreSQL + transactional outbox
        |
        v
Kafka commands
        |----> scanner ------> normalized repository inventory
        |----> intelligence -> proposed flows/mappings/tests
        `----> projector ----> coverage/findings/snapshots
                                      |
                                      v
                              fuzequality-frontend
```

## Repository and API plan

### Onboarding

The repository wizard records owner/name, GitHub App installation, default
branch, repository kind, include/exclude globs, ownership, and optional Jira
bindings. Canonical URLs are credential-free. The GitHub App has read-only
Metadata, Contents, and Pull Request permissions.

Default-branch pushes request idempotent scans keyed by repository, exact commit
SHA, scanner version, and configuration version. Installation tokens are
short-lived; checkouts live only in worker temporary storage.

### OpenAPI inventory

The scanner discovers conventional OpenAPI/Swagger YAML, JSON, and static
JavaScript/TypeScript configuration references without executing repository
code. Repository-bounded `$ref` resolution prevents traversal.

Stable operation identity:

```text
api:<repository>:<document-id>:<operationId>
```

Fallback:

```text
api:<repository>:<document-id>:<METHOD>:<normalized-path>
```

Invalid schemas, unresolved references, duplicate/missing operation IDs, and
undocumented error responses become findings.

### Expected API tests

Deterministic rules produce required or recommended expectations for:

- happy path and declared success/error responses;
- missing authentication and role/scope variants;
- missing required path, query, header, and body fields;
- schema minimum, maximum, length, pattern, enum, and format boundaries;
- invalid content types and response schema/media assertions;
- identifier-not-found behavior;
- idempotency replay;
- stateful CRUD lifecycles where the contract supports them.

AI may propose domain cases, but only a reviewer can approve them.

## Frontend plan

Workspace and package manifests establish frontend roots. Static analysis
catalogs package exports, public React components, routes, nested/lazy pages,
hooks, API clients, conditional states, Storybook stories, and test evidence.

The three coverage subjects are:

1. application routes;
2. page/feature surfaces;
3. exported reusable components.

The matrix is:

```text
Surface -> expected state/interaction -> unit -> story -> E2E -> status
```

Evidence types remain distinct. A Storybook story documents a state but does
not prove behavior; an E2E journey does not prove isolated loading/error states.

## Test evidence and coverage states

Mapping precedence:

1. explicit FuzeQuality annotation;
2. exact OpenAPI `operationId`;
3. exact HTTP method and normalized route;
4. static import/render/navigation relationship and test title;
5. semantic suggestion requiring review.

Coverage states:

| State | Meaning |
|---|---|
| `covered-explicit` | deterministic assertion-bearing evidence |
| `covered-generated` | generated schema-driven evidence |
| `likely-covered` | unreviewed semantic suggestion; excluded from hard totals |
| `gap` | required expectation lacks accepted evidence |
| `excluded` | reviewed, owned, reasoned, expiring exclusion |
| `unknown` | parsing or ambiguity prevents a conclusion |

V1 reports planned static coverage, not historical pass/fail health.

## Jira and AI plan

Jira access is read-only and bounded by JQL. Incremental synchronization uses
updated cursors and optional webhooks. Jira ADF is normalized into safe
structured text.

For each changed epic/story:

1. deterministically extract hierarchy, acceptance criteria, labels, links, and
   explicit API/route/test identifiers;
2. index normalized chunks in the dedicated Chroma collection;
3. retrieve bounded API, frontend, flow, and test candidates;
4. submit the untrusted story and candidates through LiteLLM;
5. validate a versioned structured Zod response;
6. store confidence, evidence spans, model/prompt versions, and source revisions;
7. present the proposal for confirm, edit, merge, reject, or suppression;
8. rebuild coverage only after a confirmed decision.

Structured flow output includes actors, roles, preconditions, trigger, success
sequence, alternatives, errors/recovery, authorization and tenant boundaries,
API operations, frontend surfaces, test scenarios, missing criteria, and
evidence per claim.

Orphan analysis detects requirements without flows, flows without active
requirements, criteria without steps, steps without implementation, implemented
surfaces without stories, happy-path-only documentation, missing role/failure/
retry/cancel paths, conflicts, and source changes that invalidate mappings.

## Persistence model

PostgreSQL is authoritative. Principal table groups:

- source: `repositories`, `repository_revisions`, `scan_runs`, `source_files`,
  `sync_cursors`, `outbox_events`, `consumer_receipts`;
- API: `api_documents`, `api_operations`, `api_parameters`, `api_responses`,
  `test_expectations`, `coverage_evidence`;
- frontend: `frontend_packages`, `frontend_routes`, `frontend_components`,
  `frontend_states`, `storybook_stories`;
- tests: `test_suites`, `test_cases`, `test_targets`;
- Jira/AI: `requirements`, `acceptance_criteria`, `flows`, `flow_steps`,
  `flow_targets`, `analysis_runs`, `suggestions`, `review_decisions`,
  `findings`, `coverage_snapshots`.

UUID keys, UTC timestamps, explicit graph foreign keys, stable identity unique
constraints, idempotent consumer receipts, and historical deactivation are
required. Chroma is a replaceable semantic index; Kafka is transport.

## Kafka contracts

All events use the shared `FuzeEvent<T>` envelope, schema `1.0`, correlation
IDs, Zod validation, transactional outbox publication, idempotent consumers,
and corresponding `.dlq` topics.

| Topic | Consumer |
|---|---|
| `fuzequality.repository.scan.requested` | scanner |
| `fuzequality.repository.inventory.changed` | intelligence, projector |
| `fuzequality.requirement.sync.requested` | intelligence |
| `fuzequality.requirement.changed` | intelligence, projector |
| `fuzequality.analysis.requested` | intelligence |
| `fuzequality.analysis.completed` | projector |
| `fuzequality.mapping.reviewed` | projector |
| `fuzequality.coverage.rebuild.requested` | projector |
| `fuzequality.coverage.snapshot.ready` | future CI/notifications |

Repository/analysis topics start with three partitions; review/snapshot topics
start with one. PostgreSQL, not Kafka compaction, is the source of truth.

## API and UI plan

REST areas:

- repository create/list/detail and scan request/status;
- API, frontend, and test catalogs;
- portfolio/repository/API/frontend/requirement coverage;
- Jira sync, flows, suggestions and decisions, findings;
- GitHub/Jira webhooks;
- live/ready health and Prometheus metrics.

UI areas:

- portfolio dashboard;
- repository onboarding and detail;
- API expected-test matrix;
- frontend evidence matrix;
- Jira requirement and visual flow explorer;
- AI review queue;
- finding detail;
- worker/source/DLQ operations.

Every response carries catalog revision and policy version so the UI does not
mix incompatible snapshots.

## Delivery sequence and acceptance

1. database, contracts, outbox, API, and platform security integration;
2. GitHub App onboarding and exact-commit scanner;
3. OpenAPI catalog and deterministic API matrix;
4. frontend/test inventory and frontend matrix;
5. Jira, Chroma, LiteLLM, and review workflow;
6. projector, findings, snapshots, portfolio, and webhooks;
7. Helm/Argo, observability, DLQ operations, backups, five-repository pilot;
8. expand after parser findings and false mappings are reviewed.

V1 is accepted when five representative repositories scan at exact commits,
valid operations and frontend subjects appear with expectations/gaps, uncertain
mappings remain separate, Jira stories produce reviewable flows, decisions
rebuild snapshots, source changes process incrementally, credentials never enter
repository URLs, and every workload exposes health, metrics, and structured
logs.

## Verification plan

- scanner fixtures for OpenAPI versions, JS/Python tests, React routes/exports,
  symlinks, malicious paths, oversized files, idempotency, and deltas;
- coverage rule and mapping-precedence tests;
- ADF, prompt-injection, structured-output, invalidation, and outage tests;
- duplicate/reordered Kafka delivery, outbox recovery, DLQ, and restart tests;
- Helm lint, migration contract tests, rollout health, metrics, and five-repo
  production evidence.
