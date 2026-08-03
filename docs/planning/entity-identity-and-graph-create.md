# Entity identity, graph create, and cross-service referential integrity

Implementation plan behind **`governance/identifier-standard.md`** (the normative
document — where the two disagree, the standard wins). This file records *why*
the design is shaped the way it is, and what is still outstanding.

## The decision

**The service that owns an entity mints its identifier. Clients never supply one.**

### The threat, stated precisely

A client that chooses ids can create an entity of type B carrying the id of an
entity of type A. Anywhere the system resolves a *bare* id without its type — a
polymorphic reference, a generic resolver, a permission check keyed on id alone —
the B row is mistaken for the A row, and an unauthorized operation executes
against A or cross-service reference resolution silently desynchronises.

One correction to that framing, because it changes what to fix: **a system that
resolves a bare id across types is already broken.** An attacker who merely
*learns* a type-A id can pass it where type B is expected — plain IDOR. Client
ids do not create the vulnerability; they change its cost from "find a UUID
collision" (probability ~0) to "type one in" (certainty).

Hence the standard has **two** rules, not one: ids are server-minted (§1) *and*
every polymorphic reference carries its type (§3). Either alone leaves a hole.

Industry framing: **OWASP API3:2023 BOPLA** (the 2023 merge of API6:2019 Mass
Assignment). Beyond type confusion, client ids also enable squatting, a
201-vs-409 cross-tenant existence oracle, defeat of unguessability, and — with
UUIDv7/ULID, whose timestamp is *in* the id — forged ordering.

## Why type-prefixed ids, given no shared database

Initially filed as "too breaking, separate ADR". That was wrong for this
architecture, for a reason specific to it: orders and customers live in
**different services and different databases**. There is no foreign key and no
shared unique index, so the cross-type collision is unguarded by *any* database.
A self-declaring typed id is then the only defense that works with no network
call, no cache, and no coherence assumption.

The repo already agreed: `generatePortalId()`
(`backend/src/repositories/portalRepository.ts`) mints `prt_<hex>` against a
documented regex. The pattern was in production; it needed generalising, not
inventing.

### Evidence reviewed

| Case | Lesson taken |
|---|---|
| **Stripe** — `cus_`/`ch_`/`sub_` since day one; length never published; re-prefixed invoice line items to `il_` | The prefix is for the boundary check and for humans in logs. Never parse past it, never assume length. |
| **GitHub** — changed GraphQL node IDs; warned that decoding `PR_kwDO…` to infer type would break; shipped `X-Github-Next-Global-ID` | Format migration is survivable *with* an explicit dual-accept window. Hence `parseId`'s per-type legacy set (§8). |
| **Shopify** — REST-numeric and GraphQL GIDs coexist for years; GID structure explicitly not guaranteed | **Two identity models at once is the expensive state.** Killed the "prefixed for new types only" option. |
| **TypeID** — prefix + UUIDv7 in base32, a documented superset of UUID | The prefix need not live in the storage column. |

That last row collapsed the tradeoff: **wire-typed, storage-native.**
`cus_01h455…` on the API; a native 16-byte `uuid` column underneath (UUIDv7, so
index locality is preserved). The type confusion happens at the API boundary,
which is exactly where the prefix now exists — so the guarantee is structural
where it matters, and migration is a serializer change plus a type column rather
than a primary-key rewrite across every service.

## Graph create — two refinements to the original proposal

The proposal: the frontend posts a graph using placeholder ids (1, 2, 3); the
server replaces them and returns the graph with references updated.

**(a) The placeholder does not go in `id`.** It would put `id` back into create
bodies and degrade the rule to "id must be present but fake", which is
unenforceable. A separate document-scoped `lid` keeps §1 absolute. Standardised
prior art: JSON:API 1.1 `lid`, SCIM `bulkId` (RFC 7644 §3.7.2), OData `$batch`
Content-ID.

**(b) Pre-allocate rather than substitute on the way out.** Every id is minted
before any handler runs. Three consequences: handlers see a plain body with real
ids and never learn `lid` existed (so **no route implements any of this** — the
stated requirement); `idMap` is just the allocation table; and **reference cycles
resolve**, which post-substitution cannot do without a deferred second write.

### The atomicity limit — a real constraint

A `lid` graph spanning services **cannot be created atomically**; there is no
distributed transaction. So a graph is scoped to **one service's aggregate**, and
cross-service references must be real existing ids. Genuine cross-service
creation is a saga over the existing outbox (`event_outbox`, migration
`009_provisioning_backbone.ts`), explicit and opt-in.

## Referential integrity as a middleware concern

Correct: with separate databases there is no FK to lean on. Layered —

- **L0** `assertRef` prefix check — offline, answers *is it the right kind of thing*
- **L1** local `ref_index` projection fed by Kafka `*.created`/`*.deleted` — answers *does it exist* without an RPC, and survives the owner being down
- **L2** verify-on-write RPC + negative cache, per-reference opt-in
- **L3** async reconciler over the outbox, quarantining orphans

L1 is the right default here because the substrate already exists
(`shared/src/kafka/`, `TypedProducer`, per-event Zod schemas). **L0 is what makes
the rest safe** — only it answers *kind*, and only it needs nothing external.

## Delivered

| Phase | Content | Status |
|---|---|---|
| **P0** | `governance/identifier-standard.md` + allowlist; `@fuzefront/shared/identity` (registry, branded `EntityId<T>`, TypeID codec, mint/parse/assertRef); `gate_identifier.py` + harden-gate wiring; spectral glob widened to `packages/*`; `additionalProperties: false` added to 7 create schemas in `packages/security` | **done** |
| **P1** | `lid`/`idMap` graph-create middleware; billing-service reference implementation + contract shapes (spec 1.2.0 → 1.3.0) | **done** |
| **P1b** | `fuzefront-identity` Python package (`packages/identity-py/`) — stdlib-only, pure-ASGI middleware, cross-language parity tested | **done** |
| **P2** | `ref_index` Kafka projection + `assertRef` at L1 | ticket |
| **P3** | Roll out across remaining services; backfill the ~41 bare-uuid mint sites behind `fuzefront.identity.prefixed-ids` | ticket |

### Enforcement, weakest last

1. **Compile-time (primary)** — branded `EntityId<T>`; a raw string off
   `req.body` does not compile against a repository taking one. Asserted by
   `@ts-expect-error` fixtures, so the guarantee is itself tested.
2. **Runtime boundary** — the middleware 422s a client-supplied `id`.
3. **CI** — `gate-identifier`: contracts + registry parity **enforcing**; source
   backstop report-only until the P3 backlog clears.

## Known state

- **`gate-identifier --source` reports ~41 findings.** All genuine entity-id mint
  sites (`appId`, `organizationId`, `invitationId`, `factorId`, `sessionId`).
  This is the P3 backlog, and why that check ships report-only.
- **Pre-existing test failure, untouched:**
  `services/billing-service/tests/handlers/invoice-synced.test.ts` fails with
  `ctx.emitter.subscriptionChanged is not a function`. Verified to fail
  identically on a clean tree — unrelated to this work, and left alone rather
  than folded into an unrelated change.
- **`LocalId`/`IdMap` lint as unused components** in the billing spec. They
  document the middleware's wire contract for generated clients rather than
  being referenced by an operation. Warning only.
