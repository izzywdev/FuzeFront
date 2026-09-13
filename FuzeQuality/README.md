# FuzeQuality V1

FuzeQuality builds an evidence graph across repositories, OpenAPI contracts,
frontend surfaces, automated tests, Jira requirements, and reviewed AI flow
suggestions.

## Platform operational surface

Every Fuze service serves the same three operations. FuzeQuality now does too —
which matters more here than elsewhere, since measuring whether a repository
publishes and covers its own contract is what this product is *for*.

| Route | Behaviour |
|---|---|
| `GET /health` | Unauthenticated. Reports the service, the contract version, and whether this build shipped with its own OpenAPI document. |
| `GET /openapi.yaml` | [`contracts/openapi.yaml`](contracts/openapi.yaml), verbatim. |
| `GET /openapi.json` | The same document, re-serialised. |

`/health/live` and `/health/ready` are unchanged — they are what the chart's
kubelet probes use. `/health` is the platform-wide convention, and is what the
same-origin nginx proxy and any portal reachability check call.

The contract is **baked into the image** (`docker/Dockerfile` copies the source
tree, contract included), not mounted from a ConfigMap: the spec a deployment
serves must be the spec that deployment was built from. A missing spec is
**visible, not fatal** — the spec routes answer `503` (the endpoint exists; its
document is missing — a `404` would read as *"this service publishes no spec"*,
which is a different and wrong diagnosis) and `/health` reports
`openapi: "unavailable"` while staying `200`, because restarting the pod cannot
produce the file.

`contracts/openapi.yaml` deliberately describes **only** those routes plus the
two kubelet probes. The ~30 `/api/v1/*` routes are implemented but not yet
contract-governed: each carries a Permit resource/action pair, tenant scoping and
a fail-closed 401/403 path, and a spec that gets any of those subtly wrong is
worse than no spec — the MCP gateway turns every path in a contract into a
callable tool. They are added by `contract-designer`, one operation at a time,
alongside the authorization they actually enforce.

## Portal registration

[`registration/`](registration/README.md) is what makes FuzeQuality appear in the
FuzeFront portal's applications list. The slug is **`quality`**, not
`fuzequality` — see that README for why the prefix is not cosmetic and why the
registration Job in the chart defaults **off**.

## Product and delivery documentation

- [Long-term product plan](PLANNING.md)
- [Approved catalog-first V1 implementation plan](docs/V1_IMPLEMENTATION_PLAN.md)
- [Current delivery status and cloud-session handoff](docs/DELIVERY_STATUS.md)
- [Interactive architecture diagram](architecture.html)
- [GitHub App operations](docs/github-app.md)
- [Repository onboarding contract](docs/FQ-18-repository-onboarding.md)

## Cloud implementation of coverage gaps

The GAP planner submits selected deterministic expectations to a governed Codex
workflow. The API validates tenant ownership, the exact scanned commit, current GAP
state, agent scope, and idempotency before dispatching
`.github/workflows/fuzequality-implement-tests.yml`. The browser sends expectation
IDs only; agent profiles and skills are resolved from the server allowlist.

Configure `FUZEQUALITY_CLOUD_DISPATCH_TOKEN` and
`FUZEQUALITY_CLOUD_CALLBACK_TOKEN` only in the API deployment. Target repositories
need `OPENAI_API_KEY`, `GH_TOKEN`, `FUZEQUALITY_CALLBACK_URL`, the matching
`FUZEQUALITY_CALLBACK_TOKEN`, and the propagated workflow/agent stack.

## USB-friendly worktree cleanup

`scripts/windows/Remove-WorktreesInBackground.ps1` removes explicit worktree paths
in small resumable batches. It defaults to a dry run; `-Confirmed` asserts that
valuable branch state has already been pushed or otherwise preserved.

```powershell
pwsh scripts/windows/Remove-WorktreesInBackground.ps1 -Action Start `
  -TargetPath D:\source\FuzeFront-FQ-173
pwsh scripts/windows/Remove-WorktreesInBackground.ps1 -Action Start `
  -TargetPath D:\source\FuzeFront-FQ-173 -Confirmed
pwsh scripts/windows/Remove-WorktreesInBackground.ps1 -Action Status
```

## Local development

```powershell
npm install
npm run dev --workspace @fuzefront/fuzequality
```

The web UI runs at `http://localhost:4181` and proxies the API at
`http://localhost:4180`. Without `DATABASE_URL` or Kafka configuration, the API
uses an in-memory demo catalog. This mode is intended for UI development and
scanner evaluation only.

Scan a local repository from the command line:

```powershell
npm run scan --workspace @fuzefront/fuzequality -- D:\source\FuzeFront FuzeFront
```

## Production services

