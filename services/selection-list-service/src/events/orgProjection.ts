// events/orgProjection.ts - WRITE side of the org projection (`selection_list_ref_index`, migration 9).
//
// Fed by `identity.org.created` (upsert) and `identity.org.deleted` (tombstone). The seed
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
}

/**
 * Upsert the org's projection row from an `identity.org.created` snapshot. A row that is
 * already `deleted` keeps its status (tombstone); the snapshot columns are refreshed either way
 * so a tombstone created by an early `org.deleted` learns the org's type. Returns the org's wire id.
 */
export async function upsertOrgProjection(ex: Knex | Knex.Transaction, snapshot: OrgProjectionSnapshot): Promise<string> {
  const entityId = snapshot.organizationId.toLowerCase();
  const wire = fromUuid('organization', entityId);
  await ex.raw(
    `INSERT INTO selection_list_ref_index (entity_type, entity_id, status, wire_id, org_type, is_active, updated_at)
     VALUES ('organization', ?, 'active', ?, ?, ?, now())
     ON CONFLICT (entity_type, entity_id) DO UPDATE SET
       wire_id    = EXCLUDED.wire_id,
       org_type   = EXCLUDED.org_type,
       is_active  = EXCLUDED.is_active,
       updated_at = now()`,
    [entityId, wire, snapshot.type, snapshot.isActive],
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
