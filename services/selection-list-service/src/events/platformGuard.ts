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
// It deliberately does NOT trust the projection's `org_type` (a user can create an org of type 'platform'), and it
// does not depend on the shared-lists flag: a platform-visibility row is protected whenever it exists.

import type { Knex } from 'knex';
import { configuredPlatformOrgId, orgRenderings, ROOT_PLATFORM_ORG_WIRE, sameOrg } from '../lib/sharedLists';

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
