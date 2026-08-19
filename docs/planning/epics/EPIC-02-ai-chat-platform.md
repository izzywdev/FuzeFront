---
key: FF-EPIC-02
title: AI Chat platform — @fuzefront/chat-ui npm pkg + chat microservice (Anthropic + AG-UI + RAG + continuous history)
label: [fuzefront, chat, design-system-first, contract-first, paginated, permit-gated]
github: https://github.com/izzywdev/FuzeFront/issues/120
status: ready
priority: High
domain: AI / Chat
---

## 🎯 Epic: AI Chat platform (extract to package + microservice)

| Field | Value |
|-------|-------|
| **Epic ID** | FF-EPIC-02 |
| **Domain** | AI / Chat |
| **Priority** | High |
| **Owner** | Orchestrator (contract-designer → backend/frontend/test/devops fan-out) |
| **Target Release** | Next deploy window |
| **Effort Estimate** | XL |
| **GitHub** | [#120](https://github.com/izzywdev/FuzeFront/issues/120) |

---

### 📌 Problem Statement
> The chat UI/service exists only as an in-shell prototype (#68/#79); there is no reusable package, no
> dedicated microservice, no RAG-augmented Anthropic wrapper, and no continuous (Slack/WhatsApp-style)
> persistent conversation. Without extraction the chat capability cannot be shared across the Fuze
> family, the Anthropic key risks browser exposure, and conversations are ephemeral per-session.

### 🎯 Goal
> A user holds one continuous, streaming, RAG-augmented chat thread per org/user, served by a dedicated
> chat microservice (Anthropic + ChromaDB), rendered by the reusable `@fuzefront/chat-ui` AG-UI package.

### 👥 Target Personas
- **End user** — has an ongoing assistant conversation grounded in their org's knowledge.
- **Family-product developer** — consumes `@fuzefront/chat-ui` + `@fuzefront/chat-client` to embed chat.

### ✅ Features In Scope
- [ ] Feature 1: Freeze the chat-service contract (OpenAPI + Kafka/stream event Zod schemas) and generate `@fuzefront/chat-client`.
- [ ] Feature 2: `services/chat-service` wrapping Anthropic (key in SealedSecret, never browser-exposed), streaming (SSE/websocket).
- [ ] Feature 3: ChromaDB RAG — embed + retrieve over the org/user knowledge corpus, inject into the Anthropic call; documented ingestion path.
- [ ] Feature 4: Continuous chat-history store (Postgres chat-service role), org/tenant-scoped, BOLA-safe, paginated history.
- [ ] Feature 5: `@fuzefront/chat-ui` private npm package rendered with AG-UI (streaming tokens, markdown/code, citations, continuous scrollback, floating launcher).
- [ ] Feature 6: Deploy wiring — Helm Deployment+Service (`enabled` gate), release image matrix, Argo umbrella wiring, SealedSecret.

### 🚫 Out of Scope
- New foundation-model selection / fine-tuning — uses the latest Anthropic model via the LiteLLM gateway path where applicable.
- Multi-modal (voice/image) chat — text-first; future epic.
- Building a generic vector-ingestion product — only the chat RAG corpus path is in scope.

### 🏗️ High-Level Architecture Notes
> Contract-first fan-out: contract-designer freezes the OpenAPI + stream/event schemas → generates
> `@fuzefront/chat-client` (private, GitHub Packages, restricted). Backend (`backend-engineer`) implements
> the service: Anthropic wrap, ChromaDB retrieval, Postgres history, SSE/websocket streaming, Authentik
> auth + Permit authz, BOLA-safe, paginated. Frontend (`frontend-engineer`, sole DS owner) builds
> `@fuzefront/chat-ui` with AG-UI, design-system-first. test-engineer writes independent contract/stream
> tests. devops-engineer does Helm/Argo/CI + SealedSecret. Same-origin API base.

### 📊 Success Metrics
| Metric | Current Baseline | Target |
|--------|-----------------|--------|
| Anthropic key reachable from browser | Risk present | 0 (key server-side only) |
| Conversation continuity across sessions | Ephemeral | Persistent single thread per user/org |
| RAG citations attached to grounded answers | None | ≥ 1 citation when corpus hit |
| `@fuzefront/chat-ui` + `@fuzefront/chat-client` published privately | No | Yes (restricted) |

### 📋 Child Stories
| Story ID | Summary | Status |
|----------|---------|--------|
| FF-EPIC-02-S1 | Freeze chat-service contract + generate @fuzefront/chat-client | Open |
| FF-EPIC-02-S2 | chat-service Anthropic wrapper with streaming | Open |
| FF-EPIC-02-S3 | ChromaDB RAG augmentation + ingestion path | Open |
| FF-EPIC-02-S4 | Continuous chat-history store (Postgres, paginated, BOLA-safe) | Open |
| FF-EPIC-02-S5 | @fuzefront/chat-ui AG-UI package | Open |
| FF-EPIC-02-S6 | Deploy wiring (Helm/Argo/CI/SealedSecret) | Open |

### 🔗 Dependencies
- **Blocked By:** FF-EPIC-02-S1 is the gate for all other stories (contract-first).
- **Related:** Prior chat prototype #68/#79; LiteLLM gateway path; ChromaDB already deployed in prod.

### 📎 References
- GitHub issue: https://github.com/izzywdev/FuzeFront/issues/120
- Prior work: `packages/chat-ui`, `packages/chat-client`, `feat/ai-chat-rag` (#68/#79)

---

## Stories

### 📖 Story: Freeze the chat-service contract and generate the shared client

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-02-S1 |
| **Parent Epic** | FF-EPIC-02 — AI Chat platform |
| **Priority** | High (gate) |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 16 (8 contract + 4 BE-client + 4 QA) |
| **Tech Layers** | Contract / DevOps |

#### 🧑‍💼 User Story
> As a **platform engineer**, I want to **a frozen chat-service OpenAPI + stream/event contract with a
> generated `@fuzefront/chat-client`** so that **the backend, UI, and tests all build against one source
> of truth and contract drift becomes a compile error**.

#### 📌 Background & Context
Per the contract-first fan-out rule, no chat implementation begins until this contract PR is merged. It
freezes endpoints (history, send, stream), the SSE/websocket event schema, and the Kafka event Zod
schemas, then generates the private client package.

#### ✅ Acceptance Criteria
1. **Given** the chat requirements **When** the contract is authored **Then** the OpenAPI spec lints clean (Spectral) and covers history (paginated), send, and streaming endpoints.
2. **Given** the frozen spec **When** the client is generated **Then** `@fuzefront/chat-client` types are produced via `openapi-typescript` and the package has private `publishConfig` (GitHub Packages, restricted).
3. **Edge case:** **Given** a streaming event **When** modeled **Then** the SSE/websocket message schema (token, tool-call, citation, done) is defined as a typed event, not free-form JSON.
4. **Error case:** **Given** a malformed event shape **When** the schema validates **Then** it is rejected at compile/lint time (drift = build error).

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] Spectral lint green on the OpenAPI spec
- [ ] `@fuzefront/chat-client` generates + has `publishConfig` + `repository.directory`
- [ ] Contract PR merged/frozen before fan-out
- [ ] Pagination present on the history endpoint (gate-pagination)

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| Backend | Author chat-service OpenAPI + Kafka/stream Zod schemas | 8 | Open |
| Backend | Generate + wire `@fuzefront/chat-client` private package | 4 | Open |
| QA | Spectral lint + client-typecheck in CI | 4 | Open |

#### 🔗 Dependencies
- **Blocks:** S2–S6 (all gated on this contract).

#### ⚠️ Risks & Assumptions
- **Assumption:** AG-UI's expected event shapes inform the stream schema.
- **Risk:** Stream contract under-specified → model token/tool-call/citation/done explicitly up front.

#### 📎 References
- Contract-first fan-out skill; `api-contract-first` skill.

---

### 📖 Story: chat-service proxies Anthropic completions with streaming

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-02-S2 |
| **Parent Epic** | FF-EPIC-02 — AI Chat platform |
| **Priority** | High |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 20 (8 BE + 8 BE-stream + 4 QA) |
| **Tech Layers** | Backend |

#### 🧑‍💼 User Story
> As an **end user**, I want to **send a message and watch the assistant's reply stream in token-by-token**
> so that **the chat feels responsive and the model key never reaches my browser**.

#### 📌 Background & Context
The chat-service holds `ANTHROPIC_API_KEY` (SealedSecret) and proxies completions to Claude (latest model
id; via LiteLLM gateway where applicable), streaming over SSE/websocket per the frozen contract.

#### ✅ Acceptance Criteria
1. **Given** an authenticated user sends a message **When** the service calls Anthropic **Then** the reply streams back token-by-token over the contract's stream channel.
2. **Given** the running service **When** inspected **Then** the Anthropic key is only in the server's SealedSecret-mounted env, never returned to or reachable by the browser.
3. **Edge case:** **Given** the client disconnects mid-stream **When** the stream is cut **Then** the service cancels the upstream Anthropic request and frees resources.
4. **Error case:** **Given** Anthropic returns an error/rate-limit **When** proxied **Then** the service emits a typed error event and a graceful UI-renderable message — never leaking the key or a raw stack.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] Backend unit tests passing, coverage ≥ 80%
- [ ] Streaming verified against the frozen contract
- [ ] Key never browser-exposed (verified)
- [ ] Authentik auth + Permit authz on the endpoints

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| Backend | Anthropic completion proxy + model config (LiteLLM path) | 8 | Open |
| Backend | SSE/websocket streaming + cancellation + typed error events | 8 | Open |
| QA | Unit tests: stream happy-path, disconnect, error/rate-limit | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** S1 (contract).

#### ⚠️ Risks & Assumptions
- **Assumption:** LiteLLM gateway path available for routing where applicable.
- **Risk:** Long-lived streams behind ingress → confirm SSE/websocket pass-through under TLS.

#### 📎 References
- LiteLLM gateway memory note; chat contract from S1.

---

### 📖 Story: Every chat turn is RAG-augmented from ChromaDB

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-02-S3 |
| **Parent Epic** | FF-EPIC-02 — AI Chat platform |
| **Priority** | High |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 20 (8 BE-retrieval + 8 BE-ingestion + 4 QA) |
| **Tech Layers** | Backend |

#### 🧑‍💼 User Story
> As an **end user**, I want **the assistant to ground its answers in my organization's knowledge** so
> that **replies are relevant to my context and cite their sources**.

#### 📌 Background & Context
Retrieval-augment every turn: embed the query, retrieve from ChromaDB (already deployed) over the
org/user corpus, inject retrieved context into the Anthropic call, and surface citations. Document the
ingestion path so corpora can be populated.

#### ✅ Acceptance Criteria
1. **Given** a user message and a populated corpus **When** the turn is processed **Then** relevant chunks are retrieved from ChromaDB and injected into the Anthropic prompt.
2. **Given** retrieved chunks were used **When** the reply streams **Then** citations referencing the source chunks are attached per the contract's citation event.
3. **Edge case:** **Given** an empty/cold corpus **When** the turn is processed **Then** the service answers without RAG context (no error) and attaches no citations.
4. **Error case:** **Given** ChromaDB is unreachable **When** retrieval is attempted **Then** the service degrades gracefully to a non-RAG answer and logs the retrieval failure — never blocks the chat.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] Backend unit tests passing, coverage ≥ 80%
- [ ] Ingestion path documented (`docs/`), corpus is org/user-scoped
- [ ] Retrieval is tenant-scoped (no cross-org leakage) — verified
- [ ] Graceful degradation verified

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| Backend | Embed + retrieve from ChromaDB + context injection + citations | 8 | Open |
| Backend | Corpus ingestion path (org/user-scoped collections) + docs | 8 | Open |
| QA | Unit tests: retrieval hit, cold corpus, Chroma-down degradation, no cross-org leak | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** S1 (contract), S2 (Anthropic call to inject into).

