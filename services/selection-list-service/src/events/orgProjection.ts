// events/orgProjection.ts - WRITE side of the org projection (`selection_list_ref_index`, migration 9).
//
// Fed by `identity.org.created` / `identity.org.updated` (upsert) and `identity.org.deleted` (tombstone). The seed
// library only READS it (`seed/org.ts`): "does this org exist" (ORG_UNKNOWN) and "is it
// dead" (ORG_INACTIVE).
//
// A deleted row is a TOMBSTONE and is never resurrected: the two lifecycle topics are
// different topics in different consumer groups, so `org.deleted` can be processed BEFORE
// (or again AFTER) `org.created`. Both writes are idempotent upserts so redelivery is a no-op.

import type { Knex } from 'knex';
import { fromUuid, toUuid } from '@izzywdev/fuzefront-identity';
import { invalidatePlatformOrgCache } from '../lib/sharedLists';

export interface OrgProjectionSnapshot {
  /** The bare UUID the identity events carry. */
  organizationId: string;
  type: 'platform' | 'organization' | 'personal';
  isActive: boolean;
  /**
   * The org owner as the bare UUID `identity.org.created.ownerId` carries (null = none, e.g. the root
   * org). Stored as the `usr_...` wire id. Only `identity.org.created` supplies it: an existing owner is
   * never erased by a snapshot that lacks one, and `identity.org.updated` deliberately does not move it
   * (grants must not silently follow an ownership change).
   */
  ownerId?: string | null;
  /** The org's display name (created / updated snapshots). */
  name?: string;
  /** Envelope `occurredAt`; a snapshot older than the newest one already applied is ignored. Default: now. */
  occurredAt?: string;
}

/**
 * Upsert the org's projection row from an `identity.org.created` / `identity.org.updated` snapshot. A
 * row that is already `deleted` keeps its status (tombstone: a snapshot never resurrects it); the
 * snapshot columns are refreshed either way so a tombstone created by an early `org.deleted` learns the
 * org's type - unless a NEWER snapshot was already applied (`snapshot_at`), in which case this older one
 * (e.g. a late `org.created` after an `org.updated`) is ignored. Returns the org's wire id.
 */
/**
 * Accepted clock skew of an envelope AHEAD of this service's clock. Env `SELECTION_LIST_EVENT_FUTURE_SKEW_SECONDS`
 * (default 300 = 5 minutes; 0 accepts nothing in the future).
 */
export const DEFAULT_FUTURE_SKEW_SECONDS = 300;
export function futureSkewToleranceMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env['SELECTION_LIST_EVENT_FUTURE_SKEW_SECONDS'];
  const n = raw === undefined || raw.trim() === '' ? NaN : Number(raw);
  return (Number.isFinite(n) && n >= 0 ? n : DEFAULT_FUTURE_SKEW_SECONDS) * 1000;
}

/**
 * Is the envelope dated MORE than the skew tolerance ahead of now? Such an envelope is REJECTED by the org lifecycle
 * handlers (acknowledged, logged at warn with its correlationId, nothing applied): an event cannot have happened in
 * the future, and - unlike a clamp to now, which gives the SAME event a different, later ordering instant on every
 * redelivery - rejection keeps the ordering decision stable. A legitimately skewed producer clock therefore DROPS
 * the event; an operator re-sends it once the clocks agree. Unparseable / absent: false (the schema guarantees a
 * timestamp; such an envelope falls back to now() and never wedges the consumer).
 */
export function isFutureDated(occurredAt: string | undefined | null, now: number = Date.now(), toleranceMs: number = futureSkewToleranceMs()): boolean {
  if (!occurredAt) return false;
  const t = Date.parse(occurredAt);
  return !Number.isNaN(t) && t > now + toleranceMs;
}

/**
 * The ordering instant of an envelope: its ORIGINAL `occurredAt` (never altered, so the value is identical on every
 * delivery - within the skew tolerance it may be slightly ahead of now, which the handlers have already accepted via
 * `isFutureDated`). Unparseable / absent: null (callers fall back to now()).
 */
