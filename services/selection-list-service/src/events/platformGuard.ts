// events/platformGuard.ts - the platform organization owns every common (`platform`) list, so the org lifecycle
// consumers must treat it as IMMUTABLE whatever an envelope claims.
//
// Why: every tenant's stored ids for a common list/item resolve through rows owned by the platform org. An
// `identity.org.deleted` (hard cascade) would delete them all, a soft one would archive them, and even a tombstone
// of its projection row (or an `org.updated`/`org.created` snapshot that retypes or deactivates it) makes
// `resolvePlatformOrgId()` return null and takes every common list away from every tenant, bypassing
// `publish_platform`. Producer authentication on the topic is an infrastructure concern (broker ACLs); this is the
// in-service half, so a forged envelope can no longer reach the platform org's data.
//
// Protected = ANY of
//   - the configured platform org (SELECTION_LIST_PLATFORM_ORG_ID), in any rendering of its id;
//   - the root platform organization (ROOT_PLATFORM_ORG_WIRE);
//   - any org that currently OWNS a row with visibility = 'platform' (the fallback when the platform org is not
//     configured: a `platform` row is protected wherever it is).
// Deactivation is split in two effects. READS stay available to every tenant (common lists, resolve, ids) and no
// data is ever deleted, archived or tombstoned for the platform org; WRITES fail closed: a deactivation (an
// `identity.org.deleted` of either cascade, or an `org.updated`/`org.created` with is_active=false) records
// `suspended_at` on the projection row, and the platform-write gates (publish_platform, platform list/item
// mutations, platform purge, platform seeding) refuse while it is set, read fresh per request. A legitimate
// re-activation (`org.updated`/`org.created`, is_active=true, type platform) clears it. A forged event can therefore
// at worst pause platform publishing - a recoverable write-path outage - never break reads or delete data. Retyping
// the platform org away from `platform` is refused outright (no state change).
// It deliberately does NOT trust the projection's `org_type` (a user can create an org of type 'platform'), and it
// does not depend on the shared-lists flag: a platform-visibility row is protected whenever it exists.

import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { configuredPlatformOrgId, orgRenderings, ROOT_PLATFORM_ORG_WIRE, sameOrg } from '../lib/sharedLists';
import { resumeOrgProjection, suspendOrgProjection, type SuspendOutcome } from './orgProjection';
import { lockOrgOutbox } from './outbox';

export async function isProtectedPlatformOrg(ex: Knex | Knex.Transaction, organizationId: string): Promise<boolean> {
  const configured = configuredPlatformOrgId();
  if (configured && sameOrg(organizationId, configured)) return true;
  if (sameOrg(organizationId, ROOT_PLATFORM_ORG_WIRE)) return true;
  const owns = await ex('selection_lists').where({ visibility: 'platform' }).whereIn('organization_id', orgRenderings(organizationId)).first('id');
  return Boolean(owns);
}

/**
 * A snapshot (`identity.org.created` / `identity.org.updated`) that would retype the protected org away from
 * `platform` or deactivate it: refused (it would disable every common list). Anything else (a rename, a
 * reactivation, a repeat of the same type) is harmless and applies.
 */
export function snapshotBreaksPlatformOrg(snapshot: { type: string; isActive: boolean }): boolean {
  return snapshot.type !== 'platform' || snapshot.isActive === false;
}

export interface PlatformEventContext {
  topic: string;
  correlationId: string;
  occurredAt: string;
}

/**
 * Org snapshot handlers call this first. Returns true when the snapshot was about the protected platform org and was
 * HANDLED here (suspended, or refused as a retype) - the caller must then stop. Otherwise false: apply normally.
 */
export async function handlePlatformSnapshot(
  ex: Knex | Knex.Transaction,
  snapshot: { organizationId: string; type: string; isActive: boolean },
  ctx: PlatformEventContext,
  log: Logger,
): Promise<boolean> {
  if (!snapshotBreaksPlatformOrg(snapshot)) return false;
  if (!(await isProtectedPlatformOrg(ex, snapshot.organizationId))) return false;
  const fields = { organizationId: snapshot.organizationId, type: snapshot.type, isActive: snapshot.isActive, eventId: ctx.correlationId, occurredAt: ctx.occurredAt, topic: ctx.topic };
  if (!snapshot.isActive) {
    await recordPlatformDeactivation(ex, snapshot.organizationId, ctx, log, fields);
  } else {
    log.error(fields, 'SECURITY: a snapshot that retypes the PLATFORM organization away from platform was REFUSED; nothing was changed');
  }
  return true;
}

/**
 * A deactivation of the protected platform org (any source: org.deleted soft/hard, org.updated/created inactive):
 * suspends writes unless it is STALE (older than the newest snapshot applied) or ties with it - then it is ignored and
 * logged at warn with the correlationId. Shared by every suspension path so the ordering rule is identical.
 */
export async function recordPlatformDeactivation(
  ex: Knex | Knex.Transaction,
  organizationId: string,
  ctx: PlatformEventContext,
  log: Logger,
  fields: Record<string, unknown> = {},
): Promise<SuspendOutcome> {
  const common = { ...fields, organizationId, eventId: ctx.correlationId, occurredAt: ctx.occurredAt, topic: ctx.topic };
  // Recorded UNDER THE ORG OUTBOX LOCK - the very lock every mutating transaction takes first and then re-checks the
  // suspension under (`assertPlatformWritable`). So a mutation either committed before this recording (and is a
  // legitimate pre-suspension write) or parks on the lock and sees `suspended_at` when it gets it; none can slip
  // between its own check and its commit.
  const outcome = await ex.transaction(async (trx) => {
    await lockOrgOutbox(trx, organizationId);
    return suspendOrgProjection(trx, organizationId, ctx.occurredAt);
  });
  if (outcome === 'stale' || outcome === 'tie') {
    log.warn(
      { ...common, outcome },
      outcome === 'stale'
        ? 'a STALE deactivation of the PLATFORM organization was ignored (an equal-or-newer snapshot was already applied); platform writes are unchanged'
        : 'a deactivation of the PLATFORM organization at the SAME instant as the newest applied snapshot was ignored (ties go to active); platform writes are unchanged',
    );
  } else {
    log.error(
      { ...common, outcome, newlySuspended: outcome === 'suspended' },
      'SECURITY: the PLATFORM organization was reported inactive - platform WRITES are SUSPENDED (publish_platform, platform list/item changes, platform purge, platform seeding); reads/resolve stay available and nothing was deleted. Reactivate with identity.org.updated {isActive:true}',
    );
  }
  return outcome;
}

/** After a normal snapshot was applied: a re-activation of the platform org (active, type platform) clears the suspension. */
export async function resumeIfReactivated(
  ex: Knex | Knex.Transaction,
  snapshot: { organizationId: string; type: string; isActive: boolean },
  ctx: PlatformEventContext,
  log: Logger,
): Promise<void> {
  if (!snapshot.isActive || snapshot.type !== 'platform') return;
  // Same lock as the deactivation recording and every mutation: resume and suspend never interleave with a write.
  const resumed = await ex.transaction(async (trx) => {
    await lockOrgOutbox(trx, snapshot.organizationId);
    return resumeOrgProjection(trx, snapshot.organizationId, ctx.occurredAt);
  });
  if (resumed) {
    log.warn({ organizationId: snapshot.organizationId, eventId: ctx.correlationId, occurredAt: ctx.occurredAt, topic: ctx.topic }, 'the PLATFORM organization was reactivated - platform writes RESUMED');
  }
}
