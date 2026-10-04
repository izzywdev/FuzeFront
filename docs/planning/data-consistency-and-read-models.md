# Data consistency & read models — applying baseline §4.4 to FuzeFront and the family

**Status:** Design of record · **Date:** 2026-10-04
**Standard:** FuzeSDLC `governance/data-consistency-standard.md` (baseline §4.4), schema `governance/data-contract.schema.json`, skill `data-consistency`.
**Extends:** `entity-lifecycle-event-propagation.md` (choreography over Kafka) and `entity-identity-and-graph-create.md` (typed ids, L0–L3).

> Point-in-time record. The inventory below is measured at the date above; once the phases land, treat it as history and trust the gates' `--report` output instead.

---

## 1. The problem

Every Fuze service owns its own database or schema. Cross-service references are therefore plain ids — nothing enforces them — and UI screens that need data from several services join it **in the browser**:

- `frontend/src/pages/ApplicationsPage.tsx` — `Promise.all([appsAPI.getApps(), getInstalledApps(orgId)])`, then a client-side map join by `appId`.
- `frontend/src/pages/EmployeeOrgDrilldownPage.tsx` — three independent calls (security employee API, `/api/organizations/:id`, `/members`), normalized client-side.

A browser join cannot paginate, filter or sort across services: page 1 sorted by a field that lives in another service is not computable without fetching everything. As the product count grows past 16, this is the scaling wall for every admin screen.

## 2. Decision

Adopt the family standard (baseline §4.4). In one paragraph:

- **Writes stay distributed.** Each entity has a single owning service that writes it.
- **Change propagates through the transactional outbox** to idempotent, order-guarded consumers.
- **References are declared** with a validation level (L1/L2) and an on-delete policy, and are backstopped by an L3 reconciler.
- **Reads are centralized per UI experience.** Each UI's **BFF** composes single-entity views and serves cross-service lists from **projections** (CQRS read models) it owns.

### Rejected alternatives

| Alternative | Why not |
|---|---|
| **Centralized write service** feeding cached read services | Re-creates the shared database with a network hop: one schema and one deploy for every team's change, and ambiguous ownership. The part of the idea that *is* right — cached consolidated read services — is exactly the projection, and the standard keeps it. |
| **2PC / distributed transactions** | Couples every participant's availability, and is unsupported by Kafka. Multi-service operations become sagas. |
| **One generic BFF** for the whole family | Every team changes it for every screen, and its response shapes become a family-wide contract. |
| **One microservice per view** | A deploy, a database, a consumer group and an alert set per screen, with no ownership benefit. |
| **GraphQL federation** as the read layer | It is API composition with nicer ergonomics, so it has the same cross-service sort/paginate limit. Possibly useful later for detail views; not the list answer. |
| **OpenSearch as the default read store** | Disabled in the lean FuzeInfra values, and unnecessary for sort/filter/keyset. Postgres projections first; OpenSearch only for full-text or facets. |

## 3. BFF topology for FuzeFront

| BFF | Serves | Projections it will own (first) |
|---|---|---|
| **Host backend** (`backend/`) — the shell BFF | shell screens: Applications, Organizations, Members, Employee console, Billing summary | `app_catalog_rows` (apps × org installations), `org_member_rows` (users × memberships × roles × subscription) |
| **Each federated product's backend** | that product's screens | its own |
| **`view-service`** (platform, deferred) | only projections that two or more BFFs need identically | none until a second consumer appears |

The host backend today only proxies one request to one service (`routes/billing.ts`, `routes/app-registry.ts`, `routes/notifications.ts`). It gains a `/api/v1/views/*` namespace for composed and projected reads. Commands keep going to the owners through the existing proxies and generated clients.

## 4. Where FuzeFront stands today (measured 2026-10-04)

