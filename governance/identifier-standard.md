# Identifier standard (enforced)

The canonical entity-identifier standard for the Fuze family. Policy owned by `platform-governance`; enforced by **`gate-identifier`** (`scripts/gate_identifier.py`, run from `harden-gate.yml`). Companion to `governance/pagination-standard.md`, which it deliberately mirrors in shape.

Reference implementations: **`@izzywdev/fuzefront-identity`** (Node) and **`fuzefront-identity`** (Python, `packages/identity-py/`). They are pinned to each other — see §7.

## 1. Rule

**The service that owns an entity mints its identifier. Clients never supply one.**

A create request body (`POST`, or `PUT` to a collection) **MUST NOT** accept an `id`/`uuid`/`_id` field naming the resource being created, and its schema **MUST** set `additionalProperties: false`.

A field naming an entity that already exists — `organizationId` on a create, `userId` on `MemberCreate` — is a **reference**, not identity, and is fine.

### Why, precisely

A client-chosen id is not merely untidy. It converts a cross-type collision from something an attacker must *find* (probability ≈ 0 against UUIDv4) into something they *type in* (certainty). The collision then enables **type confusion** anywhere the system resolves a bare id without its type: an entity of type B created with the id of an entity of type A, so a lookup, a permission check, or a cross-service reference resolves to the wrong row. In OWASP terms this is **API3:2023 Broken Object Property Level Authorization** (the 2023 merge of API6:2019 Mass Assignment); `id` is the textbook server-owned property.

Client ids also enable **squatting** (pre-creating a row on an id a legitimate flow will later need), a **201-vs-409 existence oracle** across tenants, defeat of any code that leans on ids being unguessable, and — with UUIDv7/ULID, whose timestamp is *in* the id — **forged ordering**.

### The two rules, and why one is not enough

1. **§1** — the owning service mints the id.
2. **§3** — every polymorphic reference carries its type; no lookup resolves a bare id.

§1 without §3 still loses to an attacker who *learns* an id rather than choosing one. §3 without §1 leaves squatting, cross-tenant grafting and defeated unguessability standing. Both, or neither is worth much.

**Corollary, always in force:** an id is **never a capability**. Authorization comes from the token and the Permit policy. "The caller knew the id" is never sufficient, and no rule below is a substitute for an authorization check.

## 2. Format — wire-typed, storage-native

Ids are **TypeID**-shaped: a registered type prefix, an underscore, and a 128-bit UUIDv7 in base32.

```
cus_01h455vb4pex5vsknk084sn02q
^^^ ^-------------------------
 |   26-char base32 (Crockford, lowercase, no i/l/o/u) of a UUIDv7
 type prefix, from the registry
```

Because TypeID is a superset of UUID with a lossless conversion, the prefix is a **wire** concern and storage stays native:

| | Form | Where |
|---|---|---|
| **Wire** | `cus_01h455vb4pex5vsknk084sn02q` | request/response bodies, logs, URLs |
| **Storage** | `0195a8f2-6c3d-7f11-…` in a `uuid` column | Postgres, 16 bytes, UUIDv7 index locality |

`toUuid()` / `fromUuid()` (`to_uuid` / `from_uuid`) convert. A polymorphic row additionally stores its `entity_type`.

This is what makes the attack in §1 **structurally impossible** rather than merely checked: no string is simultaneously a valid `cus_` and a valid `inv_`, so a reference arriving at the wrong endpoint fails a string compare — **no network call, no cache, no database**. In a microservices split there is no shared unique index to lean on, so an offline check is the only one that always works.

### Ids are opaque past the prefix

Validate the prefix; never parse further, never assume a length, never construct an id by string surgery. This is not fastidiousness — it is the lesson every large API has already paid for:

- **Stripe** has deliberately never published its id length and reserves the right to change it (treat as opaque, ≤255 chars). It re-prefixed invoice line items to `il_`, breaking exactly the integrators who had parsed ids.
- **GitHub** changed its GraphQL global node IDs and warned outright that anyone decoding the first two characters of `PR_kwDOAHz1OX4uYAah` to infer the type would break. It shipped `X-Github-Next-Global-ID` as a dual-read window.
- **Shopify** states there is *no guarantee* GIDs follow `gid://shopify/{resource}/{id}` and that you must not construct them.

