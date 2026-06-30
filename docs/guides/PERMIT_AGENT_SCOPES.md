# Permit.io conventions: per-resource agent scopes, sensitivity tiers & time-boxed approval grants

**Status:** proposed — pending **contract-freeze**.
**Originator:** FuzeKeys MCP Secrets-Broker (FuzeFront issue #114).
**Shared env:** these conventions live in FuzeFront's shared Permit model
(`backend/src/permit/schema.ts`) so the whole Fuze family inherits one pattern
for instance-scoped agent authorization. Other products **copy this pattern**
onto their own resources rather than re-inventing it.

This document standardizes three things the family had no agreed pattern for:

1. **Per-resource (instance-scoped) agent roles** — out-of-scope = no assignment = deny.
2. **A `sensitivity` attribute (LOW / MEDIUM / HIGH)** + the policy that ties it to actions.
3. **A time-boxed `approved_release` role** the broker assigns after a human approves a HIGH request.

The canonical worked example is the `Secret` resource. The approval **queue**,
**notifier**, and the **revocation timer** stay in the broker; **only the
decision** (the role assignment) lives in Permit.

---

## 1. Per-resource (instance-scoped) agent roles

An agent is **never** given a broad "read all secrets" tenant role. Instead it
is granted a **resource role** against **one specific resource instance**.

- The resource declares **instance-scoped roles** under `roles` (see
  `PermitResourceRoleDef` in `schema.ts`). For `Secret` these are `agent_reader`
  and `approved_release`.
- An agent is assigned a role with `resource_instance: "<ResourceType>:<key>"`
  (e.g. `Secret:card_4242`), scoping the grant to that single instance.
- **Out-of-scope = no assignment = deny.** There is no implicit grant; the PDP
  denies any instance the agent was not explicitly assigned against. The
  backend already fails **closed** on any PDP error (`permission-check.ts`).

Assign / revoke via the shared helpers
(`backend/src/utils/permit/agent-scopes.ts`):

```ts
import { assignAgentScope, revokeAgentScope } from '../utils/permit'

await assignAgentScope({
  agent: 'agent:fuzekeys-broker',
  resourceType: 'Secret',
  resourceKey: 'card_4242',
  tenant: 'org_acme',
})
// later, when the agent should no longer touch this secret at all:
await revokeAgentScope({ agent: 'agent:fuzekeys-broker', resourceType: 'Secret', resourceKey: 'card_4242', tenant: 'org_acme' })
```

`agent_reader` grants the `read` action **only** — never `read_sensitive`.

> The **agent identity** itself (how `agent:…` principals are minted/synced into
> Permit) is defined by the agent-identity issue this work depends on. These
> conventions assume that identity already exists as a Permit user/principal.

---

## 2. Sensitivity tiers (LOW / MEDIUM / HIGH)

Each instance carries a `sensitivity` attribute (declared on the resource;
stored on the resource instance's `attributes` at creation time). It drives
**which action the broker checks**:

| Sensitivity | Action checked   | Granted by                               |
| ----------- | ---------------- | ---------------------------------------- |
| `LOW`       | `read`           | `agent_reader` (in-scope) — auto-release |
| `MEDIUM`    | `read`           | `agent_reader` (in-scope) — auto-release |
| `HIGH`      | `read_sensitive` | `approved_release` only — human approval |

The key rule: **`read_sensitive` is a separate action that the in-scope role
does NOT grant.** LOW/MEDIUM auto-release because `agent_reader` carries `read`.
HIGH cannot be satisfied until a time-boxed `approved_release` role is assigned.

The broker selects the action from the tier with `actionForSensitivity()` and
checks it with `checkAgentRead()`:

```ts
import { checkAgentRead } from '../utils/permit'

// broker reads the secret's sensitivity from its own metadata
const allowed = await checkAgentRead(ref, secret.sensitivity /* 'LOW'|'MEDIUM'|'HIGH' */)
```

Storing `sensitivity` on the instance (so it is also available to ABAC / audit):

```ts
import { createAppResourceInstance } from '../utils/permit' // pattern; Secret instances follow the same shape
await permit.api.resourceInstances.create({
  key: 'card_4242',
  tenant: 'org_acme',
  resource: 'Secret',
  attributes: { sensitivity: 'HIGH' },
})
```

---

## 3. Time-boxed `approved_release` role (TTL)

After a human approves a HIGH request, the broker assigns the instance-scoped
`approved_release` role (which grants `read_sensitive`) and **revokes it at
expiry**. Permit does not expire assignments on its own, so **TTL is
broker-enforced**:

```ts
import { grantApprovedRelease, revokeApprovedRelease } from '../utils/permit'

const grant = await grantApprovedRelease(ref, 300 /* ttlSeconds */)
// grant.expiresAt === grant.grantedAt + 300s
// Broker MUST persist expiresAt and schedule revocation:
//   - on its approval/expiry queue (preferred), or
//   - via a sweeper that unassigns any approved_release past expiresAt.
await revokeApprovedRelease(ref) // fired by the broker at (or before) expiresAt
```

**TTL / revocation contract:**

- `grantApprovedRelease` returns `{ grantedAt, expiresAt, ttlSeconds }`. A
  non-positive TTL is refused (returns `null`) — there is no "permanent"
  approval grant.
- The broker is the **system of record for the timer**. It must schedule
  `revokeApprovedRelease` to fire at or before `expiresAt`. If the broker
  restarts, it reconciles by revoking any grant whose `expiresAt` has passed.
- Early revocation (incident / approval withdrawn) is just calling
  `revokeApprovedRelease` before `expiresAt`.
- Revocation is idempotent from the caller's side — a no-op unassign returns
  `true`.

This keeps the **approval queue + notifier in the broker**; Permit only records
the decision as a (transient) role assignment.

---

## Worked example — `check(agent, "read_sensitive", card)`

`card_4242` is a HIGH-sensitivity `Secret`. Lifecycle (verified end-to-end in
`backend/tests/agent-scopes.test.ts`):

1. **In scope, not approved** — agent holds `agent_reader` on `Secret:card_4242`.
   `check(agent, "read_sensitive", card)` → **deny** (`agent_reader` lacks
   `read_sensitive`). `check(agent, "read", lowSecret)` → allow.
2. **Human approves** — broker calls `grantApprovedRelease(ref, 300)`; agent now
   also holds `approved_release` on that instance.
3. **Within TTL** — `check(agent, "read_sensitive", card)` → **allow**.
4. **TTL elapses** — broker calls `revokeApprovedRelease(ref)`.
5. **After expiry** — `check(agent, "read_sensitive", card)` → **deny** again,
   while `agent_reader` survives so LOW/MEDIUM reads still work.

```
deny ──(human approval → grant)──▶ allow ──(TTL elapses → revoke)──▶ deny
```

---

## Schema summary (`backend/src/permit/schema.ts`)

```
Secret:
  actions:    read, read_sensitive
  attributes: sensitivity (string: LOW | MEDIUM | HIGH)
  roles (instance-scoped):
    agent_reader     -> [read]                  # in-scope, non-sensitive
    approved_release -> [read, read_sensitive]  # time-boxed, human-approved
```

The schema is applied idempotently by the existing
`syncPermitSchema` routine (Helm `post-install,post-upgrade` hook), so resource
attributes and instance-scoped roles are kept in sync on every deploy.

## Adopting this pattern for another resource

Copy the `Secret` shape onto your resource:
1. Add a `read` and a default-denied `read_sensitive` action.
2. Declare a `sensitivity` attribute.
3. Declare an in-scope reader resource role (`read` only) and a time-boxed
   `approved_release` resource role (`read`, `read_sensitive`).
4. Reuse `agent-scopes.ts` helpers — they are resource-type agnostic
   (`resourceType` is a parameter).

---

> **Notifications:** @izzywdev is to be @-mentioned on **contract-freeze** of
> these conventions and on **deployment** to the shared Permit env. Until frozen,
> the broker's interim logic stands in for this model.