#### ⚠️ Risks & Assumptions
- **Assumption:** ChromaDB is reachable from the chat-service in the cluster.
- **Risk:** Cross-tenant retrieval leakage → enforce org/user collection scoping in retrieval.

#### 📎 References
- ChromaDB (deployed in prod per consumer model).

---

### 📖 Story: Conversation history is continuous, persistent, and paginated

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-02-S4 |
| **Parent Epic** | FF-EPIC-02 — AI Chat platform |
| **Priority** | High |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 16 (8 BE + 4 DB + 4 QA) |
| **Tech Layers** | Backend + Data tier |

#### 🧑‍💼 User Story
> As an **end user**, I want **one continuous, persistent conversation thread (like a Slack channel)
> that I can scroll back through** so that **my chat history survives across sessions and devices**.

#### 📌 Background & Context
Replaces ephemeral per-session chat with a persistent single thread per user/org stored in Postgres
(chat-service DB role), org/tenant-scoped, BOLA-safe, with paginated history retrieval.

#### ✅ Acceptance Criteria
1. **Given** a returning user **When** they open chat **Then** their prior messages load as one continuous thread (most recent first, scrollback paginated).
2. **Given** a long history **When** scrolling back **Then** older pages load per the `gate-pagination` standard without duplicates or gaps.
3. **Edge case:** **Given** a brand-new user **When** they open chat **Then** an empty thread renders (no error) ready for the first message.
4. **Error case:** **Given** a request for another user's/org's history **When** made **Then** it returns 403 (BOLA-safe) — never another tenant's messages.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] Backend unit tests passing, coverage ≥ 80%
- [ ] Migration is ordered + idempotent; chat-service DB role least-priv
- [ ] `gate-pagination` green on the history endpoint
- [ ] BOLA verified (appsec-reviewer pass)

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| Backend | Persist messages + paginated continuous-thread history endpoint | 8 | Open |
| Backend | Postgres schema + migration + chat-service DB role wiring | 4 | Open |
| QA | Tests: continuity, pagination, empty thread, BOLA 403 | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** S1 (contract). **Related:** database-engineer owns the DB role/migration wiring.