export function orderingInstant(occurredAt: string | undefined | null): string | null {
  if (!occurredAt) return null;
  const t = Date.parse(occurredAt);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString();
}

export async function upsertOrgProjection(ex: Knex | Knex.Transaction, snapshot: OrgProjectionSnapshot): Promise<string> {
  const entityId = snapshot.organizationId.toLowerCase();
  const wire = fromUuid('organization', entityId);
  const ownerWire = snapshot.ownerId ? fromUuid('user', snapshot.ownerId.toLowerCase()) : null;
  const ownerUuid = snapshot.ownerId ? snapshot.ownerId.toLowerCase() : null;
  // An unparseable envelope timestamp must never wedge the consumer: fall back to now().
  const occurredAt = orderingInstant(snapshot.occurredAt);
  const stale = `(selection_list_ref_index.snapshot_at IS NOT NULL AND EXCLUDED.snapshot_at < selection_list_ref_index.snapshot_at)`;
  await ex.raw(
    `INSERT INTO selection_list_ref_index (entity_type, entity_id, status, wire_id, org_type, is_active, owner_id, owner_uuid, org_name, snapshot_at, updated_at)
     VALUES ('organization', ?, 'active', ?, ?, ?, ?, ?, ?, COALESCE(?::timestamptz, now()), now())
     ON CONFLICT (entity_type, entity_id) DO UPDATE SET
       wire_id     = EXCLUDED.wire_id,
       org_type    = CASE WHEN ${stale} THEN selection_list_ref_index.org_type  ELSE EXCLUDED.org_type  END,
       is_active   = CASE WHEN ${stale} THEN selection_list_ref_index.is_active ELSE EXCLUDED.is_active END,
       org_name    = CASE WHEN ${stale} THEN selection_list_ref_index.org_name  ELSE COALESCE(EXCLUDED.org_name, selection_list_ref_index.org_name) END,
       owner_id    = COALESCE(EXCLUDED.owner_id, selection_list_ref_index.owner_id),
       owner_uuid  = COALESCE(EXCLUDED.owner_uuid, selection_list_ref_index.owner_uuid),
       snapshot_at = GREATEST(selection_list_ref_index.snapshot_at, EXCLUDED.snapshot_at),
       updated_at  = now()`,
    [entityId, wire, snapshot.type, snapshot.isActive, ownerWire, ownerUuid, snapshot.name ?? null, occurredAt],
  );
  // The platform-org resolution is cached authorization state derived from this row: drop it now. (Callers
  // pass the pool, not an open transaction; inside a transaction this would run before the commit.)
  invalidatePlatformOrgCache();
  return wire;
}

export type SuspendOutcome = 'suspended' | 'already-suspended' | 'stale' | 'tie';

/**
 * Record the platform organization's WRITE suspension (see platformGuard.ts) - ORDERED by the envelope time.
 *   - a deactivation OLDER than the newest snapshot already applied (`snapshot_at`) is STALE and ignored (a late
 *     `org.created{inactive}` after a newer active `org.updated` must not suspend);
 *   - a deactivation at EXACTLY the same instant as the newest snapshot is a TIE and ignored: ties go to ACTIVE
 *     (an activation and a deactivation can never both win; the one that fails open is recoverable, a suspension
 *     that nothing will ever clear is not, and a forged event cannot manufacture a tie without knowing the instant);
 *   - otherwise `suspended_at` is set (first time wins) and `suspended_event_at` records the deactivation's instant
 *     (the later wins), the clock a later activation is compared with. `snapshot_at` is NOT touched (an early
 *     deactivation must not make the org's own, older `org.created` look stale and keep it untyped).
 * Nothing else about the row changes - never a tombstone, never `is_active`, never its type - so reads stay available.
 * Inserts a typeless active row when the org is not projected yet (its reads are unconfirmed anyway).
 */