| Concern | State | Gap to the standard |
|---|---|---|
| Event contract | `shared/src/kafka/`: 24 topics, Zod schemas, `TypedProducer`/`TypedConsumer`, DLQ | Envelope lacks `eventId`, `aggregateType/Id/Version`, `producer`; a Python mirror (`fuzefront-events`) is referenced but does not exist |
| Outbox + relay | `backend/core/src/events/outbox.ts` + `outboxRelay.ts` (`SKIP LOCKED`, DLQ after 10) | Used only by `backend/security`. billing, config, chat, applications, selection-list publish directly or not at all |
| Consumer idempotency | Handlers idempotent by construction; two unique keys in billing | No general inbox table; no version guard |
| References | L0 + L1 shipped (`packages/identity/src/ref-index.ts`, five `*_ref_index` tables) | L1 validated on write only in `backend/applications` (behind a flag); L2/L3 not built; Python package has no ref-index; **soft delete tombstones the org in `ref_index`** (a soft-deleted org is indistinguishable from a missing one) |
| On-delete behavior | config, selection-list, billing and portal teardown handle `org.deleted` | Not declared anywhere. `knownUnhandled`: devportal, email, notification, payment, selection-list, sms |
| Pagination | `governance/pagination-standard.md` + `gate_pagination.py` | No sort/filter grammar. Envelope drift in billing, config, notification, payment, chat, custom-hostname, security `organizations` (offset/page/search) |
| BFF / projections | none; browser joins on two pages | everything in §3 |
| Frontend data layer | axios/fetch + `useState`/`useEffect`; no query cache | `@izzywdev/fuzefront-data`; `DataTable` has sort props but no pagination/filter slots |
| Search store | Postgres `ILIKE` only; Elasticsearch disabled in lean values | Not needed for phase 4 |

## 5. Roadmap

Each phase is its own PR set, contract-first, with agent ownership per `CLAUDE.md`. Gates land in ratchet mode, seeded from a `--report` run so existing services become `knownUnhandled` debt rather than red builds.

| Phase | Deliverables | Owners |
|---|---|---|
| **0. Standard** | FuzeSDLC: standard, `data-contract.schema.json`, baseline §4.4, `data-consistency` skill, agent and routing updates (baseline 1.22.0). FuzeFront: this doc, the `CLAUDE.md` pointer, the readiness-skill dimension, and the identifier-standard cross-link | platform-governance |
| **1. Events foundation** | Envelope v2 schemas. `@izzywdev/fuzefront-events` (consolidating `@fuzefront/shared/kafka` and the `@fuzefront/core` outbox behind re-export shims). `fuzefront-events` (Python). Shared conformance vectors. `processed_events` + `aggregate_version` migrations. Migrate direct publishers onto the outbox. Gates `gate-event-envelope`, `gate-outbox`, `gate-idempotent-consumer` | contract-designer, backend-engineer, database-engineer, platform-governance |
| **2. Query contract** | Pagination standard v2 (sort/filter, signed cursors, watermark). Shared OpenAPI components. `@izzywdev/fuzefront-query` + `fuzefront-query`. `gate-query-contract`. Burn down the envelope drift list | contract-designer, backend-engineer |
| **3. References** | `data-contract.json` for every service. Identity packages gain L2 `verifyRef`, the L3 reconciler, the on-delete executor and the Python ref-index. Fix the soft-delete tombstone. `gate-data-contract`. Per-reference L1 `enforce` ramp behind `fuzefront.data.ref-enforce` (release flag, default OFF) | backend-engineer, database-engineer, feature-flags-engineer |
| **4. Read models (pilot)** | `@izzywdev/fuzefront-projection` + `@izzywdev/fuzefront-bff`. Host-BFF `/api/v1/views/apps` and `/api/v1/views/org-members` backed by the two projections in §3. `gate-projection`. Frames for the two pilot screens first (frames-first) | backend-engineer, product-designer, test-engineer |
| **5. Frontend** | `@izzywdev/fuzefront-data` (TanStack Query; shared MF singleton). `DataTable` pagination/filter slots + `FilterBar` primitive. Migrate the two pilot pages. `gate-no-client-join` warn → fail | frontend-engineer, frontend-test-engineer |
| **6. Fleet rollout** | governance-sync ships gates and skills; per-repo `knownUnhandled` seeded; one agent per repo burns down the ratchets; gates flip to fail per repo in `required-checks.json` | platform-governance, devops-engineer |

Runtime alerts — projection lag, outbox backlog, DLQ depth, L3 orphan count — are requested from FuzeInfra via `@fuze`, never edited from here.

## 6. Open items

- **Kafka in prod vs lean values.** `entity-lifecycle-event-propagation.md` records the bus at `fuzeinfra-kafka.fuzeinfra.svc.cluster.local:9092`, while `deploy/fuzeinfra-lean-values.yaml` disables Kafka. Confirm which profile prod runs before phase 1 depends on the relay in every service; if Kafka is off there, request it from FuzeInfra via `@fuze`.
- **Package scope.** New packages publish as `@izzywdev/fuzefront-*` (baseline §9). The existing `@fuzefront/shared` and `@fuzefront/core` cannot publish under that scope, which is one more reason phase 1 consolidates them into `@izzywdev/fuzefront-events`.
- **Python consumers.** No Python service exists in FuzeFront. Phase 1 should target the first family repo with a Python service as the Python packages' pilot consumer.
