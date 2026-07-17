#!/usr/bin/env node
/**
 * stamp-frames.mjs — content-stamp each design/frames/<feature>/ directory.
 *
 * WHY THIS EXISTS
 * An approval must provably bind to the EXACT frames the approver looked at.
 * The stamp is a stable content hash of design/frames/<feature>/**, written to
 * that feature's manifest.json as `stamp`. `design-approval` recomputes it and
 * refuses to bind an approval to frames that have since changed.
 *
 * ANTI-DRIFT CONTRACT
 * The stamp is DERIVED from the files on disk, never restated. `--check`
 * recomputes from the same source `--write` uses, so the two cannot disagree.
 * The manifest's own `stamp` field is excluded from its own input (a hash cannot
 * contain itself), and the manifest is canonicalised (sorted keys) before
 * hashing so reformatting/key-reordering is not a false mismatch while any real
 * content change is.
 *
 * Node 20, stdlib only.
 *
 * Usage:
 *   node scripts/stamp-frames.mjs --check [feature...]   # non-zero on mismatch
 *   node scripts/stamp-frames.mjs --write [feature...]   # write stamps
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const FRAMES_DIR = join(REPO_ROOT, 'design', 'frames');
const MANIFEST = 'manifest.json';
const STAMP_FIELD = 'stamp';

/** Directories under design/frames/ that are not features. */
const NOT_A_FEATURE = new Set(['_template']);

/** Recursively list files under `dir`, as repo-style relative POSIX paths. */
function listFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(abs));
    else if (entry.isFile()) out.push(abs);
  }
  return out;
}

/**
 * Canonical JSON: object keys sorted recursively. Makes the hash depend on
 * MEANING, not on formatting or key order.
 */
function canonicalise(value) {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value && typeof value === 'object') {
    const sorted = {};
    for (const key of Object.keys(value).sort()) sorted[key] = canonicalise(value[key]);
    return sorted;
  }
  return value;
}

/**
 * The bytes that a given file contributes to the stamp.
 * For manifest.json this is the canonicalised JSON MINUS the `stamp` field —
 * otherwise writing the stamp would change the input that produced it.
 */
function hashableContent(absPath, isManifest) {
  const raw = readFileSync(absPath);
  if (!isManifest) return raw;
  const parsed = JSON.parse(raw.toString('utf8'));
  delete parsed[STAMP_FIELD];
  return Buffer.from(JSON.stringify(canonicalise(parsed)), 'utf8');
}

/**
 * Stable content hash of one feature directory.
 * Paths are sorted so directory-read order can never change the result, and
 * each path is fed into the digest alongside its content so that RENAMING a
 * file (same bytes, new name) is still a change.
 */
export function computeStamp(featureDir) {
  const files = listFiles(featureDir)
    .map((abs) => ({ abs, rel: relative(featureDir, abs).split(sep).join('/') }))
    .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));

  const digest = createHash('sha256');
  const perFile = [];
  for (const { abs, rel } of files) {
    const content = hashableContent(abs, rel === MANIFEST);
    const fileHash = createHash('sha256').update(content).digest('hex');
    perFile.push({ rel, fileHash });
    digest.update(rel, 'utf8').update('\0').update(fileHash, 'utf8').update('\0');
  }
  return { stamp: `sha256:${digest.digest('hex')}`, perFile };
}

function discoverFeatures() {
  let entries;
  try {
    entries = readdirSync(FRAMES_DIR, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && !NOT_A_FEATURE.has(e.name))
    .map((e) => e.name)
    .filter((name) => {
      try {
        return statSync(join(FRAMES_DIR, name, MANIFEST)).isFile();
      } catch {
        return false;
      }
    })
    .sort();
}

function readManifest(feature) {
  const path = join(FRAMES_DIR, feature, MANIFEST);
  return { path, json: JSON.parse(readFileSync(path, 'utf8')) };
}

function main() {
  const argv = process.argv.slice(2);
  const mode = argv.includes('--check') ? 'check' : argv.includes('--write') ? 'write' : null;
  if (!mode) {
    console.error('usage: stamp-frames.mjs (--check|--write) [feature...]');
    process.exit(2);
  }

  const requested = argv.filter((a) => !a.startsWith('--'));
  const known = discoverFeatures();
  const unknown = requested.filter((f) => !known.includes(f));
  if (unknown.length) {
    console.error(`unknown feature(s): ${unknown.join(', ')}`);
    console.error(`known: ${known.join(', ') || '(none)'}`);
    process.exit(2);
  }
  const features = requested.length ? requested : known;

  if (!features.length) {
    console.log('stamp-frames: no feature directories under design/frames/ — nothing to do.');
    return;
  }

  let failed = 0;
  for (const feature of features) {
    const dir = join(FRAMES_DIR, feature);
    const { stamp, perFile } = computeStamp(dir);
    const { path, json } = readManifest(feature);

    if (mode === 'write') {
      if (json[STAMP_FIELD] === stamp) {
        console.log(`= ${feature} ${stamp} (unchanged)`);
        continue;
      }
      json[STAMP_FIELD] = stamp;
      writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`, 'utf8');
      console.log(`+ ${feature} ${stamp} (written)`);
      continue;
    }

    // --check
    const actual = json[STAMP_FIELD];
    if (actual === stamp) {
      console.log(`ok ${feature} ${stamp}`);
      continue;
    }
    failed += 1;
    console.error(`\nMISMATCH ${feature}`);
    console.error(`  manifest stamp: ${actual ?? '(absent)'}`);
    console.error(`  actual  stamp: ${stamp}`);
    console.error(`  contents hashed (${perFile.length} file(s)):`);
    for (const { rel, fileHash } of perFile) {
      console.error(`    ${fileHash.slice(0, 12)}  ${rel}`);
    }
    console.error(
      actual
        ? `  -> design/frames/${feature}/ changed after it was stamped. Any approval bound to`
        : `  -> design/frames/${feature}/ has never been stamped, so no approval can bind to it.`
    );
    console.error(`     "${actual ?? 'nothing'}" no longer describes these frames.`);
    console.error(`     Re-stamp with: node scripts/stamp-frames.mjs --write ${feature}`);
  }

  if (failed) {
    console.error(`\nstamp-frames --check FAILED for ${failed} feature(s).`);
    process.exit(1);
  }
  console.log(`\nstamp-frames --${mode} OK (${features.length} feature(s)).`);
}

main();
