# FuzeQuality: End-to-End Quality Planning, Coverage, and Execution Platform

**Status:** Proposed — implementation requires explicit approval  
**Date:** 2026-07-17  
**Branch:** `codex/fuzequality-initial-work`  
**Repository location:** `FuzeQuality/`  
**Decision owners:** FuzeFront product, QA, platform, and security owners

## 1. Executive summary

FuzeQuality will be a self-hosted, open-source quality platform embedded as a new
top-level workspace in FuzeFront. It will connect product intent in Jira, API
contracts in OpenAPI, modeled UI journeys, automated Playwright tests, generated
Schemathesis tests, and historical execution results into one queryable coverage
graph.

The primary outcome is a defensible answer to four questions:

1. What behavior have we promised in Jira?
2. What API operations, UI states, and user journeys implement that behavior?
3. Which planned and automated tests cover it, and what is missing or stale?
4. When did those tests last execute successfully, and how reliable are they?

All planning, execution, reporting, and coverage components introduced by this
project will be open source and self-hosted. Jira remains an existing external
system of record and is not introduced by FuzeQuality.

Persistent services that must survive CI runs will be deployed to the existing
Contabo k3s cluster. Infrastructure capacity will follow FuzeFront's existing
Terraform request plane, while workloads and configuration will follow its Argo
CD pull-based GitOps plane.

The interactive process diagram is available at
[`architecture.html`](./architecture.html).

## 2. Goals

### 2.1 Functional goals

- Import selected Jira epics, stories, acceptance criteria, links, components,
  labels, status, and change timestamps.
- Import OpenAPI 2.0/3.x documents from repository paths and configured URLs.
- Import Storybook story metadata, component states, tags, and documentation from
  its generated `index.json` catalog.
- Discover Playwright suites, cases, projects, tags, annotations, and execution
  results without requiring test bodies to be parsed by an LLM.
- Maintain an explicit catalog of UI journeys, states, transitions, roles, and
  important negative paths.
- Link Jira requirements, API operations, UI flows, test plans, automated tests,
  builds, and results in a versioned coverage graph.
- Detect orphaned, partial, stale, ambiguous, and conflicting mappings.
- Support human review of inferred mappings before they become authoritative.
- Plan manual and automated cases, assign work, group tests into plans/runs, and
  report planning coverage.
- Execute Playwright and Schemathesis in CI and upload results and artifacts.
- Preserve run history, retries, traces, screenshots, videos, logs, duration, and
  flakiness signals across CI cycles.
- Produce release, epic, story, flow, screen, API operation, and test-level
  coverage views.
- Expose APIs usable by CI, planning workflows, and future agent integrations.

### 2.2 Non-functional goals

- No proprietary planning, execution, or coverage dependency.
- GitOps-managed, reproducible Kubernetes deployment.
- No cluster or Contabo credentials in FuzeFront or CI jobs.
- Idempotent synchronization and at-least-once event ingestion.
- Stable identities that survive test renames and Jira text edits.
- Auditable human overrides and mapping decisions.
- Least-privilege service accounts and sealed/encrypted secrets.
- A degraded external dependency must not block unrelated CI tests.
- Raw artifacts and retained metadata must have explicit retention policies.
- Components must support backup and restore through the existing Contabo object
  storage and FuzeInfra database backup patterns.

## 3. Scope boundaries

### In scope

- TypeScript FuzeQuality reconciliation/API service.
- FuzeQuality web dashboard for the unified coverage graph and review queue.
- Jira read-only ingestion and optional write-back of coverage summaries.
- OpenAPI inventory and schema-level coverage.
- UI-flow catalog and Playwright annotation conventions.
- OSS test planning integration.
- OSS historical execution reporting.
- CI reporters/uploaders and quality-gate CLI.
- Helm chart, Argo CD application, Terraform capacity declaration, migrations,
  backup configuration, monitoring, and operational documentation.

### Not in the initial scope

- Replacing Jira as the product backlog.
- Automatically declaring an inferred semantic match correct without review.
- Treating DOM-element visitation as proof of behavioral coverage.
- Generating every product test automatically.
- Browser/device infrastructure as a service.
- Load, penetration, or full accessibility testing, although their results can
  be added to the graph later.
- Mutating Jira stories by default.

## 4. Open-source component decisions

