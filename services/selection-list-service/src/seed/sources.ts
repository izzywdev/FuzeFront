// seed/sources.ts - the seed-source allowlist (plan section 8).
//
// Source of truth: the REVIEWED FILE `services/selection-list-service/seed-sources.json`
// (adding a source is a PR, reviewed like any other code). It is schema-validated at
// boot and synced into `selection_list_seed_sources` (migration 7), which is what the
// seed algorithm READS at runtime: upsert rows present in the file, DISABLE (never
// delete) rows missing from it, so audit provenance keeps resolving.
//
// `platform` is the service's own source. It appears in the file (kind "internal") so
// the allowlist is one complete reading of who may seed, but it is never a table row
// (the table CHECKs `app <> 'platform'`): platform seeding is not attested and not
// namespaced; it is the service seeding its own reviewed packs.
//
// An app source carries:
//   allowedSubjects      introspected token `subject`s allowed to seed for this app
//                        (else SOURCE_NOT_ALLOWED)
//   keyPrefixes          allowed list-key namespaces; default ["<app>-"] (else
//                        NAMESPACE_VIOLATION)
//   maxListsPerRequest / maxItemsPerRequest   <= the contract caps 20 / 2000 (else
//                        LIMIT_EXCEEDED)
//   enabled              kill switch for one source
// and every app request is authenticated by a short-lived `client_credentials` token
// carrying scope `selection-lists:seed` (SEED_ATTESTATION_SCOPE); verifying that token
// is the consumer's job (introspection), the outcome (`attestedSubject`) is an input
// to the library.

import fs from 'fs';
import path from 'path';
import type { Knex } from 'knex';
import { z } from 'zod';
import { PLATFORM_SEED_SOURCE, SELECTION_LIST_LIMITS, slSlugV1 } from '@fuzefront/shared/kafka';

export const SEED_ATTESTATION_SCOPE = 'selection-lists:seed';

/** `<service>/seed-sources.json`, resolved the same from src/ (ts-jest) and dist/ (compiled). */
export const DEFAULT_SEED_SOURCES_FILE = path.resolve(__dirname, '..', '..', 'seed-sources.json');

const keyPrefix = z.string().min(1).max(63).regex(/^[a-z0-9][a-z0-9-]*$/, 'key prefix must be lowercase alphanumerics and hyphens');

const appSourceSchema = z
  .object({
    app: slSlugV1.refine((a) => a !== PLATFORM_SEED_SOURCE, { message: `"${PLATFORM_SEED_SOURCE}" is reserved` }),
    allowedSubjects: z.array(z.string().min(1).max(255)).min(1),
    keyPrefixes: z.array(keyPrefix).min(1).optional(),
    maxListsPerRequest: z.number().int().min(1).max(SELECTION_LIST_LIMITS.MAX_LISTS_PER_SEED),
    maxItemsPerRequest: z.number().int().min(1).max(SELECTION_LIST_LIMITS.MAX_ITEMS_PER_SEED),
    enabled: z.boolean().default(true),
  })
  .strict();

const platformSourceSchema = z
  .object({
    app: z.literal(PLATFORM_SEED_SOURCE),
    kind: z.literal('internal'),
    maxListsPerRequest: z.number().int().min(1).max(SELECTION_LIST_LIMITS.MAX_LISTS_PER_SEED),
    maxItemsPerRequest: z.number().int().min(1).max(SELECTION_LIST_LIMITS.MAX_ITEMS_PER_SEED),
    enabled: z.boolean().default(true),
  })
  .strict();

export const seedSourcesFileSchema = z
  .object({
    version: z.literal(1),
    attestationScope: z.literal(SEED_ATTESTATION_SCOPE),
    sources: z.array(z.union([platformSourceSchema, appSourceSchema])),
  })
  .strict()
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    file.sources.forEach((s, i) => {
      if (seen.has(s.app)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sources', i, 'app'], message: `duplicate source "${s.app}"` });
      }
      seen.add(s.app);
    });
  });

export interface SeedSourceDefinition {
  app: string;
  /** "internal" = the platform source (never attested, not namespaced, not a table row). */
  kind: 'internal' | 'app';
  allowedSubjects: string[];
  keyPrefixes: string[];
  maxListsPerRequest: number;
  maxItemsPerRequest: number;
  enabled: boolean;
}

