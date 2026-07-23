# FuzeQuality delivery status and cloud handoff

**Snapshot:** 2026-07-23  
**Environment:** `contabo-prod`, namespace `fuzequality`  
**Argo application:** `fuzequality`

## Delivered

- FuzeQuality monorepo workspace, contracts, core model, API, web application,
  scanner, intelligence worker, projector, migrations, and reconciler.
- PostgreSQL migrations and normalized evidence schema.
- Kafka topic contracts, consumers, outbox foundations, and DLQs.
- Helm chart, Argo CD application, Sealed Secrets, NetworkPolicies, health,
  metrics, and structured worker logging.
- Production ingress at `https://quality.prod.fuzefront.com`, protected by
  Cloudflare Access.
- Existing platform PostgreSQL, Kafka, ChromaDB, LiteLLM endpoint, and
  FuzeFront security-service integration.
- Read-only FuzeQuality GitHub App:
  - App ID `4377865`;
  - installation ID `148577461`;
  - read-only Metadata, Contents, and Pull Requests;
  - push/repository webhooks;
  - short-lived installation-token checkout.
- Git installed in the scanner image and PKCS#8 GitHub App key handling.
- Internal worker repository lookup and exact-commit checkout.
- Cooperative Kafka heartbeats during long repository scans.
- Initial five-repository production registration:
  - `FuzeFront`;
  - `FuzeInfra`;
  - `FuzePlan`;
  - `FuzeAgent`;
  - `FuzeService`.

Merged delivery PRs relevant to the current production rollout include #363,
#372, #374, #375, and the FQ-11 schema PR #305.

## Current rollout state

The image containing cooperative scanner heartbeats was merged in PR #375 and
is moving through the `fuzequality-release.yml` image/GitOps pipeline. After
Argo sync:

1. verify scanner image/tag and rollout health;
2. republish valid `trigger: "manual"` scan commands for all five repositories;
3. confirm every repository persists a revision instead of remaining queued;
4. record counts for API operations, frontend surfaces, tests, expectations,
   findings, requirements, and flows;
5. validate portfolio/API/frontend pages with real data;
6. update and transition Jira FQ-17, FQ-26, FQ-27, FQ-81, and FQ-82 from live
   evidence rather than deployment-only evidence.

The earlier production worker repeatedly scanned FuzeFront because its
CPU-intensive scan exceeded Kafka group heartbeat timing. PR #375 adds
cooperative heartbeats throughout discovery, parsing, and expectation
projection.

## Configuration still required

The intelligence deployment currently lacks:

```text
JIRA_BASE_URL
JIRA_EMAIL
JIRA_API_TOKEN
LITELLM_MASTER_KEY
```

`CHROMA_URL`, `CHROMA_TOKEN`, and `LITELLM_URL` are present. Do not invent or
copy a personal Jira credential into Git. Provision a read-only Jira service
account/API token and the existing LiteLLM gateway key through Sealed Secrets,
then run Jira synchronization and AI-flow acceptance tests.

## Authoritative validation commands

```powershell
kubectl -n fuzequality get pods
kubectl -n fuzequality rollout status deployment/fuzequality-scanner
kubectl -n fuzequality logs deployment/fuzequality-scanner --since=20m
kubectl -n fuzequality top pod -l app.kubernetes.io/component=scanner
kubectl -n fuzequality get cronjob fuzequality-reconciler
```

Use the backend pod and its existing database environment to query repository
scan status and catalog counts. Do not print database URLs or secret values.

## Product truth at handoff

The application and persistence plane are deployed. GitHub repository access is
working. Exact-commit checkout is working. A populated, measurable portfolio
must not be claimed until the post-#375 scans persist revisions and catalog
counts. Jira/AI flow intelligence must not be claimed operational until the
four missing credentials above are provisioned and a reviewed suggestion
successfully rebuilds a coverage snapshot.

## V1.1 backlog

- Kiwi TCMS planning/case synchronization;
- ReportPortal launch and execution history;
- Storybook build/hosting and interaction evidence;
- Playwright/Schemathesis CI result ingestion;
- historical pass/fail, duration, retry, and flakiness views;
- controlled quality gates after catalog precision is validated.