| Capability | Proposed component | License | Deployment | Decision rationale |
|---|---|---:|---|---|
| Test planning and manual execution | Kiwi TCMS Community Edition | GPL-2.0 | Persistent Kubernetes service | Mature test plans, cases, runs, manual/automated workflows, reports, RBAC, containers, and a full RPC API. |
| UI and API automation | Playwright Test | Apache-2.0 | Ephemeral CI runners | Existing framework in FuzeFront; rich traces, projects, retries, screenshots, video, and reporter API. |
| Component and UI-state catalog | Storybook | MIT | Static build in a persistent web-server container; tests run in CI | Makes implemented components, variants, interaction states, and documentation discoverable during planning and review. |
| Cross-run automation analytics | ReportPortal Community Edition | Apache-2.0 | Persistent Kubernetes services | Historical launches, per-case history, logs, attachments, flaky/failure analysis, APIs, and Playwright reporter support. |
| Contract and generated API testing | Schemathesis | MIT | Ephemeral CI runner | Generates positive, negative, boundary, and stateful tests from OpenAPI. |
| OpenAPI schema coverage | TraceCov | Open source; license to be pinned and verified before implementation | Ephemeral CI runner; reports persisted | Measures operations, parameters, schema keywords, examples, and responses rather than endpoint invocation alone. |
| Unified coverage graph | FuzeQuality service | Repository license | Persistent Kubernetes service | Required glue and semantics do not exist as a cohesive OSS product; owns identities, mappings, inference review, and quality gates. |
| Unified quality UI | FuzeQuality web | Repository license | Persistent Kubernetes service | Presents Jira, API, UI-flow, planning, and execution data in one consistent model. |
| Primary application data | PostgreSQL | PostgreSQL License | Existing shared service or dedicated database | Transactional graph metadata, mappings, audit log, and synchronizer state. |
| Artifact storage | S3-compatible object storage | Existing platform capability | Contabo object storage | Durable Playwright traces, screenshots, videos, imported reports, and exports. |
| Metrics and dashboards | Prometheus + Grafana | Apache-2.0 / AGPL-3.0 | Existing cluster services | Reuses existing operational monitoring stack. |
| GitOps | Helm + Argo CD | Apache-2.0 | Existing cluster services | Matches FuzeFront's current deployment model. |
| Infrastructure declaration | OpenTofu/Terraform-compatible HCL | MPL-2.0 / BUSL consideration | Existing FuzeInfra request plane | FuzeFront declares capacity; FuzeInfra owns credentials, state, and apply. The implementation must prefer an OSS OpenTofu-compatible workflow where it controls the runner. |

### 4.1 Rejected or deferred alternatives

| Alternative | Reason not selected initially |
|---|---|
| Xray, Zephyr, TestRail, PractiTest, Testmo | Useful products, but not open-source end-to-end dependencies. |
| Allure TestOps | Proprietary. Allure Report is OSS but does not provide the complete persistent planning and graph workflow. |
| Allure Report only | Excellent single-report presentation, but history persistence and planning/traceability would still require custom infrastructure. It remains a possible secondary static export. |
| ReportPortal as the only database/UI | Strong execution analytics, but it is not the product-requirement and UI-flow planning graph. |
| Kiwi TCMS as the only database/UI | Strong planning system, but it does not derive OpenAPI/UI-flow coverage or replace detailed Playwright trace analytics. |
| DOM element coverage | Visiting or clicking an element is not proof that its behavior, authorization, outcomes, and failure states were asserted. Element evidence may be shown, but gates operate on journeys and states. |
| Chromatic | Useful Storybook hosting and review product, but it is not part of the OSS-only deployment. Storybook will be built and hosted in-cluster, while visual and interaction results flow through the existing OSS execution stack. |
| LLM-only mapping | Non-deterministic and unauditable as the source of truth. Inference is advisory; stable IDs and human decisions are authoritative. |

## 5. High-level architecture

FuzeQuality separates three planes:

1. **Planning plane:** Jira, Kiwi TCMS, flow catalog, mapping review, and coverage
   dashboards.
2. **Execution plane:** ephemeral CI jobs running Playwright and Schemathesis.
3. **Persistence plane:** FuzeQuality API/worker, PostgreSQL, ReportPortal, Kiwi
   TCMS, and object storage in the Contabo cluster.

```text
Jira ───────────────┐
OpenAPI specs ──────┼──> FuzeQuality synchronizer ──> Coverage graph (PostgreSQL)
Flow catalog ───────┤              │                         │
Storybook catalog ──┤              ├──> Kiwi TCMS            ├──> Web dashboard
Playwright catalog ─┘              └──> Review queue          └──> Quality-gate API

CI: Playwright ─────────> ReportPortal + object storage ──┐
CI: Schemathesis/TraceCov ─────────> coverage ingestion ──┴──> graph reconciliation
```

The HTML diagram contains the full planning and execution sequence and the
Terraform/Argo deployment boundary.

## 6. Repository layout proposed for implementation

Only this planning document and its diagram are created before approval. The
remaining entries define the target implementation layout.