**Minting is centralised.** `mintId(type)` / `mint_id(type)` is the only sanctioned constructor. Calling `randomUUID()`/`uuid4()` for an entity id bypasses the registry and produces an untyped id; `gate-identifier --source` flags it.

### Registry

`packages/identity/src/registry.ts` and `packages/identity-py/fuzefront_identity/registry.py` hold the type→prefix map. Adding a type there is the only way to mint ids for it. **Prefixes are permanent once shipped** — changing one is a wire-breaking change for every stored reference in the family.

## 3. References carry their type

Any field or column that can point at more than one entity type **MUST** carry the type alongside the id, and **every** lookup **MUST** key on the pair.

```ts
// wrong — a bare id decides which table is consulted
const row = await repo.findById(body.entityId)

// right — the pair is the key
const row = await repo.findByEntity(body.entityType, body.entityId)
```

billing-service already does this: `customer.repository.ts` keys `findByEntity` on both columns, and `payments.ts` re-verifies the body's `entityType`/`entityId` against the authorized actor. That is the pattern; this section makes it the rule.

`gate-identifier` fails a schema declaring `entityId`/`ownerId`/`subjectId`/`targetId`/`parentId`/`resourceId` without a sibling `…Type`.

## 4. Graph create — `lid` in, `idMap` out

Once clients stop supplying ids, a frontend creating a customer and its invoices in one request needs a way to say "this invoice belongs to *that* customer I am creating right now", and to learn the real ids on return.

Each node carries a **document-scoped local id** (`lid`) and references it as `"lid:<local>"`:

```jsonc
// request
{ "type": "customer", "lid": "1", "name": "Acme",
  "invoices": [ { "type": "invoice", "lid": "2", "customerId": "lid:1" } ] }

// response
{ "status": "created",
  "idMap": { "1": "cus_01h455…", "2": "inv_01h456…" } }
```

Standardised prior art, not invention: **JSON:API 1.1 `lid`**, **SCIM `bulkId`** (RFC 7644 §3.7.2), **OData `$batch` Content-ID**.

- **`lid` is not `id`.** Putting a placeholder in `id` would put `id` back in create bodies and degrade §1 to "id must be present but fake", which is unenforceable. `lid` is never persisted.
- **Ids are minted up front**, before any handler runs, and substituted into the body. So handlers receive a plain body with real ids and never learn `lid` existed — **a route opts in by doing nothing** — `idMap` is just the allocation table, and **reference cycles resolve**, because both ids exist before either row is written.
- **`idMap` always covers every first-class entity**, so the creator never loses what it made. Children are reachable by fetch.

### The aggregate boundary — a hard limit

> **A `lid` graph is scoped to ONE service's aggregate.** `lid:` references may only point at entities created in the same request *in the same service*. Entities owned by another service must be referenced by their real, existing ids.

A graph spanning services **cannot be created atomically** — there is no distributed transaction. Keeping the graph inside one aggregate keeps the middleware a single local transaction. Genuine cross-service creation is a **saga over the outbox** (`event_outbox`, migration `009_provisioning_backbone.ts`) — explicit and opt-in, never an emergent side effect of posting a graph.

`gate-identifier` and the middleware both reject a `lid` node declaring a type the service does not own (`CROSS_AGGREGATE_LID`).

## 5. Referential integrity without a shared database

Orders and customers live in different services and different databases. There is no foreign key. Integrity is layered:

| Layer | Mechanism | Cost | Answers |
|---|---|---|---|
| **L0** | `assertRef('customer', id)` — prefix check | string compare, offline | *is it the right kind of thing* |
| **L1** | local `ref_index` projection fed by Kafka `*.created`/`*.deleted` | indexed local lookup | *does it exist* — no RPC, survives the owner being down |
| **L2** | verify-on-write RPC + negative cache, per-reference opt-in | one call, TTL'd | staleness-intolerant references (money movement) |
| **L3** | async reconciler over the outbox, quarantining orphans | background | anything above missed |

