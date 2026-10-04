// seed/org.ts - read side of the org projection (`selection_list_ref_index`, migration 9).
//
// The projection is FED by the identity.org.created / .deleted consumers (a later
// stream); the seed algorithm only READS it, to answer "does this org exist"
// (ORG_UNKNOWN, retryable: the create may not have been consumed yet) and "is it dead"
// (ORG_INACTIVE: the org-deleted handler marks the projection deleted BEFORE it
// cascades, so a late create can never resurrect lists in a deleted org).

import type { Knex } from 'knex';
import { wireOrgId } from '../events/outbox';

export interface OrgProjection {
  status: 'active' | 'deleted';
  orgType: 'platform' | 'organization' | 'personal' | null;
  /** From the identity.org.created snapshot; null when unknown. */
  isActive: boolean | null;
  /** The org owner's wire id (`usr_...`) from identity.org.created; null when unknown / none. */
  ownerId: string | null;
}

/** The org's projection row, or null when the org is not (yet) known. */
export async function readOrgProjection(ex: Knex | Knex.Transaction, organizationId: string): Promise<OrgProjection | null> {
  const wire = wireOrgId(organizationId);
  const row = await ex('selection_list_ref_index').where({ entity_type: 'organization', wire_id: wire }).first('status', 'org_type', 'is_active', 'owner_id');
  if (!row) return null;
  return { status: row.status, orgType: row.org_type ?? null, isActive: row.is_active ?? null, ownerId: row.owner_id ?? null };
}