```text
FuzeQuality/
├── PLANNING.md
├── architecture.html
├── README.md
├── package.json
├── apps/
│   ├── api/                    # REST API, auth, graph queries, quality gates
│   ├── worker/                 # Jira/OpenAPI/test/result synchronizers
│   └── web/                    # Coverage, planning, history, review UI
├── packages/
│   ├── contracts/              # Zod/OpenAPI contracts and stable ID types
│   ├── graph/                  # Coverage rules and reconciliation engine
│   ├── jira-adapter/           # JQL, pagination, ADF parsing, webhooks
│   ├── kiwi-adapter/           # Plans/cases/runs synchronization
│   ├── reportportal-adapter/   # Launches, items, artifacts, history
│   ├── openapi-adapter/        # Spec normalization and operation inventory
│   ├── storybook-adapter/      # Component/story/state inventory and evidence
│   ├── playwright-reporter/    # Catalog/result reporter and annotations
│   └── quality-cli/            # CI upload, sync, diff, and gate commands
├── config/
│   ├── fuzequality.example.yaml
│   ├── flows/                  # Versioned UI journey definitions
│   └── policies/               # Coverage and release-gate policy as code
├── db/
│   ├── migrations/
│   └── seeds/
├── deploy/
│   ├── helm/fuzequality/
│   ├── argocd/
│   ├── terraform/
│   └── sealed/
├── docker/
├── docs/
│   ├── adr/
│   ├── operations/
│   └── user-guide/
└── tests/
    ├── unit/
    ├── integration/
    ├── contract/
    └── e2e/
```

The root `package.json` will gain `FuzeQuality` as an npm workspace only after
approval. Kiwi TCMS and ReportPortal remain independently versioned containers;
their source is not vendored into this repository.

## 7. Canonical coverage model

### 7.1 Entity types

| Entity | Stable identity example | Source |
|---|---|---|
| Epic | `jira:FUZE-100` | Jira |
| Story/requirement | `jira:FUZE-142` | Jira |
| Acceptance criterion | `jira:FUZE-142#ac:2` plus content fingerprint | Jira/FuzeQuality |
| API operation | `openapi:billing:createSubscription` | OpenAPI `operationId`; method/path fallback |
| UI surface | `ui:billing:checkout` | Versioned flow catalog |
| UI state | `ui:billing:checkout:payment_declined` | Versioned flow catalog |
| UI transition | `ui:billing:checkout:submit->confirmed` | Versioned flow catalog |
| Component story | `storybook:design-system:button:loading` | Storybook `index.json` plus explicit metadata |
| Planned case | `kiwi:case:1234` | Kiwi TCMS |
| Automated case | `pw:frontend:auth:expired-token` | Explicit Playwright annotation |
| Execution | `run:<provider>:<build-id>` | CI/ReportPortal |
| Artifact | content-addressed object key | ReportPortal/object storage |
| Mapping decision | UUID with actor, time, evidence, and version | FuzeQuality |

### 7.2 Required relationships

```text
Epic CONTAINS Story
Story DEFINES AcceptanceCriterion
Story REQUIRES Flow/API operation
Flow CONTAINS State/Transition
ComponentStory REPRESENTS UI surface/state
PlannedCase VERIFIES Requirement/Flow/Operation
AutomatedCase IMPLEMENTS PlannedCase
AutomatedCase EXERCISES Flow/Operation
Execution EXECUTES AutomatedCase
Execution PRODUCES Result/Artifact/CoverageEvidence
MappingDecision CONFIRMS or REJECTS inferred relationship
```

### 7.3 Playwright annotation convention

Tests should carry explicit machine-readable identities. A helper will validate
these at discovery time.

```ts
test('expired password-reset token is rejected', {
  tag: ['@regression', '@auth'],
  annotation: [
    { type: 'fuzequality.case', description: 'pw:frontend:auth:expired-token' },
    { type: 'jira', description: 'FUZE-142' },
    { type: 'flow', description: 'ui:auth:password-reset:expired-token' },
    { type: 'api', description: 'openapi:auth:consumeResetToken' },
  ],
}, async ({ page }) => {
  // test implementation
});
```

File path and test title are searchable metadata, not the primary identity.

### 7.4 Versioned UI-flow format

The UI catalog will be code-reviewed YAML with explicit roles, preconditions,
states, transitions, assertions, and risk.

```yaml
id: ui:auth:password-reset
version: 1
owner: identity
jira: [FUZE-142]
roles: [anonymous]
states:
  - id: request
  - id: email-sent
  - id: expired-token
  - id: completed
transitions:
  - id: request-valid-email
    from: request
    to: email-sent
    risk: critical
  - id: submit-expired-token
    from: email-sent
    to: expired-token
    risk: high
```

The dashboard can render this as a graph with covered, partial, missing, stale,
failed, and unknown edges.

### 7.5 Storybook component-state catalog

Storybook complements, but does not replace, the journey catalog. Stories model
isolated renderable states such as default, loading, empty, validation error,
permission denied, and destructive confirmation. FuzeQuality will ingest the
static Storybook `index.json` output and optional story parameters containing
stable requirement, flow, and state identifiers.

