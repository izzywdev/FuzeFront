// bootstrapHarvest.ts — Phase 2 reference-implementation harvest: on
// startup, re-reads the specs this repo's own build baked into the image
// (scripts/collect-devportal-specs.mjs -> specs/manifest.json) and upserts
// each into the registry. Idempotent (registry.upsertSpec is an upsert on
// [repo, service]) — safe to run on every pod start, including a restart
// with no spec changes.
//
// This is the BOOTSTRAP path only. The steady-state path for any repo
// (including this one, going forward) is the PUSH endpoint
// (routes/specs.ts, POST /internal/specs) a repo's own CI calls on merge —
// see docs/planning/developers-portal.md §4.2. Bootstrap exists so the
// catalog is non-empty from the very first deploy, before any repo's CI has
// had a chance to push.

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { upsertSpec } from './registry';

interface ManifestEntry {
  repo: string;
  service: string;
  specPath: string;
  file: string;
}

export async function runBootstrapHarvest(): Promise<{ harvested: number; failed: number }> {
  const specsDir = join(__dirname, '../../specs');
  const manifestPath = join(specsDir, 'manifest.json');

  if (!existsSync(manifestPath)) {
    console.log('[devportal-service] No bundled specs/manifest.json found — skipping bootstrap harvest.');
    return { harvested: 0, failed: 0 };
  }

  const manifest: ManifestEntry[] = JSON.parse(readFileSync(manifestPath, 'utf8'));
  let harvested = 0;
  let failed = 0;

  for (const entry of manifest) {
    try {
      const specYaml = readFileSync(join(specsDir, entry.file), 'utf8');
      await upsertSpec({
        repo: entry.repo,
        service: entry.service,
        specPath: entry.specPath,
        specYaml,
      });
      harvested += 1;
    } catch (err) {
      failed += 1;
      // Constant format string + arg (Semgrep unsafe-formatstring): entry.service
      // is repo-generated (scripts/collect-devportal-specs.mjs), but interpolating
      // it into the format string itself would still let a stray %s/%d in a future
      // service name forge the rest of the log line.
      console.error('[devportal-service] Bootstrap harvest failed for %s:', entry.service, err);
    }
  }

  return { harvested, failed };
}
