// lib/flagIdentity.ts — ONE canonical form for the identities in a flag evaluation context.
//
// WHY. The two release flags are targeted per organization in Unleash with a constraint on the
// `orgId` context field. Two kinds of caller evaluate them:
//
//   - the seeding paths (identity.org.created, selection-lists.seed.requested, the reconciler)
//     only ever hold the org as the WIRE TypeID (`org_…`) — `upsertOrgProjection` returns it;
//   - the HTTP paths used to pass `req.orgId` verbatim, i.e. whatever the JWT claim carried: a
//     TypeID from some token shapes, a bare UUID from others.
//
// An Unleash constraint written against `org_…` therefore matched one path and not the other:
// the seeder would see the flag ON while the API answered 404 for the same org (or vice versa).
//
// DECISION. The canonical form is the WIRE TypeID (`org_…` / `usr_…`): it is the form the
// identity standard mandates on every API/event boundary (governance/identifier-standard.md),
// the form the flag registry documents (the seed-defaults flag is "evaluated per message with
// context { orgId }" where the org is the event's wire id), and what the projection / outbox /
// seed library already use. A bare UUID is converted with the identity package's own codec
// (`fromUuid`), never by string surgery. A value that is neither (an opaque test id, a legacy
// claim) is passed through unchanged: flag evaluation must never throw, and a value we cannot
// canonicalise cannot be made to match anything *more* wrongly than it already would.
//
// Applied in ONE place — `buildContext` in src/flags.ts — so every caller (HTTP gate, quota,
// routes, seeding, reconciler) evaluates the same context for the same org.

import { fromUuid } from '@izzywdev/fuzefront-identity';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function canonical(kind: 'organization' | 'user', raw: string): string {
  if (UUID_RE.test(raw)) {
    try {
      return fromUuid(kind, raw.toLowerCase());
    } catch {
      return raw;
    }
  }
  return raw; // already a TypeID, or opaque: leave untouched
}

/** An organization id (TypeID or bare UUID) as the canonical flag-context `orgId` (`org_…`). */
export function canonicalFlagOrgId(raw: string): string {
  return canonical('organization', raw);
}

/** A user id (TypeID or bare UUID) as the canonical flag-context `userId` (`usr_…`). */
export function canonicalFlagUserId(raw: string): string {
  return canonical('user', raw);
}