CI will build Storybook and run OSS interaction, accessibility, and Playwright
visual checks against the static build. A successful build becomes an immutable
container image served in the cluster for product, design, QA, and engineering
planning. The FuzeQuality graph records which required component states have a
story, which stories have executable assertions, and when those checks last
passed. Merely having a story does not count as tested behavior.

## 8. Orphan and gap detection

FuzeQuality will use deterministic rules first and inference second.

### 8.1 Deterministic findings

| Finding | Rule |
|---|---|
| Orphaned story | Active story has no linked planned case, flow, or operation after its planning grace period. |
| Orphaned acceptance criterion | Criterion has no confirmed verifying case. |
| Orphaned flow | Active flow has no active Jira requirement or is not explicitly marked as operational/non-product. |
| Orphaned operation | OpenAPI operation has neither a requirement nor a test and is not allowlisted. |
| Orphaned test | Automated identity has no active plan/flow/operation or references deleted entities. |
| Partial flow | A required state or transition lacks a passing test within policy. |
| Stale mapping | Requirement, flow, spec, or test changed after the last confirmed mapping or successful execution. |
| Never executed | Planned/automated link exists but no qualifying result exists. |
| Unhealthy coverage | Coverage exists but the latest qualifying result failed, is blocked, or exceeds flakiness policy. |
| Ambiguous identity | Duplicate IDs or one external case mapped to incompatible active definitions. |

### 8.2 Semantic inference

An optional pluggable inference worker may extract candidate actors, actions,
outcomes, error cases, permissions, and API concepts from Jira descriptions and
acceptance criteria. It may use a self-hosted OSS model or a deterministic NLP
pipeline. Its output is always:

- labeled as inferred;
- assigned a confidence and evidence excerpts;
- placed in a review queue;
- excluded from hard quality gates until confirmed;
- versioned so changed source text triggers re-review.

The initial release can ship without an LLM and still deliver deterministic
orphan detection through explicit Jira, flow, OpenAPI, Kiwi, and Playwright IDs.

### 8.3 Coverage states

```text
UNMAPPED -> PLANNED -> IMPLEMENTED -> EXECUTED
                                ├── PASSING
                                ├── FAILING
                                ├── FLAKY
                                ├── STALE
                                └── UNKNOWN
```

Coverage percentages must always expose their denominator and policy. For
example, “92% critical flow-transition coverage on `main`, passed within 7 days”
is meaningful; “92% covered” alone is not.

## 9. End-to-end workflows

### 9.1 Planning and Jira reconciliation

1. A scheduled worker and Jira webhook enqueue changed issues.
2. The Jira adapter performs JQL-scoped incremental reads using a read-only bot.
3. ADF descriptions and acceptance criteria are normalized and fingerprinted.
4. Explicit IDs/links are reconciled immediately.
5. Candidate semantic mappings enter the review queue.
6. Confirmed mappings update the graph and synchronize cases/plans to Kiwi TCMS.
7. The dashboard displays coverage by epic, story, criterion, flow, risk, and
   release.
8. Optional Jira write-back updates a dedicated FuzeQuality field or comment only
   when enabled; it is not part of the first safe deployment.

### 9.2 Pull-request execution

1. CI discovers Playwright metadata and validates stable annotations.
2. CI builds Storybook, validates story identities, and runs component
   interaction, accessibility, and visual checks.
3. Changed files, Jira keys, flow definitions, Storybook stories, and OpenAPI diffs select impacted
   tests; mandatory smoke/critical tests are always included.
4. Playwright executes in ephemeral CI workers.
5. The reporter streams results to ReportPortal and uploads large artifacts via
   presigned object-storage URLs.
6. Schemathesis exercises changed or policy-selected OpenAPI operations.
7. TraceCov produces schema-level JSON/HTML evidence.
8. The FuzeQuality CLI submits Storybook/Playwright catalogs, mappings, run metadata, and coverage
   evidence idempotently using the CI build ID.
9. The service reconciles the run with the planning graph.
10. A quality gate returns pass, warn, or fail with machine-readable reasons.
11. GitHub receives a check summary with links to FuzeQuality, Storybook, and ReportPortal
    views. Upload failure warns by default during rollout and becomes enforceable
    only after reliability targets are met.

### 9.3 Nightly/full execution

- Run the complete Playwright matrix and full Schemathesis coverage/stateful
  phases.
- Recalculate flakiness, stale coverage, slow tests, uncovered constraints, and
  top failure clusters.
- Reconcile all active Jira scope and OpenAPI inventories.
- Publish an immutable quality snapshot for trend comparison.
- Enforce retention and identify dangling artifacts.

### 9.4 Release readiness

A release policy can require:

- no uncovered critical acceptance criterion;
- no missing critical flow transition;
- all changed OpenAPI operations exercised positively and negatively;
- no latest-result failure for critical cases;
- critical results no older than a defined number of days;
- flakiness below a defined threshold;
- no unreviewed high-confidence mapping change in release scope.

Policies will live in version-controlled YAML and be evaluated by the same graph
engine used by the UI.

