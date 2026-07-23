#!/usr/bin/env node
/**
 * stamp-frames.mjs — compute a stable content "stamp" for each design/frames/<feature>/**
 * and record it in that feature's manifest.json `stamp` field.
 *
 * WHY: an approval must bind to the exact frames a reviewer saw. The stamp is a
 * sha256 over the feature's files. If the frames change afterward, the stamp
 * changes and a stale approval is detectable (gate-frames-stamped in CI,
 * design-approval.yml at approval time). The stamp is DERIVED from the files —
 * never a hand-maintained mirror. It is the single source of truth's fingerprint.
 *
 * The manifest's own `stamp` field is EXCLUDED from the hash (read manifest,
 * delete `stamp`, canonically re-serialize, hash that) so the stamp never
 * depends on itself — writing it does not change the value it must equal.
 *
 * CLI:
 *   node scripts/stamp-frames.mjs --check   recompute all; exit non-zero + list drifted; change nothing
 *   node scripts/stamp-frames.mjs --write   recompute all; write `stamp` into each manifest
 *   node scripts/stamp-frames.mjs --json     print {feature: stamp} and exit 0 (no writes)
 *   [--frames <dir>]                         override design/frames location
 *   [--feature <slug>]                       restrict to one feature (used by design-approval.yml)
 *
 * Node 20, stdlib only.
 */
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not new URL().pathname — the latter yields "/D:/..." on Windows.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const hasFlag = (name) => process.argv.includes(name);

const framesDir = path.resolve(arg('--frames', path.join(repoRoot, 'design', 'frames')));
const onlyFeature = arg('--feature', null);

/** Approval bookkeeping keys. These record the DECISION, not the DESIGN, and are
 *  stripped from the manifest before hashing so the stamp fingerprints the frames
 *  a reviewer saw — never the approval state itself. Critical for per-flow
 *  approval: flipping `build.flows[].approved` to true (or approving flows one at
 *  a time) must NOT change the stamp, or every approval would invalidate the
 *  stamp its own frame links carry and the next click would falsely read as
 *  "the frames changed since you viewed them". (This is why a manually-approved
 *  manifest drifted from its stored stamp under the old, approval-inclusive hash.) */
const APPROVAL_KEYS = new Set(['approved', 'approvedBy', 'approvedAt']);

/** Deterministic JSON: object keys sorted recursively, arrays order-preserved,
 *  approval-bookkeeping keys removed at every level.
 *  Two logically-equal manifests serialize identically regardless of key order. */
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (APPROVAL_KEYS.has(key)) continue;
      out[key] = canonicalize(value[key]);
    }
    return out;
  }
  return value;
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** Recursively list files under dir, returned as POSIX-style relative paths. */
async function listFiles(dir, base = dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      files.push(...(await listFiles(abs, base)));
    } else if (e.isFile()) {
      files.push(path.relative(base, abs).split(path.sep).join('/'));
    }
  }
  return files;
}

/**
 * Compute the stamp of a single feature directory.
 * Hash = sha256 over each file (sorted by relative path) as:
 *   "<relpath>\0<per-file-hash>\n"
 * where per-file-hash is:
 *   - manifest.json: sha256 of the canonical JSON with `stamp` removed (self-excluding),
 *   - any other file: sha256 of the raw bytes.
 * A manifest that fails to parse is a hard error — an unparseable manifest must
 * not silently hash as "some bytes" and mask corruption.
 */
async function computeStamp(featureDir) {
  const rels = (await listFiles(featureDir)).sort();
  const h = createHash('sha256');
  for (const rel of rels) {
    const abs = path.join(featureDir, rel);
    let fileHash;
    if (rel === 'manifest.json') {
      const raw = await readFile(abs, 'utf8');
      let manifest;
      try {
        manifest = JSON.parse(raw);
      } catch (err) {
        throw new Error(`manifest.json in ${featureDir} is not valid JSON: ${err.message}`);
      }
      const { stamp, ...rest } = manifest; // exclude own stamp
      void stamp;
      fileHash = sha256(JSON.stringify(canonicalize(rest)));
    } else {
      fileHash = sha256(await readFile(abs));
    }
    h.update(`${rel}\0${fileHash}\n`);
  }
  return h.digest('hex');
}

/** Feature directories present on disk. `_`/`.`-prefixed dirs are scaffolding. */
async function discoverFeatures() {
  if (!existsSync(framesDir)) throw new Error(`frames dir not found: ${framesDir}`);
  const entries = await readdir(framesDir, { withFileTypes: true });
  const features = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('_') || e.name.startsWith('.')) continue;
    if (onlyFeature && e.name !== onlyFeature) continue;
    const manifestPath = path.join(framesDir, e.name, 'manifest.json');
    if (!existsSync(manifestPath)) continue; // only features with a manifest are stampable
    features.push({ slug: e.name, dir: path.join(framesDir, e.name), manifestPath });
  }
  return features.sort((a, b) => a.slug.localeCompare(b.slug));
}

async function main() {
  const write = hasFlag('--write');
  const check = hasFlag('--check');
  const json = hasFlag('--json');
  if (!write && !check && !json) {
    console.error('usage: stamp-frames.mjs (--check | --write | --json) [--frames <dir>] [--feature <slug>]');
    process.exit(2);
  }

  const features = await discoverFeatures();
  const result = {};
  const drifted = [];

  for (const f of features) {
    const computed = await computeStamp(f.dir);
    result[f.slug] = computed;
    const manifest = JSON.parse(await readFile(f.manifestPath, 'utf8'));
    const current = manifest.stamp ?? null;

    if (json) continue;

    if (current !== computed) {
      drifted.push({ slug: f.slug, current, computed });
      if (write) {
        manifest.stamp = computed;
        // Preserve human-friendly 2-space formatting + trailing newline.
        await writeFile(f.manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
        console.log(`stamped ${f.slug}: ${computed}`);
      }
    } else {
      console.log(`ok      ${f.slug}: ${computed}`);
    }
  }

  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (check) {
    if (drifted.length) {
      console.error(`\n${drifted.length} manifest stamp(s) are stale (run: node scripts/stamp-frames.mjs --write):`);
      for (const d of drifted) console.error(`  - ${d.slug}: manifest=${d.current ?? '<none>'} computed=${d.computed}`);
      process.exit(1);
    }
    console.log(`\nAll ${features.length} feature stamp(s) up to date.`);
  }

  if (write && !drifted.length) console.log(`\nAll ${features.length} feature stamp(s) already up to date.`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
