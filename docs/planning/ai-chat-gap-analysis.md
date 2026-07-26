# AI Chat — plan vs. built gap analysis

**Date:** 2026-07-26 · **Tracking:** [#120](https://github.com/izzywdev/FuzeFront/issues/120) (closed as completed), FF-EPIC-02

**Verdict:** the application code is essentially built and tested; **nothing is deployed**. Chat fails
at runtime because the service has no image, no pod, no LLM gateway, no vector store, and no schema.
The four "remaining streams" that `services/chat-service/EXTRACTION.md` deferred were never picked up —
except one, partially. Then the tracking issue was closed, and the work fell off the board.

## Source-of-truth planning docs

| Doc | What it specifies |
|---|---|
| `docs/planning/epics/EPIC-02-ai-chat-platform.md` | FF-EPIC-02, stories S1–S6 (contract → service → RAG → history → `@fuzefront/chat-ui` → deploy). All six still marked **Open**. |
| `docs/superpowers/plans/2026-06-19-ai-chat-rag.md` | Plan F (PR #53) — 24-task/8-phase TDD design: LiteLLM gateway, ChromaDB, Permit-gated tools, SSE protocol, billing metering, security model. |
| `services/chat-service/EXTRACTION.md` | Contract-first handoff — what exists, plus **4 deferred streams** with owners. |
| `services/chat-service/openapi.yaml` | The frozen contract (v1.1.0). |

## What is actually built

| Surface | State |
|---|---|
| `services/chat-service` | 22 src modules / 23 test suites. RAG (chunker, embedder, indexer, retriever, Chroma client), agent loop + tools + Permit + confirmation gate, Postgres repos, migrations 001/002, SSE streaming, auth middleware, rate limits, billing emitter, LiteLLM client. |
| `packages/chat-client` 1.1.0 | Typed HTTP + SSE client, event union. |
| `packages/chat-ui` 1.1.0 | DS-first React widget — 8 components, streaming, citations, confirmation card, feedback, history hydration, bidirectional infinite scroll. |
| Shell integration | `FuzeChatWidget` mounted in `Layout.tsx`; nginx `/chat-api/` → `fuzefront-chat-service:3006` with SSE buffering off. |
| Helm | `chat-service.yaml` (Deployment+Service), `chat-doc-indexer-job.yaml`, both gated on `chatService.enabled`. |

## Why it does not work — the blocking chain

Every item below is deploy/plumbing, not application logic.

1. **`chatService.enabled: false`** (`values.yaml:335`), and `values-prod.yaml` overrides only `affinity`.
   No chat-service pod exists → nginx `/chat-api/` proxies to a Service that isn't there → every send
   fails at the network layer. **This is the symptom users see.**
2. **No image is ever built.** `services/chat-service` is absent from the `release.yml` image matrix
   (which covers email, sms, provisioning, billing, security, applications). `values-prod.yaml` carries
   no `chatService.image.tag`; the default is `local`. Flipping `enabled` alone yields `ImagePullBackOff`.
   Flagged as remaining work in PR #84 **and** in EXTRACTION.md ("the GitHub App lacks `workflows`
   permission") — never done.
3. **The LiteLLM gateway does not exist.** `src/llm/litellm.ts` is the only LLM path — the service never
   calls Anthropic directly, for chat *or* embeddings. `deploy/argocd/applications/litellm.yaml` was
   added in #84 and **deleted** in `f7c2ad56` (2026-06-25): *"points at FuzeInfra/helm/litellm which
   exists at no SHA → can never sync. Re-add when the chart lands."* The chart never landed.
4. **ChromaDB is disabled.** `deploy/fuzeinfra-lean-values.yaml` — `chromadb: { enabled: false }`
   (also `kafka: false`, so billing metering degrades too). No vector store → no RAG.
5. **`ANTHROPIC_API_KEY` is dead config.** Plumbed through `values.yaml` → `secret.yaml` → pod env, and
   read by `config.ts:81` — but **no code consumes it**. The provider key belongs on the LiteLLM side.
   No SealedSecret material exists for it anyway (`deploy/contabo/sealed/` holds billing, fuzefront,
   payment, unleash only).
6. **Nothing runs the migrations.** `npm run migrate` (knex) exists and migrations 001/002 are written,
   but no Helm Job or init-container invokes it and `index.ts` does not self-migrate. The
   `chat_conversations` / `chat_messages` / `chat_audit_log` / `chat_feedback` tables are never created.
   Compare `billing-db-bootstrap-job.yaml`, which does this correctly.
7. **CI never builds or tests chat-service.** It is missing from root `package.json` `workspaces` (only
   `services/email-service` is listed), and **no workflow references it**. `ci.yml` explicitly installs,
   builds and tests email-service; chat-service has zero coverage. The 122 tests from #221 have not run
   since. It is also absent from `skaffold.yaml` and `docker-compose.yml` → no local dev path either.
8. **Redis not wired.** `config.ts` notes `redisUrl` is "not in Helm template yet" — the template sets no
   `REDIS_URL`, so distributed rate limits silently fall back to per-pod in-memory.

## Feature gaps vs. the plan

### a. Chat history is NOT in a vector/RAG DB — and never was specified to be

History lives in Postgres only. ChromaDB holds exactly one collection, `fuzefront-docs-global`
(`src/rag/retriever.ts`), populated solely from `docs/*.md` by the indexer Job. The retriever is
hard-coded to that collection and documents itself: *"read-only — chat-service never writes to Chroma."*

There is **no per-user or per-org embedding of conversation history**, and therefore no semantic recall
over past conversations. Note this is a gap against expectation, not against the plan: EPIC-02 S3 says
"org/user knowledge corpus" and Plan F §13.3 defers per-org collections — neither doc ever specified
embedding chat history. **If history-as-RAG is wanted, it needs a new spec first** (retention, PII,
re-embedding on edit, tenant isolation, cost).

### b. Per-org RAG collections — not built
`fuzefront-docs-{orgId}` is an open question in `retriever.ts`, Plan F §13.3, and EXTRACTION stream 3.
Retrieval is global for every tenant, so EPIC-02 S3's "no cross-org leakage" DoD is unmet by
construction — there is currently no org-scoped corpus at all.

### c. AG-UI never adopted
Issue #120 and EPIC-02 S5 both specify AG-UI rendering. `packages/chat-ui` has **zero** AG-UI
dependencies — it renders with bespoke DS-first components. EXTRACTION stream 2 deliberately left this
as a frontend decision (it is a rewrite of a working, tested package). The SSE event union is already
AG-UI-shaped, so migration needs no backend change. The decision was never made.

### d. "Continuous single thread" is client-side only
The #120 decision is one ongoing thread per user/org (Slack/WhatsApp-style). Server-side,
`POST /chat/stream` still **creates a new conversation** whenever `conversationId` is omitted
(`routes/chat.ts`), and `getOrCreateContinuous(userId, orgId)` — named as the target in EXTRACTION —
does not exist on `ConversationsRepository` (methods: `list`, `findById`, `create`, `touch`).
PR #221 got most of the way there by having `useChat` hydrate the scope's most recent conversation on
mount, but the guarantee depends on the client: any caller that omits the id still forks a new thread.

### e. No design frames
`design/frames/` covers 10 features; none is chat. Existing chat UI predates the design-first gate and
is grandfathered, but `gate-frames-first` will block any new chat feature UI — including the AG-UI
rewrite in (c) — until an approved frames PR lands.

### f. No e2e coverage
Plan F §8 defines four e2e scenarios (RAG Q&A with citations, agentic confirmation, permission
enforcement, billing metering). None exist; `tests/` contains no chat specs.

### g. No least-privilege DB role
EPIC-02 S4 DoD requires a chat-service DB role. The Helm template injects the shared `database.user` /
`DB_PASSWORD` — the same credentials as the host backend.

## Why it stalled

Issue #120 was **closed as completed** on 2026-06-30 by PR #127. But #127 landed the frozen OpenAPI
contract plus a `values.yaml` fix, and explicitly deferred four streams in EXTRACTION.md. Of those,
only stream 1 (history pagination) partially landed, via #221 on 2026-07-13. Streams 2 (AG-UI),
3 (per-org RAG) and 4 (deploy wiring) are untouched — and stream 4 is the entire reason nothing runs.
Meanwhile EPIC-02 still lists all six stories as **Open** while its tracking issue reads closed. That
bookkeeping mismatch is why nobody picked the work back up.

## Minimum path to a working chat

Ordered; 1–4 are hard blockers.

1. **LiteLLM** — land the chart in FuzeInfra (`@claude` delegation; never edit FuzeInfra from here), then
   re-add `deploy/argocd/applications/litellm.yaml`. Seal `LITELLM_MASTER_KEY` and the Anthropic
   provider key **on the gateway**, not on chat-service.
2. **ChromaDB** — enable it in the FuzeInfra values for the target cluster.
3. **Image** — add `services/chat-service` to the `release.yml` build matrix + a `chatService.image.tag`
   in `values-prod.yaml`. Needs a human or a scoped PAT: the GitHub App cannot write `.github/workflows`.
4. **Schema** — add a chat-service migration Job or init-container (mirror
   `billing-db-bootstrap-job.yaml`) and a least-privilege `chat_svc` Postgres role.
5. **CI** — add `services/chat-service` to root `workspaces` and a build+jest job, so its 122 tests
   actually gate. Add it to `docker-compose.yml` / `skaffold.yaml` for a local dev path.
6. **Enable** — flip `chatService.enabled: true`, then `docIndexer.enabled: true` once Chroma is up.
   Verify SSE passes through the ingress under TLS.
7. **Wire `REDIS_URL`** in the chat-service template.

Then the feature gaps: server-side `getOrCreateContinuous` (d), per-org collections (b), the AG-UI
decision plus its frames (c, e), e2e specs (f), and — if wanted — a fresh spec for history-as-RAG (a).

## Not verifiable from this repo

Whether LiteLLM and ChromaDB are actually running in the Contabo cluster right now. `FuzeInfra/` is an
empty submodule dir here and the repo is outside this session's scope. The evidence in-repo — the
deleted Argo app and `chromadb: { enabled: false }` — says no, but that is inference.
