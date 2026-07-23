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

Merged delivery PRs relevant to the production rollout include #363, #372,
#374, #375, #377, the FQ-11 schema PR #305, and documentation handoff #376.

## Current rollout state

PR #377 is deployed as backend/scanner image `df4fde2bddb8`. It combines a
four-minute Kafka session window, background handler heartbeats, and cooperative
heartbeats throughout discovery, parsing, and expectation projection.

All five pilot repositories now have persisted complete revisions:

| Repository | Catalog revision |
|---|---|
| FuzeFront | `f1135e3d7cef01c33c186f7c` |
| FuzeInfra | `24dc823f4535535af6d2a800` |
| FuzePlan | `01b75f58bd579ad229d94a0f` |
| FuzeAgent | `0bd120c929ac39cc50f5e5f1` |
| FuzeService | `d1f896ee785f6125edd4db60` |

The first successful five-repository projection contains:

| Catalog entity | Count |
|---|---:|
| API operations | 192 |
| Frontend surfaces | 372 |
| Test cases | 1,950 |
| Test expectations | 3,256 |
| Findings | 1,457 |

Next cloud actions:

1. validate portfolio/API/frontend pages against these real counts;
2. inspect high-severity findings and scanner diagnostics for false positives;
3. update and transition Jira FQ-17, FQ-26, FQ-27, FQ-81, and FQ-82 from this
   live evidence;
4. provision the Jira/LiteLLM credentials below;
5. execute the first Jira synchronization, AI review decision, and coverage
   snapshot rebuild.

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

The application and persistence plane are deployed. GitHub repository access,
exact-commit checkout, deterministic inventory, and a populated measurable
five-repository portfolio are working. Jira/AI flow intelligence must not be
claimed operational until the four missing credentials above are provisioned
and a reviewed suggestion successfully rebuilds a coverage snapshot.

## V1.1 backlog

- Kiwi TCMS planning/case synchronization;
- ReportPortal launch and execution history;
- Storybook build/hosting and interaction evidence;
- Playwright/Schemathesis CI result ingestion;
- historical pass/fail, duration, retry, and flakiness views;
- controlled quality gates after catalog precision is validated.
