// seed/index.ts - the seed library's public surface (plan sections 7-10).
// The Kafka consumers (identity.org.created, selection-lists.seed.requested) and the
// reconciler call these; nothing here reads Kafka.

export { applySeedRequest, recordSeedFailure } from './apply';
export { applyPlatformDefaults, type ApplyPlatformDefaultsOptions, type PlatformSeedOutcome } from './platform';
export { isSeedingEnabled } from './flagGate';
export {
  isReconcilerEnabled,
  loadReconcilerConfig,
  ReconcilerBackoff,
  RECONCILER_DEFAULTS,
  runReconcilerOnce,
  startReconciler,
  type ReconcilerConfig,
  type ReconcilerHandle,
  type ReconcilerRunOptions,
  type ReconcilerRunSummary,
} from './reconciler';
export { readOrgProjection, type OrgProjection } from './org';
export {
  currentPlatformPacks,
  DEFAULT_PLATFORM_PACK_DIR,
  loadPlatformPack,
  loadPlatformPacks,
  SeedPackError,
  type PlatformPack,
  type PlatformPackContent,
  type TranslationProvenance,
} from './packs';
export {
  DEFAULT_SEED_SOURCES_FILE,
  loadSeedSources,
  parseSeedSources,
  readSeedSource,
  SEED_ATTESTATION_SCOPE,
  seedSourcesFileSchema,
  SeedSourcesFileError,
  syncSeedSources,
  type SeedSourceDefinition,
} from './sources';
export { refreshItemUserModified, refreshListUserModified } from './content';
export { canonicalJson, hashCanonical } from './canonical';
export {
  SEED_FAILURE_RETRYABLE,
  SEED_PRINCIPAL,
  SeedFailure,
  type SeedApplyRequest,
  type SeedCompleted,
  type SeedFailed,
  type SeedFailureDetail,
  type SeedFailureReason,
  type SeedListResult,
  type SeedOutcome,
  type SeedResult,
  type SeedTrigger,
} from './types';

import type { Knex } from 'knex';
import { logger } from '../lib/logger';
import { loadPlatformPacks } from './packs';
import { loadSeedSources, syncSeedSources } from './sources';

/**
 * Boot-time check (plan sections 8 and 10): validate every shipped platform pack and
 * the seed-sources file, then sync the allowlist into `selection_list_seed_sources`.
 * Throws on an invalid file - the service refuses to start rather than fail on the
 * first org. Idempotent. Call after migrations.
 */
export async function initSeeding(db: Knex): Promise<void> {
  const packs = loadPlatformPacks();
  const sources = loadSeedSources();
  const synced = await syncSeedSources(db, sources);
  logger.info(
    { packs: packs.map((p) => `${p.pack.packKey}@${p.pack.version}`), sources: synced.upserted, disabled: synced.disabled },
    'seed packs validated and seed-source allowlist synced',
  );
}
