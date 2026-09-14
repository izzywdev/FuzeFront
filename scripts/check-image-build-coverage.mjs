#!/usr/bin/env node
/**
 * Every image release.yml PUSHES must also be BUILT pre-merge by
 * image-reproducibility.yml's build-images matrix.
 *
 * Why this exists: `master` is deploy-on-push, so release.yml builds and ships
 * an image the moment a PR lands. If that image has no pre-merge build, a
 * Dockerfile that does not build is discovered by production — which is the
 * stated purpose of build-images, but the matrix was hand-maintained and drifted
 * badly: it covered 8 of 18 released images. config-service shipped uncovered
 * and crash-looped in prod (#768); devportal-service and devportal-frontend were
 * added later and also went in uncovered, so the gap widened with every new
 * service rather than holding steady.
 *
 * Joining on the Dockerfile PATH, not the step/matrix display name — the names
 * differ between the two files by design ("Build & push clock-app (built-in MF
 * remote)" vs "clock-app"), while the path is the thing actually built.
 *
 * Dependency-free and static, like check-dockerfile-lockfile.mjs, so it runs in
 * the cheap job with no install step.
 */
import { readFileSync } from 'node:fs';

const RELEASE = '.github/workflows/release.yml';
const REPRO = '.github/workflows/image-reproducibility.yml';

/** `file:` values on docker/build-push-action steps that actually push. */
function releasedImages(text) {
  const out = new Set();
  const blocks = text.split(/\n(?=      - name: )/);
  for (const b of blocks) {
    if (!/uses:\s*docker\/build-push-action/.test(b)) continue;
    // Only steps that push are images that ship.
    if (!/push:\s*true/.test(b)) continue;
    const m = b.match(/^\s*file:\s*(\S+)\s*$/m);
    if (m) out.add(m[1]);
  }
  return out;
}

/** `file:` values in the build-images matrix. */
function preMergeImages(text) {
  const out = new Set();
  const matrix = text.slice(text.indexOf('matrix:'), text.indexOf('steps:', text.indexOf('matrix:')));
  for (const m of matrix.matchAll(/^\s*file:\s*(\S+)\s*$/gm)) out.add(m[1]);
  return out;
}

const released = releasedImages(readFileSync(RELEASE, 'utf8'));
const preMerge = preMergeImages(readFileSync(REPRO, 'utf8'));

if (released.size === 0) {
  console.error(`FAIL: parsed 0 pushed images from ${RELEASE} — the parser is broken, not the workflow.`);
  process.exit(1);
}

const missing = [...released].filter((f) => !preMerge.has(f)).sort();

if (missing.length > 0) {
  console.error(
    `FAIL: ${missing.length} image(s) are built and pushed by release.yml but have no pre-merge build\n` +
      `in ${REPRO}'s build-images matrix. master is deploy-on-push, so these would be\n` +
      `discovered broken by production. Add a matrix entry for each:\n`
  );
  for (const f of missing) console.error(`  - ${f}`);
  console.error(
    `\nUse the same context release.yml uses — a self-contained Dockerfile builds from its\n` +
      `own subtree, and a root context would not reproduce what ships.`
  );
  process.exit(1);
}

console.log(`OK: all ${released.size} released images have a pre-merge build.`);