export async function suspendOrgProjection(
  ex: Knex | Knex.Transaction,
  organizationId: string,
  occurredAt?: string,
): Promise<SuspendOutcome> {
  // identity events carry the bare UUID (schema-enforced); an `org_...` TypeID is tolerated so the guard works for either
  const entityId = organizationId.startsWith('org_') ? toUuid(organizationId as never) : organizationId.toLowerCase();
  const wire = fromUuid('organization', entityId);
  const at = orderingInstant(occurredAt) ?? new Date().toISOString();
  const before = await ex('selection_list_ref_index').where({ entity_type: 'organization', entity_id: entityId }).first('suspended_at', 'snapshot_at');
  if (before?.snapshot_at) {
    const newest = new Date(before.snapshot_at).getTime();
    const t = new Date(at).getTime();
    if (t < newest) return 'stale';
    if (t === newest) return 'tie';
  }
  await ex.raw(
    `INSERT INTO selection_list_ref_index (entity_type, entity_id, status, wire_id, suspended_at, suspended_event_at, updated_at)
     VALUES ('organization', ?, 'active', ?, now(), ?::timestamptz, now())
     ON CONFLICT (entity_type, entity_id) DO UPDATE SET
       wire_id            = COALESCE(selection_list_ref_index.wire_id, EXCLUDED.wire_id),
       suspended_at       = COALESCE(selection_list_ref_index.suspended_at, EXCLUDED.suspended_at),
       suspended_event_at = GREATEST(selection_list_ref_index.suspended_event_at, EXCLUDED.suspended_event_at),
       updated_at         = now()
     WHERE selection_list_ref_index.snapshot_at IS NULL OR selection_list_ref_index.snapshot_at < EXCLUDED.suspended_event_at`,
    [entityId, wire, at],
  );
  return before?.suspended_at ? 'already-suspended' : 'suspended';
}

/**
 * Clear the suspension on a legitimate re-activation snapshot (`is_active=true`, type `platform`). Ordered: it
 * resumes only if the activation is NOT OLDER than the deactivation that suspended (`suspended_event_at`); at the
 * same instant the activation wins (see `suspendOrgProjection`). A stale activation therefore cannot resume a newer
 * deactivation. Returns true when something was resumed.
 */
export async function resumeOrgProjection(ex: Knex | Knex.Transaction, organizationId: string, occurredAt: string | undefined): Promise<boolean> {
  const entityId = organizationId.startsWith('org_') ? toUuid(organizationId as never) : organizationId.toLowerCase();
  const when = orderingInstant(occurredAt);
  const res = await ex.raw(
    `UPDATE selection_list_ref_index
        SET suspended_at = NULL, suspended_event_at = NULL, updated_at = now()
      WHERE entity_type = 'organization' AND entity_id = ? AND suspended_at IS NOT NULL
        AND (suspended_event_at IS NULL OR suspended_event_at <= COALESCE(?::timestamptz, now()))
      RETURNING 1`,
    [entityId, when],
  );
  return Boolean((res as { rows?: unknown[] }).rows?.length);
}

/**
 * Tombstone the org (insert a `deleted` row if it was never seen). Idempotent; never
 * reverts to `active`. Call BEFORE cascading so a concurrent/late seed is refused with ORG_INACTIVE.
 */
export async function markOrgProjectionDeleted(ex: Knex | Knex.Transaction, organizationId: string): Promise<string> {
  const entityId = organizationId.toLowerCase();
  const wire = fromUuid('organization', entityId);
  await ex.raw(
    `INSERT INTO selection_list_ref_index (entity_type, entity_id, status, wire_id, updated_at)
     VALUES ('organization', ?, 'deleted', ?, now())
     ON CONFLICT (entity_type, entity_id) DO UPDATE SET
       status     = 'deleted',
       wire_id    = COALESCE(selection_list_ref_index.wire_id, EXCLUDED.wire_id),
       updated_at = now()`,
    [entityId, wire],
  );
  invalidatePlatformOrgCache(); // see upsertOrgProjection
  return wire;
}
