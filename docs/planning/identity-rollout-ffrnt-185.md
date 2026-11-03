# FFRNT-185 — typed-id rollout across the remaining services

Status: **complete — the TypeID wire form is live.** All 28 genuine entity mints
route through `toUuid(mintId(<type>))`, the
three services ship `@izzywdev/fuzefront-identity` in their production images, the
`--source` backstop is **enforcing**, the `fuzefront.identity.prefixed-ids` release
flag is **ON at 100 % in production**, and migration `024_portal_typeid_backfill`
(`backend/src/migrations/`) has shipped, converging the legacy `prt_<hex>` portal
storage form onto a bare `uuid` column rendered as TypeID on the wire.

What is *not* finished, stated precisely so this line cannot be read as "nothing left":

- **Dual-accept windows (`configureIdentity({ legacyUuidTypes })`) are still declared
  open in code** in all three backends (`backend/src/index.ts`,
  `backend/security/src/index.ts`, `backend/applications/src/index.ts`) for
  `organization`, `user`, `app`, `portal`, and in `services/config-service`
  for `portal`, `organization`, `user`. #1142 closed them; #1594 deliberately
  re-opened them for the first three services while the flag was still OFF in
  production (responses were emitting bare UUIDs, and a strict input boundary
  422'd the ids the frontend round-trips). The flag precondition no longer holds,
  so the three backends' windows are now closeable; that is a separate,
  behaviour-changing step (it starts rejecting bare UUIDs) and is tracked as a
  follow-up, not done here. config-service's window has an independent blocker —
  see its comment in `services/config-service/src/index.ts`.
- **Step 3 (`EntityId<T>` in repository signatures) is partial**: only
  `organizationRepository` (security) and `appRepository` (applications) take the
  branded type today; the remaining repositories still accept `string`.
- **The flag itself is retired separately** (see `packages/feature-flags/flag-registry.yaml`
  `removal_criterion`): once the flag is 100 % global the conditional wire-form
  branches are dead code and the TypeID form becomes unconditional.

The "Why this is staged" reasons below record how the rollout was sequenced and
remain the rationale for closing each remaining window one type at a time.

## What the backlog actually is

The headline "41 sites" conflated genuine entity mints with infrastructure row
ids. Classifying each site by the table it writes gives:

| | Count |
|---|---|
| Reported before classification | 44 |
| Infrastructure / non-entity (now allowlisted, with reasons) | 16 |
| **Genuine entity mints remaining** | **28** |

The 16 are outbox rows, provisioning-saga step rows, one-shot credential
artifacts (email verification, password reset, MFA recovery codes), an
in-process Map key, and FuzeQuality's own entities — which namespace under
FuzeQuality's repo, not this registry (identifier-standard.md §2). Each is
listed in `governance/identifier-allowlist.txt` with its reason, and the gate
reports any entry whose line has drifted, so an exemption cannot quietly widen.

This matters beyond tidiness: the backlog number is the only thing standing
between the `--source` backstop and being ratcheted to enforcing. A number that
counts outbox rows can never reach zero, so it can never be ratcheted.

## The remaining 28, by type

| Type | Prefix | Sites | Where |
|---|---|---|---|
| organization | `org` | 5 | `routes/organizations.ts` ×2, `services/organizationProvisioning.ts` ×2, `services/portalProvisioning.ts` ×1 |
| membership | `mbr` | 6 | `organization_memberships` inserts in `routes/invitations.ts`, `routes/organizations.ts`, `services/organizationProvisioning.ts` |
| session | `ses` | 6 | `routes/auth.ts` ×5, `AuthentikIdentityProvider.ts` ×1 |
| invitation | `ivt` | 5 | `routes/organizations.ts` ×4, `services/portalProvisioning.ts` ×1 |
| app | `app` | 4 | `routes/apps.ts` in `backend/` and `backend/applications/` |
| mfaFactor | `mfa` | 1 | `AuthentikIdentityProvider.ts` |
| portal (step rows excluded) | `prt` | 1 | `services/portalProvisioning.ts` |

`invitation`, `membership`, `session` and `mfaFactor` are now registered in both
registries (parity-checked) so the migration is a per-site edit rather than a
registry change per service. `ivt`, not `inv` — invoice already owns `inv`, and
a prefix collision inside one registry would defeat the point of the prefix.

## Why this is staged, and not one sweep

Three things turned up while measuring, and each of them is a reason the ticket
already says "migrate a type, close its window, move to the next".

**1. None of the four services can import the package yet.** `backend`,
`backend/security`, `backend/applications` and `services/chat-service` declare
no dependency on `@izzywdev/fuzefront-identity`.

**2. Adding that dependency is not free — it is a `file:` link, and a `file:`
link is a symlink.** billing-service was **broken on master** for exactly this:
its production image copied `node_modules` but never `packages/identity`, so the
link dangled and the container died at boot on `app.ts`'s top-level import.
`npm install` exits 0 with the target absent, so nothing surfaced it until the
container ran. Fixed in FFRNT-254, but every service that takes this dependency
needs the same production-stage copy, and each of those images is built by
`release.yml` on push to master, where master is deploy-on-push.

**3. `backend/src` and `backend/security/src` are divergent forks mid-extraction**
— `routes/organizations.ts` is 1107 lines in one and 1407 in the other, sharing
most of the migration surface. Migrating one and not the other leaves two
implementations of the same endpoint minting ids two different ways, which is
strictly worse than either state on its own.

## Order of work

Per type, and per service — never a broad sweep.

1. **Wire the dependency, one service at a time.** Add
   `@izzywdev/fuzefront-identity`, add the production-stage copy of
   `packages/identity/{package.json,dist}` to that service's Dockerfile, and
   confirm the image builds in the `image-reproducibility` workflow before any
   site changes. `gate-identifier --adoption` covers the declaration; only a
   real build covers the link.
2. **Migrate one type.** `const organizationId = uuidv4()` becomes
   `const organizationId = toUuid(mintId('organization'))`. The stored value
   stays a native `uuid` column — UUIDv7 instead of v4 — so there is no schema
   change, no wire change, and index locality improves. This step is safe to do
   in bulk *within* a type.
3. **Take `EntityId<T>` in the repository signature** for that type, so a raw
   `string` off `req.body` stops compiling. This is the enforcement that
   matters; the gate is only the backstop.
4. **Then, separately, prefix the wire form.** `usr_…` on the API is the
   breaking half: it needs `configureIdentity({ legacyUuidTypes })` for the
   dual-accept window, coordinated client updates, and a row backfill. Behind
   `fuzefront.identity.prefixed-ids`, default OFF.
5. **Close the window** — drop the type from `legacyUuidTypes` — before starting
   the next type. Do not run two identity models indefinitely: Shopify has
   carried REST-numeric alongside GraphQL GIDs for years and is escaping it only
   by deprecating REST wholesale.
6. **When the count reaches zero, ratchet** the harden-gate `--source` step from
   report-only to enforcing, and delete the `|| true`.

## Suggested order

`app` first — 4 sites, no fork overlap, and `backend/applications` is the
service whose image already uses the proven `npm ci` pattern. Then
`organization` + `membership` + `invitation` together, since they share the
provisioning transaction and splitting them means touching it three times.
`session` last: it is the only one where the id is also an auth-flow handle, so
it deserves its own review rather than being carried along.

## Precedent to fold in

`generatePortalId()` (`backend/src/repositories/portalRepository.ts`) already
mints `prt_<hex>` against `^prt_[A-Za-z0-9]{1,40}$` — a prefixed but non-TypeID
form. `parseId` dual-accepts it today; the backfill should converge it onto the
standard encoding rather than leave a third id format in the tree.