export class SeedSourcesFileError extends Error {
  readonly code = 'SEED_SOURCES_INVALID';
  constructor(
    readonly file: string,
    readonly issues: string[],
  ) {
    super(`seed sources file ${file} is invalid: ${issues.join('; ')}`);
    this.name = 'SeedSourcesFileError';
  }
}

/** Validate and normalise a parsed seed-sources document (defaults applied). */
export function parseSeedSources(doc: unknown, file = '(inline)'): SeedSourceDefinition[] {
  const parsed = seedSourcesFileSchema.safeParse(doc);
  if (!parsed.success) {
    throw new SeedSourcesFileError(
      file,
      (parsed as z.SafeParseError<unknown>).error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }
  return parsed.data.sources.map((s): SeedSourceDefinition =>
    s.app === PLATFORM_SEED_SOURCE
      ? {
          app: s.app,
          kind: 'internal',
          allowedSubjects: [],
          keyPrefixes: [],
          maxListsPerRequest: s.maxListsPerRequest,
          maxItemsPerRequest: s.maxItemsPerRequest,
          enabled: s.enabled,
        }
      : {
          app: s.app,
          kind: 'app',
          allowedSubjects: (s as z.infer<typeof appSourceSchema>).allowedSubjects,
          keyPrefixes: (s as z.infer<typeof appSourceSchema>).keyPrefixes ?? [`${s.app}-`],
          maxListsPerRequest: s.maxListsPerRequest,
          maxItemsPerRequest: s.maxItemsPerRequest,
          enabled: s.enabled,
        },
  );
}

/** Read + validate `seed-sources.json`. Throws `SeedSourcesFileError` (the service refuses to boot). */
export function loadSeedSources(file: string = DEFAULT_SEED_SOURCES_FILE): SeedSourceDefinition[] {
  let doc: unknown;
  try {
    doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new SeedSourcesFileError(file, [`cannot read/parse: ${(err as Error).message}`]);
  }
  return parseSeedSources(doc, file);
}

/**
 * Sync the file into `selection_list_seed_sources`: upsert every APP source in the
 * file, disable (never delete) every row the file no longer lists. One transaction.
 * Returns what it did, for the boot log.
 */
export async function syncSeedSources(
  db: Knex,
  sources: SeedSourceDefinition[] = loadSeedSources(),
): Promise<{ upserted: string[]; disabled: string[] }> {
  const apps = sources.filter((s) => s.kind === 'app');
  return db.transaction(async (trx) => {
    for (const s of apps) {
      await trx.raw(
        `INSERT INTO selection_list_seed_sources
           (app, allowed_subjects, key_prefixes, max_lists_per_request, max_items_per_request, enabled, updated_at)
         VALUES (?, ?::text[], ?::text[], ?, ?, ?, now())
         ON CONFLICT (app) DO UPDATE SET
           allowed_subjects = EXCLUDED.allowed_subjects,
           key_prefixes = EXCLUDED.key_prefixes,
           max_lists_per_request = EXCLUDED.max_lists_per_request,
           max_items_per_request = EXCLUDED.max_items_per_request,
           enabled = EXCLUDED.enabled,
           updated_at = now()`,
        [s.app, s.allowedSubjects, s.keyPrefixes, s.maxListsPerRequest, s.maxItemsPerRequest, s.enabled],
      );
    }
    const keep = apps.map((s) => s.app);
    const disabledRows = await trx('selection_list_seed_sources')
      .whereNotIn('app', keep)
      .where({ enabled: true })
      .update({ enabled: false, updated_at: trx.fn.now() })
      .returning('app');
    const disabled = (disabledRows as Array<string | { app: string }>).map((r) => (typeof r === 'string' ? r : r.app));
    return { upserted: keep, disabled };
  });
}

/** The runtime allowlist row for an APP source (null if absent). Reads through the caller's trx. */
export async function readSeedSource(ex: Knex | Knex.Transaction, app: string): Promise<SeedSourceDefinition | null> {
  const row = await ex('selection_list_seed_sources').where({ app }).first();
  if (!row) return null;
  return {
    app: row.app,
    kind: 'app',
    allowedSubjects: row.allowed_subjects ?? [],
    keyPrefixes: row.key_prefixes ?? [],
    maxListsPerRequest: row.max_lists_per_request,
    maxItemsPerRequest: row.max_items_per_request,
    enabled: row.enabled,
  };
}
