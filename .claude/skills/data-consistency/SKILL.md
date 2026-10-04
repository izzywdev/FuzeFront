---
name: data-consistency
description: Use when designing or building anything that crosses a service's database boundary — a reference to another service's entity, a domain event, a consumer, a multi-service operation, a delete that others depend on, or a UI screen/list that combines data from more than one service. Covers single-writer ownership, the transactional outbox, idempotent/order-guarded consumers, sagas, declaring references with a validation level and on-delete policy, choosing between BFF composition and a projection (CQRS read model), the list sort/filter/cursor contract, and read-your-writes. Standard: governance/data-consistency-standard.md (baseline §4.4); declared per service in data-contract.json.
---

# data-consistency

The procedure behind `governance/data-consistency-standard.md`. The standard says *what*; this says *how to decide* and *what to produce*. Every artifact below is checked by a gate (standard §11) once that gate lands; until then it is checked in review.

## 1. Start from the data contract

Open (or create) the service's `data-contract.json` beside its `openapi.yaml` and validate it against `governance/data-contract.schema.json`. Every decision below ends up as a line in it. If the change does not alter any field of the data contract, this skill probably does not apply.

## 2. Decision tree

### "I need to store an id from another service"

1. It is a **reference**. Store it as a native `uuid`, validate it with `assertRef` (L0) at the boundary, and add a `references[]` entry.
2. **Validation level:**
   - Default **L1** (`assertRefExists` against the local `ref_index`), `mode: "warn"`.
   - Flip that reference to `mode: "enforce"` once the projection's lag is reliably inside its budget.
   - Use **L2** (verify-on-write RPC) only when acting on a stale reference moves money or grants access — and write the `reason`.
3. **On-delete policy** — ask *"when the target is deleted, what should happen to my row?"*:
   - the row has no meaning without the target → `cascade`
   - the row stands alone and the link is optional → `nullify`
   - the row is a historical/financial record → `retain` (and make the UI render "deleted <type>")
   - the target must not be deleted while this exists → `restrict` (rare; write the `reason`, and expose the in-use endpoint)
4. Make sure you **consume the target's `*.deleted` topic** and implement the policy in both soft and hard form.

### "Other services need to know this changed"

1. Emit a domain event **through the outbox**, in the same transaction as the write. Never call the producer directly.
2. Use envelope v2. Bump `aggregateVersion` on every change. `created`/`updated` carry the full public snapshot.
3. Add the topic to `emits[]` and freeze its schema in the contract PR (contract-designer).

### "I need to react to another service's event"

1. Build the consumer on the shared runtime: inbox dedupe, version guard, DLQ. Do not hand-roll idempotency.
2. Add the topic to `consumes[]`.
3. Write the replay test: the same events delivered twice, out of order, and replayed from scratch all produce identical state.

### "This operation changes data in more than one service"

1. First ask whether the boundary is wrong — if these services always change together, merge them.
2. Otherwise it is a **saga**: local transaction per service, an event per step, a compensating action for every step that can fail after an earlier one committed.
   - two or three linear steps → choreography;
   - branching or more than three steps → an orchestrator owning the state machine.
3. No 2PC; no "write to both and hope".

### "A screen needs data from several services"

| The screen is… | Do this |
|---|---|
| A single entity's detail view | **Compose in the BFF**: parallel fan-out, timeouts, batch by id, token pass-through, `missing[]` on partial failure. |
| A list over one service's data | Call that service's list endpoint directly (pagination standard + §8 sort/filter). |
| A list that filters, sorts or paginates on fields from **more than one** service | **Projection** owned by this UI's BFF. Add a `projections[]` entry. |
| Search/facets across services | Projection into OpenSearch, in addition to the Postgres one. |

**Which BFF owns it:** the BFF of the UI that shows the screen — never a generic one, and never a new service per view. A shared view-service only when two BFFs need the *identical* projection.

## 3. Building a projection

1. Name it after the view, not the source (`org_member_rows`, not `users_copy`).
2. Columns: the ones shown, sorted or filtered on, plus `<source>_version` per source aggregate and `updated_at`. Nothing else — the detail view fetches the full entity from its owner.
3. Index every declared sort key as `(sort_key, id)` for keyset pagination.
4. Handlers are versioned upserts. A `deleted` event removes or flags the row according to the view's semantics.
5. Expose the checkpoint + lag metric, and a `rebuild` command that truncates and replays.
6. The list endpoint follows standard §8 — declared sortable/filterable fields, signed cursors, `meta.watermark` — and honors `X-Fuze-Min-Version`.

## 4. UI side (frontend-engineer)

- Lists bind their sort/filter/cursor state to the URL and call **one** BFF list endpoint. Never `Promise.all` over two services' clients to build a table.
- Commands go to the owner. Use the returned `{entity, version}` to patch the cache optimistically, and send `X-Fuze-Min-Version` on the following list read.
- Render dangling references and `missing[]` entries as explicit states. Treat `meta.stale` as "keep the optimistic overlay".

## 5. Verification (test-engineer)

- **References:** a write with a reference to a nonexistent target behaves per its `mode`/level. Each `onDelete` policy is applied on both soft and hard delete. The L3 reconciler reports a planted orphan.
- **Events:** a crash between commit and publish still publishes (outbox). A duplicate delivery is a no-op. An out-of-order older version is ignored.
- **Projections:** replay twice / shuffled / from scratch → identical rows. The list walks the full set with no gaps or dupes under concurrent upserts. A cursor reused with a different sort is rejected. Min-version read-your-writes holds.

## Ownership

| Role | Owns |
|---|---|
| contract-designer | event schemas, the list query contract, `data-contract.json` declarations |
| backend-engineer | outbox, consumers, sagas, reference validation, on-delete handlers, projections, BFF views |
| database-engineer | outbox/inbox/projection migrations, `ref_index`, indexes |
| frontend-engineer | list/command wiring, rendering partial and dangling states |
| test-engineer | §5 above |
| platform-governance | the standard and the gates |
