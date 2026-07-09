# Chat extraction — architecture, RAG ingestion path, and remaining streams

Tracking issue: **#120** — extract AI Chat into `@fuzefront/chat-ui` (frontend npm
package) + `chat-service` (backend microservice) with Anthropic + AG-UI + RAG +
continuous history.

This document is the contract-first handoff for the remaining work. The chat
prototype from **#68 / #79** is already in-tree and tested; this captures what
exists, the frozen contract, and the streams still to land — each with an owner,
because `master` is **deploy-on-push** and must not be bot-merged (merge in a
deploy window).

## What already exists (do not reinvent)

| Surface | Location | State |
|---|---|---|
| Chat microservice | `services/chat-service/` | RAG (Chroma), agent loop + tools, Postgres history repos + migration, SSE streaming, Permit authz, rate-limits, billing emitter, LiteLLM gateway client |
| Frozen API contract | `services/chat-service/openapi.yaml` | **NEW (this PR)** — single source of truth for `@fuzefront/chat-client` |
| Frontend UI package | `packages/chat-ui/` | DS-first React widget: streaming, RAG citations, confirmation card, feedback, floating launcher |
| Typed client package | `packages/chat-client/` | HTTP + SSE client, event union types |
| Deploy templates | `deploy/helm/fuzefront/templates/chat-service.yaml`, `chat-doc-indexer-job.yaml` | Deployment + Service + indexer Job, gated on `chatService.enabled` |

### Anthropic wrap
The service never calls Anthropic directly from the browser. `ANTHROPIC_API_KEY`
(and any `LITELLM_MASTER_KEY`) are read by `src/config.ts` from env injected by a
SealedSecret, and chat/embedding calls go through the platform **LiteLLM gateway**
(`src/llm/litellm.ts`, OpenAI-compatible), which resolves the Claude model by name.
The chat default model is resolved at the gateway; the doc-indexer's `defaultModel`
default in `src/rag/index-docs.ts` should track the **latest Claude model id**.

## RAG ingestion path

Write path (offline / on deploy) and read path (per turn):

```
                        ┌─────────────────────────────────────────┐
  docs/*.md  ──▶ chat-doc-indexer Job (Helm post-install/upgrade)  │  WRITE PATH
                        │  src/rag/index-docs.ts                    │
                        │    collectMarkdown(DOCS_DIR)              │
                        │    ─▶ Indexer.index(GLOBAL_DOCS_COLLECTION)│
                        │         chunker  → chunks                 │
                        │         Embedder (LiteLLM /embeddings)    │
                        │         ChromaClient.upsert (content-hash │
                        │           ids ⇒ idempotent)               │
                        └───────────────┬───────────────────────────┘
                                        ▼
                                   ChromaDB  (fuzefront-docs-global)
                                        ▲
                        ┌───────────────┴───────────────────────────┐
  user turn  ──▶ POST /chat/stream                                   │  READ PATH
                        │  Retriever.retrieve(query, topK=5)         │
                        │    embedQuery (LiteLLM) → NN search        │
                        │    ─▶ Chunk[]  → rag_sources SSE event +    │
                        │         injected into the Anthropic prompt │
                        └────────────────────────────────────────────┘
```

- **Ingestion is a Helm Job** (`chat-doc-indexer-job.yaml`), `post-install,post-upgrade`,
  gated on `chatService.docIndexer.enabled`. It runs `node dist/rag/index-docs.js`
  over `DOCS_DIR` (default `/app/services/chat-service/docs`). Re-running is safe —
  ids are content-hash keyed (upsert, not append).
- **Local run:** `npm run index:docs` (reads `./docs`, needs `LITELLM_URL` + `CHROMA_URL`).
- **Collection:** currently a single global collection `fuzefront-docs-global`
  (`src/rag/retriever.ts`). Per-org collections (`fuzefront-docs-{orgId}`) are an
  open item — see below.

## Frozen contract

`services/chat-service/openapi.yaml` (OpenAPI 3.1) is **derived from the real route
handlers** and is the freeze point for the fan-out. The SSE `ChatStreamEvent` union
is intentionally **AG-UI-compatible** so the renderer consumes it without a
translation layer. Change the API by amending the spec first, then regenerate
`@fuzefront/chat-client`.

## Remaining streams (NOT in this PR)

Each is scoped to a single agent per the contract-first model. They were left out
of this PR deliberately: the workspace was not installed in the automation env, so
behavioral/runtime changes could not be test-verified before a `master`-bound branch.

1. **Continuous single-thread history + pagination** — `backend-engineer` + `test-engineer`.
   The issue's decision is one ongoing thread per user/org (Slack/WhatsApp-style),
   not a new conversation per session. Today `POST /chat/stream` creates a new
   conversation when `conversationId` is omitted (`routes/chat.ts`), and
   `GET /chat/conversations/:id` returns the full message list unpaginated
   (`messages.ts: listForConversation`). Target (already in the spec as
   `x-status: planned`):
   - `ConversationsRepository.getOrCreateContinuous(userId, orgId)` — resolve the
     caller's single ongoing thread; `/chat/stream` defaults to it.
   - `MessagesRepository.listForConversation(id, userId, { before, limit })` —
     newest-first cursor pagination (`gate-pagination`), default 50 / max 200.
   - Update `@fuzefront/chat-client` (`getConversation` params) + contract tests.

2. **AG-UI rendering** — `frontend-engineer` (sole editor of `design-system/`).
   `@fuzefront/chat-ui` currently renders with bespoke DS-first components. Adopting
   AG-UI is a deliberate rewrite of a working, tested package, so it is a frontend
   decision rather than a silent swap. The contract is already AG-UI-event-shaped,
   so the renderer can be migrated without backend changes. Keep DS tokens, a11y,
   and the floating launcher.

3. **Per-org RAG collections** — `backend-engineer`. `retriever.ts` notes
   `fuzefront-docs-{orgId}` as an open question; required for true org-scoped corpora.

4. **Deploy wiring** — `devops-engineer` (deploy window):
   - Add `chat-service` to the **release image matrix** in `.github/workflows/release.yml`
     (cannot be done by the bot — GitHub App lacks `workflows` permission).
   - Add the **Argo umbrella** Application entry for the chat-service / LiteLLM.
   - Author the **`ANTHROPIC_API_KEY` SealedSecret** material under `deploy/contabo/sealed`
     (the chart already references `.Values.secret.anthropicApiKey`).
   - Flip `chatService.enabled` / `docIndexer.enabled` once LiteLLM + ChromaDB are
     reachable in `fuzeinfra`.

## Fixed in this PR

- **`deploy/helm/fuzefront/values.yaml`** had **three** top-level `chatService:` keys
  (a #68/#79 merge artifact). YAML last-key-wins meant the sparse third copy (port
  3007, no `litellmUrl`/`chromaUrl`/`backendUrl`/`permitPdpUrl`/`docIndexer`) silently
  won — so `helm template` would nil-pointer on `chatService.docIndexer.enabled` once
  enabled, and the Deployment would render with the wrong port and empty upstream
  URLs. Consolidated to a single complete block (port 3006, all upstreams, docIndexer).