## 10. Service contracts

The exact API will be described in an OpenAPI contract before implementation.
The initial resource surface is expected to include:

```text
POST /api/v1/catalog/playwright
POST /api/v1/catalog/openapi
POST /api/v1/results/runs
POST /api/v1/coverage/schema
POST /api/v1/sync/jira
POST /api/v1/sync/kiwi
GET  /api/v1/coverage
GET  /api/v1/findings
GET  /api/v1/reviews
POST /api/v1/reviews/{id}/decision
POST /api/v1/gates/evaluate
GET  /api/v1/snapshots/{id}
GET  /health/live
GET  /health/ready
GET  /metrics
```

Upload endpoints will accept an idempotency key composed from repository, commit,
workflow, attempt, shard, and artifact type. Large binary artifacts bypass the
API and use object-storage URLs.

## 11. Storage and retention

### 11.1 PostgreSQL ownership

FuzeQuality owns tables for:

- sources and sync cursors;
- canonical entities and source revisions;
- graph edges and mapping decisions;
- findings, suppressions, and expiry dates;
- execution summaries and external ReportPortal identifiers;
- schema/UI coverage evidence;
- policy definitions and evaluations;
- immutable quality snapshots;
- audit events and background jobs.

Kiwi TCMS and ReportPortal retain ownership of their internal schemas. FuzeQuality
stores external IDs and normalized summaries rather than reading their databases
directly.

### 11.2 Object storage

Suggested key structure:

```text
fuzequality/<repo>/<yyyy>/<mm>/<run-id>/
├── playwright/trace/<case-id>/<attempt>.zip
├── playwright/video/<case-id>/<attempt>.webm
├── screenshots/...
├── schemathesis/schema-coverage.json
├── schemathesis/schema-coverage.html
└── manifests/artifacts.json
```

Initial retention proposal:

| Data | Retention |
|---|---:|
| Metadata, mappings, audit decisions | Indefinite while project is active |
| Passed-run traces/video | 30 days |
| Failed/flaky-run artifacts | 180 days |
| Release snapshots and associated evidence | 1 year |
| Raw synchronizer payloads | 7 days, redacted |

All durations remain configurable and require approval based on storage capacity
and compliance needs.

## 12. Kubernetes and GitOps deployment

### 12.1 Namespace and workloads

Proposed namespace: `fuzequality`.

Persistent workloads:

- `fuzequality-backend` Deployment;
- `fuzequality-worker` Deployment;
- `fuzequality-frontend` Deployment;
- `fuzequality-storybook` Deployment serving the immutable static Storybook build;
- Kiwi TCMS web/worker components;
- ReportPortal components selected by its supported Helm chart;
- database migrations as Argo PreSync hooks;
- scheduled reconciliation/maintenance as CronJobs where appropriate.

Stateful dependencies should use existing shared FuzeInfra services where
compatibility and isolation permit. ReportPortal's supported architecture may
require PostgreSQL, RabbitMQ, OpenSearch, and object storage. Before implementation,
the platform owner must approve either:

- **Integrated mode:** reuse compatible FuzeInfra services with dedicated
  databases/users/indices/buckets; or
- **Isolated mode:** deploy ReportPortal-supported dependencies into the
  `fuzequality` namespace with dedicated PVCs.

Integrated mode reduces resource use; isolated mode reduces upgrade coupling.

### 12.2 Argo CD

The implementation will add a dedicated Argo Application pointing at
`FuzeQuality/deploy/helm/fuzequality`. It must not add a second application claiming
resources already owned by the FuzeFront umbrella chart.

Proposed sync policy:

- automated sync and self-heal;
- pruning enabled only for stateless resources;
- PVCs and databases protected with retention annotations/policies;
- migrations run before application rollout;
- PodDisruptionBudgets for critical persistent services;
- explicit chart and container versions, never floating tags.

### 12.3 Terraform/OpenTofu capacity plane

FuzeFront does not hold Contabo or cluster credentials. If current cluster
capacity is insufficient, `FuzeQuality/deploy/terraform/` will declare a workload
node request compatible with the existing FuzeInfra module and dispatch flow.
FuzeInfra will validate, plan, apply, and join the node to k3s using remote state.

No infrastructure apply occurs as part of this project until capacity estimates
and product availability are approved.

### 12.4 Ingress and access

Proposed endpoints, subject to DNS approval:

```text
quality.fuzefront.com       FuzeQuality dashboard/API
components.fuzefront.com    Self-hosted Storybook component/state catalog
quality-plan.fuzefront.com  Kiwi TCMS (or path-routed behind quality)
quality-runs.fuzefront.com  ReportPortal (or path-routed behind quality)
```

Preferred final design is a single public FuzeQuality entry point with reverse
proxy/path links to planning and execution tools. Direct service ingresses may be
restricted to VPN/identity-aware access.

## 13. Authentication, authorization, and security

