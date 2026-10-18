// services/authority.ts — keeping the Security API (the AUTHORITY) and the
// `selection_list_access` mirror honest with each other (review M-2 / L-5).
//
// The mirror is a read model. The Security API decides who may do what. Three
// helpers live here because three routes/handlers need the same behaviour and a
// hand-rolled copy in each is how the two drift:
//
//   hasConfirmedOtherOwner  the last-owner guard, asked of the AUTHORITY.
//   restoreAuthority        compensate a Security API write whose surrounding
//                           transaction (or a later call) failed.
//   revokeInstanceGrants    best-effort, idempotent revocation of grants on one
//                           list instance (purge, deleted user).
//
// WHICH CREDENTIAL. The workload identity (lib/machineIdentity.ts) is NOT a
// grant administrator: the Security API lets it bootstrap an owner and revoke the
// grants of a principal that is provably gone, nothing else. So:
//   - role-change compensation and purge cleanup run inside a request a human
//     made: they use THAT human's token and the Security API re-checks the
//     exact-instance policy (`manage_access`) on every write;
//   - `identity.user.deleted` has no human: it uses the workload token, which the
//     Security API accepts only because the subject's user row / membership shows
//     the principal is gone;
//   - a purge grant the human token cannot remove (the grantee left the tenant,
//     which the Security API will not revoke for a human) falls back to that same
//     gone-principal workload path. A live member's grant is never removable with it.
//
// WHY THE GUARD ASKS THE AUTHORITY. Counting mirror rows answers "how many rows
// say list-owner", not "how many people can still administer this list". They
// disagree after a failed role change, a deleted user, a purge, or a direct
// Security API revoke. The guard therefore takes the mirror's owner rows only as
// CANDIDATES (the Security API cannot enumerate an instance's holders, only
// answer for a named subject) and requires at least one OTHER candidate that the
// authority confirms. `manage_access` is the probe: in the policy schema it is
// held by `list-owner` alone, and no tenant role confers any SelectionList
// action (backend/src/permit/schema.ts). If that ever changes (an org-admin ->
// list-owner derivation) the probe reads as "someone can still administer the
// list", which is the invariant the guard exists to protect.
//
// FAIL CLOSED. A Security API outage reaches this code either as a thrown
// AuthzError (the client raises on transport failure) — the route answers 500 —
// or as an all-deny (the HTTP boundary answers `{allow:false}` for a PDP error).
// The latter reads as "no other confirmed owner", so the demotion/revoke is
// refused with 409: a refused destructive change is the safe direction. The
// guard never heals the mirror from a deny, precisely because a transient deny
// is indistinguishable from a real one.

import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { getAuthzClient, SELECTION_LIST_RESOURCE } from '../middleware/authz';
import { canonicalUserId } from '../lib/sharedLists';
import {
  authzCompensationTotal,
  grantCleanupFailedTotal,
  ownerDriftTotal,
} from '../lib/metrics';

type Executor = Knex | Knex.Transaction;

/** The Security API's bulk-check ceiling (backend/security/src/routes/authz.ts BULK_MAX_CHECKS). */
const BULK_CHECK_MAX = 200;

/** The action only `list-owner` holds on a list instance. */
export const OWNER_PROBE_ACTION = 'manage_access';

export interface OtherOwnerQuery {
  executor: Executor;
  listId: string;
  orgId: string;
  /** Every stored rendering of the user being demoted/removed (excluded from the candidates). */
  excludeUserIds: string[];
  /** Bearer for the decision calls (the caller's, or the workload token when there is no caller). */
  token: string;
  log: Logger;
}

/**
 * True iff at least one list-owner OTHER than `excludeUserIds` is confirmed by
 * the Security API as still able to administer the list. Stops at the first
 * confirming chunk (the guard needs existence, not a census).
 */
