# FuzeQuality V1

FuzeQuality builds an evidence graph across repositories, OpenAPI contracts,
frontend surfaces, automated tests, Jira requirements, and reviewed AI flow
suggestions.

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
