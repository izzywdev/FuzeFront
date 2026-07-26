# AI Chat — plan vs. built gap analysis

**Date:** 2026-07-26 · **Tracking:** [#120](https://github.com/izzywdev/FuzeFront/issues/120) (closed as completed), FF-EPIC-02

**Verdict:** the application code is essentially built and tested; **nothing is deployed**. Chat fails
at runtime because the service has no image, no pod, no LLM gateway, no vector store, and no schema.
The four "remaining streams" that `services/chat-service/EXTRACTION.md` deferred were never picked up —
except one, partially. Then the tracking issue was closed, and the work fell off the board.

> **Status update — items 6, 7, 8 and gap (d) below are FIXED on this branch.** See
> [Fixed in this branch](#fixed-in-this-branch). The remaining blockers (1–5) need infrastructure
> or permissions this repo does not control.

## Source-of-truth planning docs

| Doc                                                | What it specifies                                                                                                                            |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/planning/epics/EPIC-02-ai-chat-platform.md`  | FF-EPIC-02, stories S1–S6 (contract → service → RAG → history → `@fuzefront/chat-ui` → deploy). All six still marked **Open**.               |
| `docs/superpowers/plans/2026-06-19-ai-chat-rag.md` | Plan F (PR #53) — 24-task/8-phase TDD design: LiteLLM gateway, ChromaDB, Permit-gated tools, SSE protocol, billing metering, security model. |
| `services/chat-service/EXTRACTION.md`              | Contract-first handoff — what exists, plus **4 deferred streams** with owners.                                                               |
| `services/chat-service/openapi.yaml`               | The frozen contract (v1.1.0).                                                                                                                |

## What is actually built

| Surface                      | State                                                                                                                                                                                                                                                           |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `services/chat-service`      | 22 src modules / 23 test suites. RAG (chunker, embedder, indexer, retriever, Chroma client), agent loop + tools + Permit + confirmation gate, Postgres repos, migrations 001/002, SSE streaming, auth middleware, rate limits, billing emitter, LiteLLM client. |
| `packages/chat-client` 1.1.0 | Typed HTTP + SSE client, event union.                                                                                                                                                                                                                           |
| `packages/chat-ui` 1.1.0     | DS-first React widget — 8 components, streaming, citations, confirmation card, feedback, history hydration, bidirectional infinite scroll.                                                                                                                      |
| Shell integration            | `FuzeChatWidget` mounted in `Layout.tsx`; nginx `/chat-api/` → `fuzefront-chat-service:3006` with SSE buffering off.                                                                                                                                            |
| Helm                         | `chat-service.yaml` (Deployment+Service), `chat-doc-indexer-job.yaml`, both gated on `chatService.enabled`.                                                                                                                                                     |

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
   calls Anthropic directly, for chat _or_ embeddings. `deploy/argocd/applications/litellm.yaml` was
   added in #84 and **deleted** in `f7c2ad56` (2026-06-25): _"points at FuzeInfra/helm/litellm which
   exists at no SHA → can never sync. Re-add when the chart lands."_ The chart never landed.
4. **ChromaDB is disabled.** `deploy/fuzeinfra-lean-values.yaml` — `chromadb: { enabled: false }`
   (also `kafka: false`, so billing metering degrades too). No vector store → no RAG.
5. **`ANTHROPIC_API_KEY` is dead config.** Plumbed through `values.yaml` → `secret.yaml` → pod env, and
   read by `config.ts:81` — but **no code consumes it**. The provider key belongs on the LiteLLM side.
   No SealedSecret material exists for it anyway (`deploy/contabo/sealed/` holds billing, fuzefront,
   payment, unleash only).
6. ~~**Nothing runs the migrations.**~~ **[FIXED]** `npm run migrate` (knex) existed and migrations
   001/002 were written, but no Helm Job or init-container invoked it and `index.ts` does not
   self-migrate, so the `chat_conversations` / `chat_messages` / `chat_audit_log` / `chat_feedback`
   tables were never created.
7. ~~**CI never builds or tests chat-service.**~~ **[FIXED]** It was missing from root `package.json`
   `workspaces` (only `services/email-service` was listed) and **no workflow referenced it**, so the
   122 tests from #221 had not run since they were written. It remains absent from `skaffold.yaml` and
   `docker-compose.yml` → **still no local dev path** (not fixed).
8. ~~**The Docker image could never build.**~~ **[FIXED]** `services/chat-service/Dockerfile` runs
   `npm ci --workspace=services/chat-service` in both its `base` and `build` stages — but chat-service
   was not a root workspace, so npm fails with _"No workspaces found"_. **The image was unbuildable
   independently of it being missing from the release matrix (item 2)** — fixing the matrix alone would
   not have produced an image. This was not visible anywhere, because nothing in CI ever built it.
9. **Redis not wired.** `config.ts` notes `redisUrl` is "not in Helm template yet" — the template sets no
   `REDIS_URL`, so distributed rate limits silently fall back to per-pod in-memory.

## Feature gaps vs. the plan

### a. Chat history is NOT in a vector/RAG DB — and never was specified to be

History lives in Postgres only. ChromaDB holds exactly one collection, `fuzefront-docs-global`
(`src/rag/retriever.ts`), populated solely from `docs/*.md` by the indexer Job. The retriever is
hard-coded to that collection and documents itself: _"read-only — chat-service never writes to Chroma."_

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

### d. ~~"Continuous single thread" is client-side only~~ — **[FIXED]**

The #120 decision is one ongoing thread per user/org (Slack/WhatsApp-style). Server-side,
`POST /chat/stream` **created a new conversation** whenever `conversationId` was omitted
(`routes/chat.ts`), and `getOrCreateContinuous` — named as the target in EXTRACTION — did not exist on
`ConversationsRepository` (methods were: `list`, `findById`, `create`, `touch`).
PR #221 got most of the way there by having `useChat` hydrate the scope's most recent conversation on
mount, but the guarantee depended on the client: any caller that omitted the id still forked a new
thread every turn.

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

## Fixed in this branch

Four items, chosen because they are the ones this repo can fix without infrastructure or elevated
permissions. Verified locally: `tsc` clean, **24/24 suites, 131 tests passing**.

### Workspace membership + CI gating (items 7, 8)

- `services/chat-service` added to root `package.json` `workspaces`. The lockfile regeneration was
  **purely additive** (+532 lines, zero deletions) — no existing package's resolution changed.
- This also repairs the **Dockerfile**, whose `npm ci --workspace=services/chat-service` could never
  have resolved before.
- New `chat-service-tests` job in `ci.yml`: `npm ci` → build `@fuzefront/shared` → `tsc` chat-service →
  `jest`. The suite now gates every PR for the first time.
- `jest.config.js` `moduleNameMapper` switched from hard-coded `<rootDir>/node_modules/{kafkajs,zod}`
  to `require.resolve(...)`. Workspace membership hoists those deps to the repo root, so the pinned
  paths stopped existing; `require.resolve` is correct under both hoisted and nested installs.
  (This is why the change is load-bearing rather than cosmetic — without it the billing-emitter suite
  fails to run.)

### Schema migration Job (item 6)

- `services/chat-service/src/db/migrate.ts` — programmatic runner calling `db.migrate.latest()`.
  Not `npm run migrate`: that script is `knex --knexfile src/db/knexfile.ts`, which needs **ts-node**,
  a devDependency the production image does not install. Reusing the app's own `db` handle also
  guarantees the Job migrates exactly the database the service then connects to.
- `deploy/helm/fuzefront/templates/chat-db-migrate-job.yaml` — `pre-install,pre-upgrade` hook at
  weight `-3` (after the shared db-bootstrap, before the workload), gated on
  `chatService.enabled && chatService.migrate.enabled`, running `node dist/db/migrate.js` from the
  service image. Idempotent via knex's `knex_migrations` table.
- `chatService.migrate.enabled: true` added to `values.yaml`.

### Server-side continuous thread (gap d)

- `ConversationsRepository.getOrCreateContinuous()` resolves the caller's one ongoing thread for the
  `(user, app, org)` scope, creating it only on first ever use. This is the exact lookup migration
  002's `(user_id, app_id, org_id, updated_at DESC)` index was added to serve.
- `POST /chat/stream` calls it instead of `create()` when no `conversationId` is supplied, so thread
  continuity is now a property of the service rather than of client good behaviour.
- Empty-string `orgId` is normalised to SQL `NULL` (the route derives it as
  `body.orgId || req.orgId || ''`). The lookup matches **both** `NULL` and legacy `''` rows, so
  conversations written before the normalisation stay reachable instead of silently forking.
- Deliberately **not** a unique constraint: pre-existing multi-conversation rows predate the
  continuous-thread decision and a unique index would fail against them. The residual race — two
  concurrent first-ever turns both inserting — is one request wide and self-settles on the next turn.

**Not fixed here, and why:** the least-privilege `chat_svc` DB role (gap g) needs new sealed secret
material and a change to the Deployment's DB credentials — a separate, secret-touching change rather
than something to bundle into this one. The migrate Job therefore runs as the existing
`database.user`, exactly as the chat-service Deployment already does.

## Minimum path to a working chat

Ordered; 1–4 are hard blockers. **Items 4–5 of the original list are now done** (struck through).

1. **LiteLLM** — land the chart in FuzeInfra (`@claude` delegation; never edit FuzeInfra from here), then
   re-add `deploy/argocd/applications/litellm.yaml`. Seal `LITELLM_MASTER_KEY` and the Anthropic
   provider key **on the gateway**, not on chat-service.
2. **ChromaDB** — enable it in the FuzeInfra values for the target cluster.
3. **Image** — add `services/chat-service` to the `release.yml` build matrix + a `chatService.image.tag`
   in `values-prod.yaml`. Needs a human or a scoped PAT: the GitHub App cannot write `.github/workflows`.
4. ~~**Schema** — add a chat-service migration Job~~ **[DONE]**. The least-privilege `chat_svc`
   Postgres role is still open (gap g).
5. ~~**CI** — add `services/chat-service` to root `workspaces` and a build+jest job~~ **[DONE]**.
   Still open: add it to `docker-compose.yml` / `skaffold.yaml` for a local dev path.
6. **Enable** — flip `chatService.enabled: true`, then `docIndexer.enabled: true` once Chroma is up.
   Verify SSE passes through the ingress under TLS.
7. **Wire `REDIS_URL`** in the chat-service template.

Then the remaining feature gaps: per-org collections (b), the AG-UI decision plus its frames (c, e),
e2e specs (f), and — if wanted — a fresh spec for history-as-RAG (a).

## Not verifiable from this repo

Whether LiteLLM and ChromaDB are actually running in the Contabo cluster right now. `FuzeInfra/` is an
empty submodule dir here and the repo is outside this session's scope. The evidence in-repo — the
deleted Argo app and `chromadb: { enabled: false }` — says no, but that is inference.