**L0 is what makes the rest safe.** L1–L3 answer existence; only L0 answers *kind*, and only L0 needs no network, no cache, and no coherence assumption. L1 is the right default here because the substrate already exists — `shared/src/kafka/` with `TypedProducer` and per-event Zod schemas.

## 6. Exemptions

Client-assigned ids are legitimate for offline-first and local-first surfaces, where the client is a trusted peer in a sync protocol rather than an anonymous caller, and cannot round-trip for an id.

Note first that **idempotency is not a reason**. Retry-safety is served by an `Idempotency-Key` request header — a separate namespace, scoped to the caller and TTL'd — which is how Stripe and AWS (`ClientToken`) solve it without handing clients a primary key.

To exempt an operation: `x-client-assigned-id: allowed` plus `x-client-assigned-id-reason` on the OpenAPI operation, or an entry in `governance/identifier-allowlist.txt`.

An exemption is **not** a waiver of §1's threat model. An exempted operation MUST additionally either:

- derive the stored id as `uuidv5(<per-type namespace>, clientRequestId)` — so the client's value is a dedup key, never the identity, and the same input yields different ids per type; or
- enforce a tenant-scoped `(tenant_id, id)` primary key, so a chosen collision cannot cross a tenant boundary.

## 7. Cross-language parity

The Node and Python implementations MUST agree exactly — same prefixes, same codec, same acceptance and rejection, same error codes. A prefix that differs between them means a reference minted by a Node service is rejected by a Python one: a cross-language outage that no single-language test can catch.

Pinned three ways: both suites assert the same TypeID spec vectors; `packages/identity-py/tests/test_identity.py::TestCrossLanguageParity` reads `registry.ts` directly; and `gate_identifier.py --registry-parity` compares the two registries on every CI run.

## 8. Migration

Existing rows carry bare UUIDs. `parseId`/`parse_id` accepts an unprefixed UUID **per type**, for types inside their dual-accept window — GitHub's `X-Github-Next-Global-ID` play, and the reason a format migration is survivable at all.

Default is **strict**: no type accepts a bare UUID. A service adopting `parseId` on an existing surface widens it explicitly at bootstrap:

```ts
configureIdentity({ legacyUuidTypes: new Set(['customer', 'invoice']) })
```

Defaulting the other way would let a service keep accepting untyped ids simply by forgetting to configure anything — the exact failure this standard removes. Backfill is tracked per type behind `fuzefront.identity.prefixed-ids` (default OFF).

**Do not run two identity models indefinitely.** Shopify has carried REST-numeric alongside GraphQL-GID for years and is escaping it only by deprecating REST wholesale. Pick a type, migrate it, close its window.

## 9. Enforcement

Three layers, weakest last:

1. **Compile-time (primary).** Branded `EntityId<T>`. A raw `string` off `req.body` does not type-check against a repository taking `EntityId<'customer'>`, and `EntityId<'customer'>` is not assignable to `EntityId<'invoice'>`. The hole is *unreachable*, not merely detected. Asserted by `@ts-expect-error` fixtures so the guarantee is itself tested.
2. **Runtime boundary.** The graph-create middleware rejects `id` in create bodies (422 `CLIENT_SUPPLIED_ID`), resolves `lid`, and mints.
3. **CI — `gate-identifier`.**
   - **contracts + registry parity: ENFORCING.** A new create body declaring an `id`, or a polymorphic reference without its type, fails the build.
   - **source backstop: report-only.** It is grep-shaped and therefore evadable; it flags direct uuid minting for entity ids and `as EntityId` casts. ~41 call sites remain (the §8 backlog), so it ratchets to enforcing once cleared.

Run locally:

```bash
python scripts/gate_identifier.py .                    # contracts (enforcing)
python scripts/gate_identifier.py . --registry-parity  # Node/Python registries agree
python scripts/gate_identifier.py . --source           # implementation backstop
python scripts/gate_identifier.py . --all              # everything
```