#### ⚠️ Risks & Assumptions
- **Assumption:** chat-service gets its own Postgres role/database per the data-tier convention.
- **Risk:** Unbounded thread growth → page + index on (org, user, created_at).

#### 📎 References
- Data-tier (database-engineer) convention; pagination standard.

---

### 📖 Story: @fuzefront/chat-ui renders a polished AG-UI chat experience

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-02-S5 |
| **Parent Epic** | FF-EPIC-02 — AI Chat platform |
| **Priority** | High |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 20 (4 UX + 8 FE + 4 FE-package + 4 QA) |
| **Tech Layers** | Frontend + Design System |

#### 🧑‍💼 User Story
> As an **end user**, I want **a polished streaming chat UI with message bubbles, markdown/code, retrieval
> citations, and continuous scrollback** so that **chatting feels modern and the assistant's sources are
> visible**; and as a **family-product developer** I want it as a reusable package.

#### 📌 Background & Context
Promote the chat UI into a standalone private package `@fuzefront/chat-ui` rendered with AG-UI, consumed
by the shell and family products. Design-system-first (fuse-seam tokens); the floating launcher stays.

#### ✅ Acceptance Criteria
1. **Given** a streaming reply **When** it arrives **Then** AG-UI renders tokens live with message bubbles, markdown/code blocks, and tool-call awareness.
2. **Given** an answer with citations **When** rendered **Then** the retrieval citations are shown and linkable per the contract's citation event.
3. **Edge case:** **Given** a long continuous thread **When** opened **Then** scrollback is virtualized/paginated and the floating launcher persists.
4. **Error case:** **Given** a stream error event **When** received **Then** the UI shows a graceful inline error with retry — never a blank bubble or crash.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] RTL + a11y tests passing, coverage ≥ 80%
- [ ] `gate-ds-conformance` green — fuse-seam tokens, no raw hex/spacing/type
- [ ] `@fuzefront/chat-ui` private `publishConfig` (GitHub Packages, restricted) + repository.directory
- [ ] Built against `@fuzefront/chat-client` (single type source)

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| UX Task | Design chat surface (bubbles, citations, launcher) against fuse-seam tokens | 4 | Open |
| Frontend | Build AG-UI chat package: streaming, markdown, citations, scrollback | 8 | Open |
| Frontend | Private package config + publish wiring | 4 | Open |
| QA | RTL a11y + stream/error-state tests | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** S1 (client). Builds against a mock server from the contract (no wait on backend).

