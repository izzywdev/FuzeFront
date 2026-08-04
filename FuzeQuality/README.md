# FuzeQuality V1

FuzeQuality builds an evidence graph across repositories, OpenAPI contracts,
frontend surfaces, automated tests, Jira requirements, and reviewed AI flow
suggestions.

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
npm run dev --workspace @fuzeone/fuzequality
```

The web UI runs at `http://localhost:4181` and proxies the API at
`http://localhost:4180`. Without `DATABASE_URL` or Kafka configuration, the API
uses an in-memory demo catalog. This mode is intended for UI development and
scanner evaluation only.

Scan a local repository from the command line:

```powershell
npm run scan --workspace @fuzeone/fuzequality -- D:\source\FuzeFront FuzeFront
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
CHROMA_URL
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

## Deployment

The Helm chart is in `deploy/helm/fuzequality`; its Argo CD Application is in
`deploy/argocd/fuzequality.yaml`. Secrets must be sealed from the example in
`deploy/sealed` before registering the application.

The chart expects existing FuzeInfra PostgreSQL, Kafka, ChromaDB, LiteLLM,
ingress-nginx, cert-manager, Prometheus, and Sealed Secrets services.
