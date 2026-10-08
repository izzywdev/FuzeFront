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
import { fromUuid } from '@izzywdev/fuzefront-identity';

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
export async function upsertOrgProjection(ex: Knex | Knex.Transaction, snapshot: OrgProjectionSnapshot): Promise<string> {
  const entityId = snapshot.organizationId.toLowerCase();
  const wire = fromUuid('organization', entityId);
  const ownerWire = snapshot.ownerId ? fromUuid('user', snapshot.ownerId.toLowerCase()) : null;
  // An unparseable envelope timestamp must never wedge the consumer: fall back to now().
  const occurredAt = snapshot.occurredAt && !Number.isNaN(Date.parse(snapshot.occurredAt)) ? new Date(snapshot.occurredAt).toISOString() : null;
  const stale = `(selection_list_ref_index.snapshot_at IS NOT NULL AND EXCLUDED.snapshot_at < selection_list_ref_index.snapshot_at)`;
  await ex.raw(
    `INSERT INTO selection_list_ref_index (entity_type, entity_id, status, wire_id, org_type, is_active, owner_id, org_name, snapshot_at, updated_at)
     VALUES ('organization', ?, 'active', ?, ?, ?, ?, ?, COALESCE(?::timestamptz, now()), now())
     ON CONFLICT (entity_type, entity_id) DO UPDATE SET
       wire_id     = EXCLUDED.wire_id,
       org_type    = CASE WHEN ${stale} THEN selection_list_ref_index.org_type  ELSE EXCLUDED.org_type  END,
       is_active   = CASE WHEN ${stale} THEN selection_list_ref_index.is_active ELSE EXCLUDED.is_active END,
       org_name    = CASE WHEN ${stale} THEN selection_list_ref_index.org_name  ELSE COALESCE(EXCLUDED.org_name, selection_list_ref_index.org_name) END,
       owner_id    = COALESCE(EXCLUDED.owner_id, selection_list_ref_index.owner_id),
       snapshot_at = GREATEST(selection_list_ref_index.snapshot_at, EXCLUDED.snapshot_at),
       updated_at  = now()`,
    [entityId, wire, snapshot.type, snapshot.isActive, ownerWire, snapshot.name ?? null, occurredAt],
  );
  return wire;
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
  return wire;
}