#### ⚠️ Risks & Assumptions
- **Assumption:** AG-UI integrates with React + the fuse-seam DS.
- **Risk:** AG-UI styling overrides DS tokens → wrap/tokenize AG-UI to conform to the DS.

#### 📎 References
- `fuzefront-ui-package` + `frontend-design` skills; AG-UI protocol.

---

### 📖 Story: chat-service is deployable via the GitOps pipeline

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-02-S6 |
| **Parent Epic** | FF-EPIC-02 — AI Chat platform |
| **Priority** | Medium |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 16 (8 DevOps + 4 DevOps-secret + 4 QA) |
| **Tech Layers** | DevOps |

#### 🧑‍💼 User Story
> As a **platform operator**, I want **the chat-service deployable via Helm/Argo with an enabled gate and
> a SealedSecret for the Anthropic key** so that **it ships through GitOps and never needs a hand-deploy**.

#### 📌 Background & Context
Independently-lifecycled service → its own Argo Application (per the hybrid Argo structure). Image in the
release/CI build matrix; prod values tag-bump; SealedSecret for `ANTHROPIC_API_KEY`.

#### ✅ Acceptance Criteria
1. **Given** the chart **When** rendered **Then** chat-service Deployment+Service exist behind a `chat.enabled` gate (default off until ready).
2. **Given** the release pipeline **When** it builds **Then** the chat-service image is in the build matrix and prod values tag-bumps.
3. **Edge case:** **Given** `chat.enabled=false` **When** synced **Then** no chat-service resources are created (clean gate).
4. **Error case:** **Given** a missing SealedSecret **When** the pod starts **Then** it fails fast with a clear message (no silent keyless start).

#### 🔲 Definition of Done
- [ ] Helm lint + kubeconform (strict) green
- [ ] Argo Application wiring for the independently-lifecycled chat-service
- [ ] SealedSecret scaffolding committed (placeholders) + seal step documented
- [ ] Image in release matrix + values-prod tag entry
- [ ] No hand-deploy to prod (GitOps only)

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| DevOps | Helm Deployment+Service+values (`chat.enabled` gate) + Argo Application | 8 | Open |
| DevOps | SealedSecret scaffold (ANTHROPIC_API_KEY) + seal-step docs | 4 | Open |
| QA | helm lint + kubeconform + enabled/disabled render checks | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** S1 (contract); can run in parallel with S2–S5.

#### ⚠️ Risks & Assumptions
- **Assumption:** Argo umbrella + sealed-secrets controller present in prod.
- **Risk:** Streaming through ingress → confirm SSE/websocket pass-through in values.

#### 📎 References
- Hybrid Argo structure; sealed-secrets convention.