| Process | Command |
|---|---|
| API | `npm run start:api` |
| Repository scanner | `npm run start:scanner` |
| Jira/AI intelligence | `npm run start:intelligence` |
| Coverage projector | `npm run start:projector` |
| Database migrations | `npm run migrate` |

Required production configuration:

```text
DATABASE_URL
KAFKA_BROKERS
GITHUB_APP_ID
GITHUB_APP_PRIVATE_KEY
GITHUB_WEBHOOK_SECRET
JIRA_BASE_URL
JIRA_EMAIL
JIRA_API_TOKEN
LITELLM_URL
LITELLM_MASTER_KEY
FUZEQUALITY_LLM_MODEL
FUZEQUALITY_EMBEDDING_MODEL
CHROMA_URL
CHROMA_TOKEN
CHROMA_TENANT
CHROMA_DATABASE
```

Authentication and authorization are platform-owned dependencies. Production
must use the existing `fuzefront-security` service for FuzeFront human sessions,
scoped `ff_live_` service tokens, and namespaced `fuzequality` product-policy
authorization. The scaffold's `FUZEQUALITY_API_TOKEN` is development-only and
must not be deployed as the production security boundary.

GitHub App permissions are read-only `Metadata`, `Contents`, and `Pull requests`.
Subscribe it to push, repository, installation, and default-branch events. Never
store a PAT or installation token in a repository URL.

The complete registration, webhook, rotation, and verification contract is in
[`docs/github-app.md`](docs/github-app.md).

## Data and safety rules

- PostgreSQL is authoritative; Kafka is asynchronous transport and ChromaDB is a
  replaceable semantic index.
- Deterministic mappings and human decisions affect authoritative coverage.
- AI suggestions remain proposed until confirmed.
- Storybook stories are documentation evidence, not executed test evidence.
- Scanner checkouts use short-lived GitHub App tokens and temporary directories.
- Invalid Kafka messages are routed to per-topic `.dlq` topics.

The intelligence worker builds immutable, content-addressed Chroma collections
for API operations, frontend surfaces, tests, and confirmed/proposed flows.
Collection IDs incorporate the catalog source revisions, so a failed rebuild
does not replace the last trustworthy index and a retry is idempotent. Jira
analysis retrieves at most 40 API/UI candidates, restricted to repositories
bound to the Jira project when bindings exist. Embeddings are supplied through
the existing LiteLLM gateway and can be replaced with the
`FUZEQUALITY_EMBEDDING_MODEL` configuration without changing indexed entities.

Flow extraction uses the versioned `fuzequality-flow-v1` prompt and `1.0`
structured schema. Zod rejects malformed model output before it can be stored.
Review proposals preserve actors, preconditions, trigger, main/alternate/error
and recovery steps, authorization and tenant boundaries, candidate targets,
test scenarios, confidence, evidence, model identity, and prompt/schema
versions. These remain proposed evidence until a human confirms them.

The projector applies deterministic policy `flow-orphans-v1` after repository,
requirement, analysis, or review events. It records story-without-flow,
flow-without-active-story, uncovered criterion/step, implementation-without-story,
and missing role, failure, cancellation, and retry paths. Proposed AI mappings are
excluded: only confirmed flows are authoritative. Rebuilds use stable finding IDs,
replace only the current flow-policy projection, preserve scanner findings and the
last trustworthy projection on failure, and write an immutable coverage snapshot.

Each projected finding exposes its source revision, policy and schema versions, deterministic
evidence strength, evidence identifiers, calculation time, and audit entry through
`GET /api/v1/findings`. `POST /api/v1/internal/coverage/rebuild` returns totals by
type and severity for worker logs and operational metrics.

Requirement review policy `requirement-review-v1` adds a read-only product-planning
layer on the same projection. It identifies stories without acceptance criteria,
conservatively matches opposite criteria for the same behavior, and materializes
LiteLLM `missingCriteria` output as semantic findings instead of silently discarding
it. Each finding carries the relevant Jira passages, confidence when semantic,
affected confirmed flows and implementation targets, and remediation choices. The
web explorer never writes these choices back to Jira; product owners resolve source
requirements in Jira and resync. Repeated events replace only FuzeQuality's derived
policies, retain unrelated scanner findings, and keep the previous committed snapshot
if calculation or persistence fails. Prometheus exposes flow and requirement-review
finding gauges separately.

## Deployment

The Helm chart is in `deploy/helm/fuzequality`; its Argo CD Application is in
`deploy/argocd/fuzequality.yaml`. Secrets must be sealed from the example in
`deploy/sealed` before registering the application.

The chart expects existing FuzeInfra PostgreSQL, Kafka, ChromaDB, LiteLLM,
ingress-nginx, cert-manager, Prometheus, and Sealed Secrets services.
