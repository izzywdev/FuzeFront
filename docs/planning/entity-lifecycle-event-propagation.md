# Entity Lifecycle Event Propagation — Choreography over Kafka

**Status:** Design of record · **Date:** 2026-08-03
**Anchor story:** [FFRNT-115](https://fuzefront.atlassian.net/browse/FFRNT-115) — *Master Admin can provision a new tenant portal via a resumable pipeline*
**Scope:** How a created / updated / deleted **organization** or **user** propagates to the other microservices so they can seed, reconcile, or tear down their own state.

> Point-in-time record. File paths and topic lists are current as of the date above; treat them as history once the work lands.

---

## Context — why this exists

When a new org or user is created, several services need to react: Permit must get a tenant + role, the portal service may seed a portal, billing must start (or stop) metering, the identity provider must be wired. The question this doc answers: **do we fan a notification out to all of them over Kafka and let each subscribe, or is there a better practice?**

**Answer: event-driven pub/sub choreography over Kafka is the correct, industry-standard pattern — and FuzeFront already implements most of the *reliable* version of it.** This is not a greenfield decision; it is closing two gaps in an existing design. The naive framing ("publish an event, let everyone subscribe") is only part of the pattern — the rest is the reliability machinery that stops events from being silently lost, and that machinery is where the real work is.

### What already exists and is correct — do NOT rebuild

| Element | Why it matters | Where |
|---|---|---|
| **Kafka** family bus | Single broker, fail-soft everywhere | `fuzeinfra-kafka.fuzeinfra.svc.cluster.local:9092` |
| **Typed, versioned event contract** | `FuzeEvent<T>` envelope, `TypedProducer`/`TypedConsumer`, per-topic Zod schemas, `dlqTopic()` | `shared/src/kafka/` (`@fuzefront/shared/kafka`) |
| **Transactional outbox table** | Solves the dual-write problem — you cannot atomically write Postgres *and* publish Kafka | `event_outbox` (migration `009_provisioning_backbone.ts`) |
| **Idempotent, resumable reconciler** | Self-heal so a lost event never loses provisioning | `organizationProvisioning.ts` (advisory lock) + reconcile-on-login |
| **A working reference flow** | user create → `identity.user.created` → `provisioning-service` → security `/internal/provision` | `services/provisioning-service/` |

### The two real gaps — this is the whole job

1. **The outbox relay is not implemented.** Rows are written to `event_outbox`, but nothing drains them; publishing is best-effort *inline*, so an event is lost whenever Kafka is momentarily down. This is the #1 correctness fix — and it is exactly what [FFRNT-115](https://fuzefront.atlassian.net/browse/FFRNT-115) AC4 depends on ("`portal.created` event is emitted to the event outbox so the failure is observable and retryable").
2. **Only creation-only, user-only topics exist.** There is no `identity.org.*` at all, and no `*.updated` / `*.deleted` for either entity. Org create propagates only via a synchronous inline reconcile; org/user updates and deletes propagate nowhere.

### The "middleware" question, answered

The intuition — *"middleware that publishes an event when an entity is added successfully"* — is right in spirit, but the best-practice implementation is **not Express middleware**. It is the **transactional-outbox write + a relay**: the entity row and the event row are written in **one DB transaction**; a separate relay publishes the event to Kafka. This gives the exact guarantee the intuition wants — *the event is published if and only if the write committed* — without a distributed (two-phase) transaction.

---

## Architecture principles

- **Orchestrate inside a bounded context; choreograph across them.** The reconciler orchestrates the identity domain's own ordered steps (Permit user → tenant → org instance → role → welcome email). Kafka lets *independent* services (billing, portals, chat) react on their own. Keep this split — do not replace it with synchronous HTTP fan-out from the creating route (that rebuilds a distributed monolith with cascading failures).
- **Event style: hybrid.**
  - `*.created` / `*.updated` carry the **entity snapshot** needed to seed locally (event-carried state transfer → consumers need no call-back to the source).
  - `*.deleted` carries `{ id, cascade intent }` only.
- **At-least-once + idempotent consumers.** Exactly-once is not achievable; every consumer must tolerate duplicates. `correlationId` is the idempotency key.
- **Per-entity ordering** via Kafka message **key = entity id** (all events for one org/user land on one partition, in order).
- **DLQ for poison messages** so a single bad event never blocks a partition (`dlqTopic()` already exists).

---

## Design

### Topic taxonomy (new)

Added to the `TOPICS` constant (`shared/src/kafka/types.ts`) **and** the Helm `kafka-topics-job.yaml` **together** — a topic must be in both or it is not pre-created in prod (the `BUILDING_ON_FUZEFRONT.md` rule):

```
identity.org.created        identity.org.updated        identity.org.deleted
identity.user.updated       identity.user.deleted
identity.membership.added   identity.membership.removed
```

Envelope stays `FuzeEvent<T>` v `1.0`. New Zod schemas in `shared/src/kafka/schemas/`:

| Topic | Payload (hybrid) |
|---|---|
| `identity.org.created` / `.updated` | `{ organizationId, slug, name, type, parentId, ownerId, isActive, settings?, metadata? }` |
| `identity.org.deleted` | `{ organizationId, slug, ownerId, cascade: 'soft'|'hard' }` |
| `identity.user.updated` | `{ userId, email, firstName?, lastName?, homePortalId? }` |
| `identity.user.deleted` | `{ userId, email, cascade: 'soft'|'hard' }` |
| `identity.membership.added` / `.removed` | `{ organizationId, userId, role }` |

### Emit path — the outbox helper

A single `enqueueEvent(trx, topic, payload, correlationId)` that inserts an `event_outbox` row **inside the caller's transaction**, modelled on the existing in-txn insert in `oidc.ts`. Wired into every mutation, each moved into a `db.transaction` so the event commits atomically with the row:

- `backend/src/routes/organizations.ts` — `POST` (`identity.org.created`), `PUT` (`identity.org.updated`), `DELETE` (`identity.org.deleted`, `cascade:'soft'` — delete is `is_active=false`).
- `backend/src/services/oidc.ts` — keep `identity.user.created`; add `identity.user.updated` / `identity.user.deleted`.
- Membership add/remove sites → `identity.membership.*`.
- **Mirrored in the `backend/security/src/**` copies.**

### Publish path — the outbox relay (the critical new component)

A background worker turns `event_outbox` into published Kafka messages, and becomes the **single** publish path (the best-effort inline `defaultEventPublisher.publish*` sends are removed so events publish once):

1. `SELECT ... FROM event_outbox WHERE status='pending' ORDER BY created_at LIMIT N FOR UPDATE SKIP LOCKED` (safe across replicas).
2. Publish each via `TypedProducer.send(topic, envelope, schema, { key: entityId })`, validating against the frozen schema.
3. Success → `status='sent', sent_at=now()`. Failure → `attempts++`, `last_error`, stays `pending` with exponential backoff; past a max-attempts threshold → `status='failed'` + route to DLQ.

Runs as a small worker covering the shared `fuzefront_platform` DB (one relay per database is sufficient). **Payoff:** Kafka down → outbox accumulates → relay drains on recovery. No event is lost once the DB commit succeeds.

### React path — consumers (choreography)

Each service subscribes to what **it** owns; handlers are idempotent and DLQ on failure (model: `services/provisioning-service/src/index.ts`).

| Topic | Consumer | Reaction |
|---|---|---|
| `identity.org.created` | provisioning-service | `reconcileOrganizationProvisioning` → Permit tenant + owner role |
| `identity.org.updated` | provisioning / security | Sync name/slug into Permit tenant attributes |
| `identity.org.deleted` | security-service | Permit tenant delete; Authentik teardown |
| `identity.org.deleted` | billing-service | Cancel Stripe subscription, stop metering |
| `identity.org.deleted` | portal-service | Tear down portals owned by the org |
| `identity.user.updated` | provisioning / security | Sync profile → Permit user, Authentik |
| `identity.user.deleted` | security + billing | Permit user delete, revoke sessions; stop user-scoped billing |
| `identity.membership.*` | security-service | Permit role assign / revoke |

**Delete semantics:** org delete is a **soft delete** (`is_active=false`), so `identity.org.deleted` fires with `cascade:'soft'`; consumers deactivate external state, local FKs already `ON DELETE CASCADE`. Preserve the existing fail-closed guards (no delete with active children; never demote/remove the last owner).

---

## Delivery model

This is a cross-service contract change, so it follows the repo's **contract-first fan-out**: the event schemas are frozen first (owned by `contract-designer`), then the backend / consumer / test streams fan out — expect **multiple auto-merge PRs**, not one. The event-propagation implementation is a **backend technical detail** hung off the UX story that first needs it ([FFRNT-115](https://fuzefront.atlassian.net/browse/FFRNT-115)); the tickets live as sub-tasks there.

## Distribution & packaging

The reusable pieces here are **shared middleware**, so per the family rule ([`docs/guides/shared-packages-distribution.md`](../guides/shared-packages-distribution.md)) they ship as **versioned packages published from FuzeFront to the GitHub `fuzeone` org**, and every microservice — Node or Python — consumes the pinned published version rather than vendoring or re-implementing:

| Piece | Package | Consumed by |
|---|---|---|
| Event contract + typed client + registry | `@fuzefront/shared/kafka` → published `@fuzeone/*` | all backend services (+ Python mirror) |
| Express transactional-outbox `enqueueEvent` + relay | `@fuzefront/core` → published `@fuzeone/*` | all Express services |
| Python outbox + relay + Pydantic contract mirror | `fuzeone-events` (PyPI/GitHub) | all Python services |

`@fuzefront/shared` and `@fuzefront/core` are currently workspace-only; giving them `publishConfig` + a publish-workflow entry (mirroring `packages/auth`) and publishing to the `fuzeone` org is the remaining step to satisfy the rule. Only the **generic** middleware is packaged — per-service emit call-sites and consumer handlers stay in their service.

## Verification

- **Unit:** schema round-trips; `enqueueEvent` writes a row and a **transaction rollback drops the event** (proves atomicity); relay marks `sent` / backs off / DLQs; consumers are idempotent (same event twice = one effect).
- **Integration (local Kafka via `docker-compose.yml`):** create/update/delete org → outbox row → relay publishes → consumer reacts (Permit tenant / billing cancel / portal teardown).
- **Kafka-down resilience:** stop broker, create 3 orgs → 3 `pending` rows + 200 responses; start broker → relay drains all to `sent`.
- **Contract guard:** `TOPICS` and `kafka-topics-job.yaml` list the same set.

## Risks

- **Duplicated `backend/src` vs `backend/security` code** (oidc / eventPublisher / organizationProvisioning / routes) — every emit change must land in both. Prefer extracting `enqueueEvent` + the contract into shared code to stop divergence.
- **`required_signatures` on `master` + deploy-on-push** — merge in a deploy window; never bot-merge here.