export async function hasConfirmedOtherOwner(q: OtherOwnerQuery): Promise<boolean> {
  const excluded = new Set(q.excludeUserIds);
  const rows = (await q
    .executor('selection_list_access')
    .where({ list_id: q.listId, role: 'list-owner' })
    .whereNull('revoked_at')
    .select('user_id', 'org_id')) as Array<{ user_id: string; org_id: string | null }>;
  // Each owner is confirmed in the tenant its grant was made in (the mirror's `org_id`): the grant tenant is
  // whatever the granting token carried, which need not be the rendering this caller (or the stored list)
  // uses. Legacy rows without it fall back to the caller's tenant.
  const grantTenant = new Map(rows.map((r) => [r.user_id, r.org_id ?? q.orgId]));
  // Owners are counted per LOGICAL user, not per row: a pre-upgrade list can hold rows for BOTH renderings of one
  // user (bare UUID and `usr_...`); they are one owner, confirmed once (both render to the same Permit key).
  const seenOwner = new Set<string>();
  const candidates = rows
    .map((r) => r.user_id)
    .filter((u) => !excluded.has(u))
    .filter((u) => {
      const logical = canonicalUserId(u) ?? u;
      if (seenOwner.has(logical)) return false;
      seenOwner.add(logical);
      return true;
    });

  if (candidates.length === 0) {
    q.log.info({ listId: q.listId, candidates: 0 }, 'last-owner guard: no other list-owner in the mirror');
    return false;
  }

  let drifted = 0;
  for (let i = 0; i < candidates.length; i += BULK_CHECK_MAX) {
    const chunk = candidates.slice(i, i + BULK_CHECK_MAX);
    const decisions = await getAuthzClient().bulkCheck(
      chunk.map((subject) => ({
        subject,
        tenant: grantTenant.get(subject) ?? q.orgId,
        resource: { type: SELECTION_LIST_RESOURCE, key: q.listId },
        action: OWNER_PROBE_ACTION,
      })),
      q.token,
    );
    const confirmed = chunk.filter((_, j) => decisions[j]?.allow === true).length;
    drifted += chunk.length - confirmed;
    if (confirmed > 0) {
      if (drifted > 0) {
        ownerDriftTotal.inc(drifted);
        q.log.warn({ listId: q.listId, drifted }, 'last-owner guard: mirror owner rows the Security API does not confirm');
      }
      return true;
    }
  }

  ownerDriftTotal.inc(drifted);
  q.log.warn(
    { listId: q.listId, candidates: candidates.length, drifted },
    'last-owner guard: no other list-owner is confirmed by the Security API — refusing',
  );
  return false;
}

// ---------------------------------------------------------------------------
// Compensation
// ---------------------------------------------------------------------------

/**
 * What a handler has ATTEMPTED against the authority. Set BEFORE each call: a
 * transport error does not tell us whether the server applied the write, so a
 * failed call is treated as possibly-applied and compensated (both compensating
 * writes are idempotent).
 */
export interface AuthorityWrites {
  revokeAttempted: boolean;
  grantAttempted: boolean;
}

export interface RestoreQuery {
  op: 'put' | 'delete';
  subject: string;
  tenant: string;
  listId: string;
  /** The role the user held before this request (from the mirror); null = none. */
  prior: string | null;
  /** The role this request tried to grant; null for DELETE. */
  target: string | null;
  /**
   * Further grants this request revoked, beyond `prior`: a user whose mirror holds SEVERAL live rows (both renderings
   * of the id, possibly with different roles) is one logical grant group; each distinct role the request revoked is
   * re-granted here (with the subject and tenant it was recorded under) after the standard steps.
   */
  alsoRestore?: Array<{ subject: string; tenant: string; role: string }>;
  writes: AuthorityWrites;
  /**
   * The acting human's token. Compensation re-applies what that human just changed,
   * so the Security API re-checks their `manage_access` on the instance; this
   * service holds no standing to repair a role by itself.
   */
  token: string;
  log: Logger;
}

/**
 * Put the authority back to the user's prior role after a failed change.
 * Each step is independent and best-effort: a failure is logged at ERROR and
 * counted (`outcome="failed"` -> alert) but NEVER thrown, so it cannot mask the
 * error that triggered it. After a failed compensation the authority and the
 * mirror disagree; the owner guard (hasConfirmedOtherOwner) is what keeps that
 * from inflating an owner count.
 */