### 13.1 FuzeFront security-service boundary

FuzeQuality is a FuzeFront consumer product. It does not implement or directly
provision its own authentication or authorization stack. **Every human and
machine AuthN/AuthZ decision is delegated to FuzeFront's existing
`fuzefront-security` microservice and its shared contracts.** Authentik and
Permit are implementation dependencies owned behind that platform boundary;
FuzeQuality must not integrate with either as an independent security domain.

- Human authentication uses the FuzeFront security service's OIDC/session flow.
  FuzeQuality consumes the established FuzeFront principal and never owns user
  passwords, sessions, token issuance, OIDC callback handling, or a standalone
  Authentik client lifecycle.
- Human authorization uses a namespaced `fuzequality` product policy declared
  through FuzeFront's `ProductPolicy` contract. The platform security service
  merges and synchronizes the policy to Permit. FuzeQuality APIs request
  fail-closed permission decisions for the current organization/tenant and,
  where applicable, the repository, requirement, suggestion, or operations
  resource instance.
- CI, reconciler, worker, and other machine principals use FuzeFront-issued,
  revocable `ff_live_` service tokens with the minimum product scopes. The
  FuzeQuality API uses the shared flexible-auth middleware/contract and does
  not maintain a parallel static bearer-token database.
- GitHub and Jira webhook signature verification proves event provenance; it
  does not replace FuzeFront authorization for commands that change catalog
  state.
- The web UI uses the FuzeFront same-origin session/API path. It never stores a
  client secret or invents client-side authorization rules. UI visibility may
  reflect granted actions, but the API is authoritative for every decision.

Initial product resources/actions are:

| Resource | Actions |
|---|---|
| `Repository` | `read`, `onboard`, `configure`, `scan` |
| `Catalog` | `read` |
| `Requirement` | `read`, `sync` |
| `Suggestion` | `read`, `review`, `suppress` |
| `Coverage` | `read`, `rebuild` |
| `Operations` | `read`, `retry`, `manage_dlq` |

Role composition and tenant inheritance are declared in the product policy,
not hard-coded in route handlers. Cross-tenant access follows FuzeFront's
organization/ReBAC hierarchy. Audit records capture the stable platform
principal, tenant, product action, target, decision, and correlation ID.

The current V1 scaffold's `FUZEQUALITY_API_TOKEN` check is a temporary
implementation gap. It must be removed before production acceptance and
replaced by the shared FuzeFront human/service authentication contract plus
product-policy authorization checks.

### 13.2 Remaining security controls

- Jira credentials are read-only initially and limited to configured projects.
- Kiwi and ReportPortal integration users receive only required project roles.
- Kubernetes secrets use the existing Sealed Secrets workflow; plaintext is
  never committed.
- FuzeQuality stores references and redacted evidence, not Jira secrets or CI
  environment dumps.
- Logs must redact authorization headers, cookies, tokens, and configured PII
  fields.
- Artifact upload uses size/type limits, malware scanning if available, and
  presigned URLs.
- NetworkPolicies restrict namespace traffic and outbound access.
- Containers run as non-root with read-only root filesystems where supported.
- Images are pinned by digest after validation and scanned in existing CI.
- Mapping approvals, suppressions, and policy changes are audit logged.

## 14. Reliability and failure behavior

| Failure | Expected behavior |
|---|---|
| Jira unavailable | Preserve last snapshot, retry with backoff, mark freshness degraded; do not delete entities. |
| Kiwi unavailable | Queue synchronization; planning UI links degrade but graph remains readable. |
| ReportPortal unavailable | Playwright tests continue; local/JUnit artifacts upload later; gate reports telemetry degradation according to policy. |
| FuzeQuality API unavailable | CI spools bounded result bundles as workflow artifacts and retries; rollout starts non-blocking. |
| Object storage unavailable | Keep metadata and retry artifact upload; never claim artifact completeness. |
| Duplicate CI delivery | Idempotency key updates the same run/shard without double counting. |
| Partial shard completion | Run remains partial and cannot satisfy a full-suite gate. |
| Changed/deleted Jira issue | Revision is retained; entity becomes inactive after reconciliation, never silently erased. |
| Changed OpenAPI operation ID | Alias/review workflow prevents accidental history loss. |
| Inference worker unavailable | Deterministic mapping continues; suggested matches are delayed. |

Background jobs use bounded exponential backoff and a dead-letter state visible
in the operations dashboard. Synchronization cursors advance only after durable
processing.

## 15. Observability and operations

### Metrics

- source sync age, duration, counts, failures, and retry depth;
- graph entity/edge counts and unresolved findings by severity;
- ingestion rate, latency, duplicates, and rejected payloads;
- quality-gate evaluations and reason counts;
- worker queue depth and dead-letter jobs;
- ReportPortal/Kiwi/API availability;
- database connections, query latency, storage, and object-storage growth.

### Logs and traces

