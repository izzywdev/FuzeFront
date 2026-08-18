/**
 * Regression guard for scripts/stamp-frames.mjs (FFRNT-301).
 *
 * WHY THIS EXISTS: the frame-stamp tool is the *only* way to (re)generate the
 * `stamp` in each design/frames/<feature>/manifest.json, and gate-frames-stamped
 * shells out to it (`node scripts/stamp-frames.mjs --check`). If the script ever
 * vanishes again the gate dies with MODULE_NOT_FOUND and every frames PR goes
 * red with no way to re-stamp — which is precisely the failure FFRNT-301 reports.
 * These tests fail loudly the moment that happens, on every PR that touches the
 * script or its frames, instead of surfacing as an opaque module-load crash.
 *
 * Two invariants are pinned:
 *   1. The script is present and `--check` is green on the committed tree.
 *   2. The account-security fixture reproduces its ORIGINAL stamp
 *      (4ac159cd…) byte-for-byte. This pins the hashing ALGORITHM: a refactor
 *      of computeStamp() that changes the digest would otherwise pass --check
 *      silently (run --write, everything re-stamps consistently, --check green)
 *      while invalidating every approval-bound stamp already in the wild. The
 *      known-good fixture is the tripwire for that silent drift.
 *
 * Run with:  node --test scripts/__tests__/stamp-frames.test.mjs
 * (node:test — a repo-level script, no jest wiring needed.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const script = path.join(repoRoot, 'scripts', 'stamp-frames.mjs');

// The ground-truth fixture: the account-security frames' stamp for the CURRENT
// committed content. Whatever the algorithm is, it MUST reproduce this — an
// unexplained change means computeStamp() drifted (do NOT re-stamp to hide that).
// This value is updated only when the account-security frames themselves change,
// in the SAME PR as the change, exactly like re-stamping the manifest. It last
// moved when the frames-first coverage rollout added `implementation.paths` to
// the manifest (part of the content hash) — see PR #314 / #353 and FFRNT-301.
const ACCOUNT_SECURITY_STAMP =
  '4ca39fddc0c7f3f46efde7b04937026683b5f417a6144639635adc81efff1a9b';

test('stamp-frames.mjs is present in the repo', () => {
  assert.ok(
    existsSync(script),
    'scripts/stamp-frames.mjs is missing — gate-frames-stamped cannot run and no manifest can be (re)stamped (FFRNT-301).',
  );
});

test('--check is green on the committed frames tree', () => {
  // Throws on non-zero exit, which is the assertion: every committed manifest
  // stamp is current. stdio inherited so drift is visible in the test log.
  execFileSync('node', [script, '--check'], { cwd: repoRoot, stdio: 'inherit' });
});

test('account-security reproduces its original stamp (algorithm pin)', () => {
  const out = execFileSync('node', [script, '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const stamps = JSON.parse(out);
  assert.equal(
    stamps['account-security'],
    ACCOUNT_SECURITY_STAMP,
    'account-security stamp drifted from its original value — the hashing algorithm changed. ' +
      'Do NOT re-stamp to fix this; investigate why computeStamp() no longer matches the frozen fixture.',
  );
});