export async function restoreAuthority(q: RestoreQuery): Promise<void> {
  const resource = { type: SELECTION_LIST_RESOURCE, key: q.listId };
  const steps: Array<{ name: string; run: () => Promise<unknown> }> = [];

  // 1. Drop the NEW role first, so the compensation never leaves more access
  //    than the user started with.
  if (q.writes.grantAttempted && q.target && q.target !== q.prior) {
    steps.push({
      name: 'revoke-new-role',
      run: () =>
        getAuthzClient().revoke(
          { subject: q.subject, tenant: q.tenant, role: q.target as string, resource },
          q.token,
        ),
    });
  }
  // 2. Re-grant the role the revoke may have removed.
  if (q.writes.revokeAttempted && q.prior) {
    steps.push({
      name: 'regrant-prior-role',
      run: () =>
        getAuthzClient().grant(
          { subject: q.subject, tenant: q.tenant, role: q.prior as string, resource },
          q.token,
        ),
    });
  }

  if (q.writes.revokeAttempted) {
    for (const g of q.alsoRestore ?? []) {
      steps.push({
        name: 'regrant-group-role',
        run: () => getAuthzClient().grant({ subject: g.subject, tenant: g.tenant, role: g.role, resource }, q.token),
      });
    }
  }

  for (const step of steps) {
    try {
      await step.run();
      authzCompensationTotal.inc({ op: q.op, outcome: 'restored' });
      q.log.warn({ listId: q.listId, step: step.name, op: q.op }, 'compensated a failed access change in the Security API');
    } catch (err) {
      authzCompensationTotal.inc({ op: q.op, outcome: 'failed' });
      q.log.error(
        { err, listId: q.listId, step: step.name, op: q.op, prior: q.prior, target: q.target },
        'COMPENSATION FAILED: the Security API and selection_list_access now disagree for this user/list',
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Bulk, idempotent revocation (purge / deleted user)
// ---------------------------------------------------------------------------

export interface InstanceGrant {
  user_id: string;
  role: string;
  /** The tenant the grant was made in (the mirror's `org_id`); absent on legacy rows => the query's `orgId`. */
  org_id?: string | null;
}

export interface RevokeInstanceQuery {
  orgId: string;
  listId: string;
  grants: InstanceGrant[];
  /** Primary credential: the acting human's (purge) or the cleanup workload's (user deleted). */
  token: string;
  /**
   * Optional second attempt for a grant the primary token was refused: resolves the
   * workload token, which the Security API honours only for a gone principal. Never
   * throws into the loop — a failure to resolve it leaves the grant in `failed`.
   */
  fallbackToken?: () => Promise<string>;
  cause: 'purge' | 'user_deleted';
  log: Logger;
}

/**
 * Revoke each grant on `SelectionList:<listId>`. Revoking an assignment that is
 * already gone is a success at the Security API (idempotent), so re-running
 * after a partial failure is safe. NEVER throws: failures are logged with every
 * field needed to repair by hand (list, user, role), counted, and returned.
 */
export async function revokeInstanceGrants(q: RevokeInstanceQuery): Promise<{ revoked: number; failed: InstanceGrant[] }> {
  let revoked = 0;
  const failed: InstanceGrant[] = [];
  for (const g of q.grants) {
    const revokeWith = (token: string) =>
      getAuthzClient().revoke(
        {
          subject: g.user_id,
          tenant: g.org_id ?? q.orgId, // revoke where the grant was made
          role: g.role,
          resource: { type: SELECTION_LIST_RESOURCE, key: q.listId },
        },
        token,
      );
    try {
      try {
        await revokeWith(q.token);
      } catch (primaryErr) {
        if (!q.fallbackToken) throw primaryErr;
        q.log.debug({ err: primaryErr, listId: q.listId, userId: g.user_id }, 'cleanup: primary revoke refused — trying the gone-principal workload path');
        await revokeWith(await q.fallbackToken());
      }
      revoked++;
    } catch (err) {
      failed.push(g);
      grantCleanupFailedTotal.inc({ cause: q.cause });
      q.log.warn(
        { err, listId: q.listId, orgId: q.orgId, userId: g.user_id, role: g.role, cause: q.cause },
        'could not revoke a Security API grant during cleanup — orphan role assignment left for reconciliation',
      );
    }
  }
  return { revoked, failed };
}