- Structured JSON logs with correlation IDs for source revision, run, case, and
  gate evaluation.
- OpenTelemetry traces across API, worker, adapters, and storage.
- Links from FuzeQuality findings to the relevant ReportPortal attempt and
  Playwright trace.

### Alerts

- ingestion or Jira sync stale beyond policy;
- failed migrations or Argo health degradation;
- backup failure;
- database/object-storage capacity thresholds;
- persistent worker backlog;
- excessive result rejection or authentication failure.

### Backup and restore

- PostgreSQL logical backups to Contabo object storage using the established
  FuzeInfra pattern.
- Kiwi and ReportPortal databases included according to chosen dependency mode.
- Object-store lifecycle/versioning policy documented and tested.
- Quarterly restore drill for metadata and at least one historical execution.

## 16. Capacity assumptions and validation

Sizing cannot be finalized from repository inspection alone. Before deployment,
measure:

- active Jira projects, stories, and update rate;
- Playwright case count, projects, shards, runs/day, and retries;
- trace/video/screenshot size distribution;
- OpenAPI operation and schema size;
- expected human concurrency;
- existing Contabo node allocatable CPU, memory, disk, and storage I/O.

Planning estimate for a small initial installation:

| Component group | Initial request estimate | Important caveat |
|---|---:|---|
| FuzeQuality API/web/worker | 1–2 vCPU, 2–4 GiB RAM | Horizontally scalable except migrations/jobs. |
| Static Storybook | 0.1–0.5 vCPU, 128–512 MiB RAM | Nginx/Caddy static serving; bundle size and concurrent viewers dominate. |
| Kiwi TCMS | 1–2 vCPU, 2–4 GiB RAM | Database and user concurrency dominate. |
| ReportPortal stack | 4–8+ vCPU, 12–24+ GiB RAM | OpenSearch and message infrastructure dominate; must validate against official chart guidance and current cluster headroom. |
| PostgreSQL/object metadata | 1–2 vCPU, 2–4 GiB RAM plus storage | Prefer shared managed-by-FuzeInfra capacity with isolated DBs if supported. |

ReportPortal is the main capacity risk. A phase-zero benchmark must compare it
with a leaner OSS alternative or a custom execution-history subset before the
cluster request is approved.

## 17. Quality policy rollout

Gates will progress through controlled modes:

1. **Observe:** collect and display findings; never affect CI.
2. **Warn:** post annotations/check summaries; CI remains green.
3. **Enforce critical changes:** fail only deterministic, high-severity rules on
   changed scope.
4. **Enforce release policy:** apply approved release-wide freshness, health,
   and coverage thresholds.

No inferred semantic finding can fail CI unless a human has converted it into a
confirmed graph relationship or explicit policy rule.

## 18. Implementation phases after approval

### Phase 0 — Decisions and spike

- Confirm OSS licenses and pin upstream versions/images.
- Benchmark ReportPortal resource use on representative data.
- Decide ReportPortal integrated versus isolated dependencies.
- Confirm Jira Cloud/Data Center version, projects, auth, fields, and webhook
  capability.
- Inventory OpenAPI documents and Playwright configurations.
- Approve stable-ID and UI-flow YAML conventions.
- Validate cluster capacity and ingress/auth approach.

**Exit:** approved ADRs, measured capacity, and no unresolved licensing blocker.

### Phase 1 — Local monorepo foundation

- Add npm workspace, shared contracts, API, worker, web shell, CLI, database
  migrations, local Compose development stack, and tests.
- Implement deterministic coverage graph and policy engine.
- Add fixture-based Jira, Kiwi, ReportPortal, OpenAPI, and Playwright adapters.

**Exit:** local demo displays a seeded requirement-to-result graph and findings.

### Phase 2 — Catalog and Jira planning

- Implement incremental Jira ingestion and acceptance-criterion fingerprinting.
- Add UI-flow catalog, visual graph, review queue, suppressions, and audit log.
- Integrate Kiwi TCMS plans/cases/runs and establish ownership rules.

**Exit:** selected Jira scope shows deterministic planning coverage and orphans.

### Phase 3 — CI execution and API coverage

- Implement Playwright catalog/result reporter and annotation validator.
- Deploy ReportPortal integration.
- Add Schemathesis/TraceCov jobs and coverage ingestion.
- Add idempotent CI bundles, spool/retry behavior, and GitHub check summaries.

**Exit:** pull-request and nightly runs reconcile into historical coverage.

### Phase 4 — Kubernetes/GitOps deployment

- Create production Helm chart, Argo Application, SealedSecret templates,
  NetworkPolicies, ingress, migrations, backups, dashboards, and alerts.
- Submit Terraform/OpenTofu-compatible node capacity request only if measured
  headroom requires it.

**Exit:** persistent services survive CI cycles and recovery is verified.

### Phase 5 — Controlled quality gates

