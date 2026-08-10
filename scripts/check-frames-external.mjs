#!/usr/bin/env node
/**
 * check-frames-external.mjs — enforce the navigable-frames extraction decision.
 *
 * WHY: as of the extraction (2026-08-10, see docs/planning/design-first-ui-pipeline.md's
 * extraction addendum), design/frames/** in THIS repo is frozen to the feature set that
 * existed at extraction time. New features author frames against izzywdev/FuzeX's
 * design-frames-service (REST/MCP/A2A) instead of adding a new
 * design/frames/<feature>/ directory here. This script is the CI enforcement of that:
 * it fails if any feature directory under design/frames/ is not on the frozen
 * allowlist (design/frames/_LEGACY_FEATURES.json).
 *
 * A standing invariant check (every directory present, not a diff of what changed)
 * rather than a diff-based check — simpler to reason about and cannot be bypassed by
 * committing a new directory in an earlier, unchecked commit.
 *
 * Node 20+, stdlib only. Mirrors scripts/stamp-frames.mjs's style.
 */
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const framesDir = path.join(repoRoot, 'design', 'frames');
const allowlistPath = path.join(framesDir, '_LEGACY_FEATURES.json');

async function main() {
  if (!existsSync(framesDir)) {
    console.log('No design/frames/ directory — nothing to check.');
    return;
  }
  if (!existsSync(allowlistPath)) {
    console.error(`Missing ${path.relative(repoRoot, allowlistPath)} — cannot enforce the frozen feature list.`);
    process.exit(1);
  }

  const { legacyFeatures } = JSON.parse(await readFile(allowlistPath, 'utf8'));
  const allowed = new Set(legacyFeatures);

  const entries = await readdir(framesDir, { withFileTypes: true });
  const present = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('_') && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort();

  const disallowed = present.filter((slug) => !allowed.has(slug));

  if (disallowed.length) {
    console.error(
      [
        `${disallowed.length} design/frames/<feature> director${disallowed.length === 1 ? 'y is' : 'ies are'} not on the frozen legacy list:`,
        ...disallowed.map((s) => `  - design/frames/${s}/`),
        '',
        'design/frames/** in this repo was frozen at the navigable-frames extraction',
        '(docs/planning/design-first-ui-pipeline.md). New features author frames against',
        "izzywdev/FuzeX's design-frames-service (REST/MCP/A2A) instead — see that repo's",
        'services/design-frames-service/README.md and scripts/design-frames-client.mjs here.',
        '',
        `If this really is one of the ${legacyFeatures.length} frozen legacy features, add its slug to`,
        'design/frames/_LEGACY_FEATURES.json in the same PR that restores it (e.g. after a revert).',
      ].join('\n')
    );
    process.exit(1);
  }

  const missing = legacyFeatures.filter((slug) => !present.includes(slug));
  if (missing.length) {
    console.warn(`Note: ${missing.length} legacy feature(s) listed in _LEGACY_FEATURES.json are absent on disk: ${missing.join(', ')}`);
  }

  console.log(`OK — all ${present.length} design/frames/<feature> director${present.length === 1 ? 'y matches' : 'ies match'} the frozen legacy list.`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
