// seed/platform.ts - seed the platform default packs into one organization (plan sections 7.1, 10).
//
// `applyPlatformDefaults(db, organizationId)` is what the `identity.org.created`
// consumer and the reconciler call (source `platform`, `requestId: null`, trigger
// `org-created` | `backfill`). The caller has already upserted the org into the
// projection and checked the flags; this only applies the packs that apply to the
// org's type and are not deactivated:
//   - a pack whose `appliesTo` excludes the org's type (e.g. the root `platform` org)
//     is skipped silently - no ledger row, no event (S4);
//   - an org the projection marks `isActive: false` is skipped (S3: "no ledger row,
//     log"); a DELETED org is NOT skipped here: the algorithm refuses it with
//     ORG_INACTIVE and records seed.failed (S6);
//   - an org the projection does not know yet falls through to the algorithm, which
//     answers ORG_UNKNOWN (retryable).
// After the packs, the org owner is granted list-owner on the seeded lists (ownerGrants.ts, after the
// seed transactions committed; throws on a transient grant failure). Packs are applied in (packKey)
// order, one transaction each (one pack = one
// request = one outcome event).

import type { Knex } from 'knex';
import { PLATFORM_SEED_SOURCE, SELECTION_LIST_SERVICE_PRINCIPAL } from '@fuzefront/shared/kafka';
import { logger } from '../lib/logger';
import { applySeedRequest } from './apply';
import { readOrgProjection } from './org';
import { ensureSeededListOwners, type EnsureSeededListOwnersOptions } from './ownerGrants';
import { currentPlatformPacks, DEFAULT_PLATFORM_PACK_DIR, loadPlatformPack } from './packs';
import type { SeedResult, SeedTrigger } from './types';

export interface ApplyPlatformDefaultsOptions {
  /** 'org-created' (default) from the identity.org.created consumer, 'backfill' from the reconciler. */
  trigger?: Extract<SeedTrigger, 'org-created' | 'backfill'>;
  correlationId?: string;
  /** Forwarded to `applySeedRequest` (default 'record'); a consumer passes 'throw' so a transient fault is retried. */
  internalErrors?: 'record' | 'throw';
  /** Pack directory override (tests); default is the shipped `seed-packs/platform`. */
  packDir?: string;
  /** Seam for tests: the list-owner grant call (default: the production `grantListOwner`, machine identity, fail closed). */
  grantListOwner?: EnsureSeededListOwnersOptions['grantListOwner'];
}

export interface PlatformSeedOutcome {
  packKey: string;
  version: number;
  /** The algorithm's result, absent when the pack was skipped before running it. */
  result?: SeedResult;
  skipped?: 'not-applicable' | 'org-inactive';
}

export async function applyPlatformDefaults(
  db: Knex,
  organizationId: string,
  options: ApplyPlatformDefaultsOptions = {},
): Promise<PlatformSeedOutcome[]> {
  const proj = await readOrgProjection(db, organizationId);
  const packs = currentPlatformPacks(options.packDir ?? DEFAULT_PLATFORM_PACK_DIR);
  const outcomes: PlatformSeedOutcome[] = [];
  for (const pack of packs) {
    if (proj && proj.status === 'active' && proj.isActive === false) {
      logger.info({ organizationId, pack: pack.packKey }, 'seed: platform pack skipped, organization is inactive');
      outcomes.push({ packKey: pack.packKey, version: pack.version, skipped: 'org-inactive' });
      continue;
    }
    if (proj && proj.orgType && !pack.appliesTo.includes(proj.orgType)) {
      logger.info({ organizationId, pack: pack.packKey, orgType: proj.orgType }, 'seed: platform pack does not apply to this organization type');
      outcomes.push({ packKey: pack.packKey, version: pack.version, skipped: 'not-applicable' });
      continue;
    }
    const result = await applySeedRequest(db, {
      organizationId,
      scope: 'org',
      source: { app: PLATFORM_SEED_SOURCE, service: SELECTION_LIST_SERVICE_PRINCIPAL },
      pack: { key: pack.packKey, version: pack.version },
      trigger: options.trigger ?? 'org-created',
      requestId: null,
      lists: pack.lists,
      translationProvenance: pack.translationProvenance,
      correlationId: options.correlationId,
      internalErrors: options.internalErrors,
    });
    outcomes.push({ packKey: pack.packKey, version: pack.version, result });
  }

  // The seed transactions have all committed (or were already applied / refused). Now - and only now,
  // because it is an external call - make the org owner a list-owner of the seeded lists (decision Q3).
  // Runs on EVERY call, including when every pack was already-applied, so a grant that failed on an
  // earlier delivery is healed by the retry. A failure throws: the consumer is retried / the reconciler
  // backs the org off; the seed itself is idempotent. A missing owner is a logged skip, never an error.
  await ensureSeededListOwners(db, organizationId, {
    grantListOwner: options.grantListOwner,
    correlationId: options.correlationId,
  });
  return outcomes;
}

export { loadPlatformPack };