- Run observe and warn modes.
- Measure false positives, ingestion reliability, and developer impact.
- Approve critical and release policies.
- Enable deterministic enforcement gradually.

**Exit:** approved release gate operates within reliability and false-positive
targets.

## 19. Testing strategy for FuzeQuality

- Unit tests for IDs, graph reconciliation, coverage state, policy evaluation,
  redaction, and adapters.
- Contract tests against recorded Jira/Kiwi/ReportPortal/OpenAPI fixtures.
- Integration tests with disposable PostgreSQL and mock HTTP dependencies.
- Adapter compatibility tests against pinned OSS container versions.
- End-to-end Playwright tests for planning, mapping review, findings, and history.
- Failure-injection tests for duplicates, reordered events, partial shards,
  unavailable dependencies, and resume from cursor.
- Helm rendering, Kubernetes schema, policy, and Argo diff validation in CI.
- Migration forward/rollback tests on representative database snapshots.
- Backup/restore acceptance test before enforcement.
- Security tests for tenant/project authorization, token scope, upload limits,
  SSRF, XSS from Jira content, and artifact access.

## 20. Acceptance criteria

The first production-capable release is acceptable when:

- A configured Jira epic expands into stories and acceptance criteria with a
  recorded source revision.
- OpenAPI operations and versioned UI flow transitions appear in the same graph.
- Storybook components and states appear in the graph, with missing required
  stories and untested stories reported separately.
- Playwright cases use stable IDs and link to requirements/flows/operations.
- Kiwi TCMS plans and cases are visible and reconciled without duplicate creation.
- Playwright results persist across CI runs and link to traces/artifacts.
- Schemathesis/TraceCov evidence distinguishes full, partial, and missing schema
  coverage.
- Deterministic orphan, partial, stale, never-run, and unhealthy findings are
  correct on an agreed fixture set.
- Inferred mappings require review and cannot independently fail CI.
- A quality snapshot can be filtered by release, epic, story, flow, API, risk,
  branch, and result freshness.
- CI survives telemetry service outages according to the configured mode.
- All persistent workloads are Argo-managed, recover after restart, and restore
  from backup.
- No planning/execution/coverage dependency requires a commercial license.

## 21. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| ReportPortal operational footprint | Cluster cost and maintenance burden | Benchmark in Phase 0; allow a lean execution-history alternative before committing. |
| Kiwi/ReportPortal overlapping concepts | Confusing ownership and duplicate data | Kiwi owns plans/cases; ReportPortal owns attempts/logs; FuzeQuality owns cross-system graph. |
| Jira prose is incomplete or inconsistent | False orphan and inference results | Explicit IDs, configurable fields, planning grace periods, review queue, and transparent evidence. |
| Mapping drift after renames | Lost history or false gaps | Stable IDs, aliases, source revisions, fingerprints, and change-triggered review. |
| Artifact growth | Storage exhaustion and cost | Lifecycle policies, differentiated retention, quotas, and capacity alerts. |
| Quality service blocks delivery | Developer disruption | Observe/warn rollout, spool/retry, deterministic-only enforcement, and availability SLO. |
| OSS upgrade incompatibility | Outage or data migration issues | Pin versions, compatibility tests, backups, staged Argo rollout, and documented rollback. |
| GPL component boundaries | Distribution/compliance questions | Keep Kiwi as an unmodified network service; document source/version and review modifications before distribution. |
| Jira write-back noise | Polluted stories and accidental mutation | Read-only first; dedicated fields and opt-in write-back later. |
| “Covered” becomes a vanity metric | False confidence | Show denominators, risk, assertion evidence, freshness, outcomes, and uncertainty. |

## 22. Decisions required before implementation

Approval should explicitly answer these items:

1. Is `codex/fuzequality-initial-work` the desired branch name, or should it be
   renamed to `fuzequality` before implementation?
2. Is Kiwi TCMS acceptable as the planning system, with Jira remaining the
   requirements source of truth?
3. Is ReportPortal acceptable despite its resource footprint, subject to the
   Phase 0 benchmark?
4. Should the initial Jira integration be strictly read-only?
5. Which Jira projects, issue types, statuses, and acceptance-criteria fields are
   in scope?
6. Should UI-flow definitions be reviewed YAML in Git, or authored primarily in
   the FuzeQuality UI and exported to Git?
7. What branches and result freshness windows define valid coverage?
8. Which artifact retention periods are acceptable?
9. Is a single `quality.fuzefront.com` entry point preferred?
10. May FuzeQuality reuse shared FuzeInfra PostgreSQL/RabbitMQ/OpenSearch services,
    or must quality data be isolated?

## 23. Approval gate

No implementation, dependency installation, root workspace modification, CI
workflow change, Terraform request, Helm chart, Argo Application, Jira mutation,
or cluster deployment is authorized by this document.

Approval should identify any requested changes and state that implementation may
begin. The first implementation action will be Phase 0 validation, not a direct
production deployment.
