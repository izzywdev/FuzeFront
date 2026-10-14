# Org membership lifecycle events

**Status:** implemented (PR #1284). **Owner:** @izzywdev.

Publish a domain event whenever a user is added to / removed from an
organization, so downstream services can seed user-org data and initial ReBAC
policies off a single source of truth instead of each re-deriving membership.

## Contract (pre-existing — reused, not changed)

- Topics: `identity.membership.added`, `identity.membership.removed`
  (`shared/src/kafka/types.ts`).
- Payload: `membershipChangeSchemaV1 = { organizationId: uuid, userId: uuid, role: string }`
  (`shared/src/kafka/schemas/identity.membership.added.ts`), registered in
  `shared/src/kafka/registry.ts` and validated by the outbox relay at publish.
- `role` is the membership role (`owner|admin|member|viewer|developer`), not a
  Permit role; the mapping to Permit lives in the consumer path (below).

## Publisher — the live writer of each operation emits via the outbox

Events are enqueued with `enqueueEvent(trx, …)` from `@fuzefront/core`
**inside the same transaction** as the membership write (transactional outbox,
per the data-consistency standard — never a direct producer). There is **one
physical DB** (`fuzefront_platform`) and **one relay** (in the security-service,
`startOutboxRelayIfConfigured`) that drains `event_outbox`, so an enqueue from
either backend is delivered on one topic. A small helper
(`emitMembershipAdded` / `emitMembershipRemoved`) keeps the payload and
`identity-membership-{added,removed}-<uuid>` correlation convention consistent.

Emit sites — the **live prod writer** of each op (ingress routes
`/api/organizations` → security; `/api/invitations` → monolith):

| Operation | Backend | Event |
|---|---|---|
| Org create → owner membership | security | added (pre-existing precedent) |
| Personal-org provisioning (+ self-heal) | security | added |
| `ensureRootMembership` | security | added |
| `ensureDeveloperMembership` | security | added |
| Invite accept → membership | monolith | added |
| `DELETE /:id/members/:memberId` | security | removed |

**Idempotency:** the provisioning upserts run on every login, so each emit is
gated on an **actual row insert** (`.returning('id')` / existence guard) — no
spurious `added` on a repeat sign-in.

Deliberately **not** emitted (and why): monolith org routes (prod-dead shims),
security invite-accept (prod-dead; `/api/invitations` is the monolith),
`POST /:id/members` (writes an invitation, not a membership), the change-role
route (role change is neither add nor remove; the schema has no variant),
`deprovisionOrganization` (already emits `identity.org.deleted` cascade),
boot-time `rootOrgAdmin` reconcile (idempotent, not a user action).

## Consumer — ReBAC reconcile (the "initial ReBAC policies" seeding)

`provisioning-service` consumes both topics and POSTs to new S2S endpoints on
the security-service — `POST /internal/membership-sync` /
`/internal/membership-unsync` (`INTERNAL_PROVISION_SECRET`-gated, cluster-only,
exempted in `governance/openapi-exempt.txt` like the sibling `/internal/*`) —
which call `assignOrganizationRole` / `unassignOrganizationRole`. Those map the
membership role to the Permit **tenant role** on the org (owner/admin→admin,
member→editor, viewer→viewer, developer→developer). A Permit failure returns
non-2xx so the consumer retries (then dead-letters), per the data-consistency
standard; replay is safe because Permit `assign` is idempotent.

## Why no per-service "seed on membership" handlers (scope decision)

The feature's goal — downstream services seeding user-org data + initial ReBAC
on their own elements — is met **centrally** by the Permit tenant-role reconcile
above. A tenant role applies to every resource instance in the tenant, so a new
member gains the right access to a service's org-scoped resources with no
per-service handler. Audited:

- **selection-list-service** — list access is a tenant-level Permit check; its
  per-list instance grants (`PUT /:listId/access/:userId`) are **explicit admin
  actions** and a read-model mirror (review C-1), deliberately not auto-seeded
  on membership. Covered by the tenant role; a handler would be wrong.
- **config-service** — consumes only org/user *deleted* (cleanup); holds no
  per-(user,org) rows to seed.
- **ref-index** — projects entity *existence* (user/org/portal), not
  relationship edges; membership is not an entity.

Adding handlers to these would be vacuous and would trip
`gate-microservice-events`' anti-vacuity rule. If a future service genuinely
owns per-(user,org) seeded data with instance-scoped ReBAC, it subscribes to
these same topics and seeds + grants in its own handler — the contract already
supports it.
