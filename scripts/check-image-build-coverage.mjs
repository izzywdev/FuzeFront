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

/** file -> context for docker/build-push-action steps that actually push. */
function releasedImages(text) {
  const out = new Map();
  const blocks = text.split(/\n(?=      - name: )/);
  for (const b of blocks) {
    if (!/uses:\s*docker\/build-push-action/.test(b)) continue;
    // Only steps that push are images that ship.
    if (!/push:\s*true/.test(b)) continue;
    const f = b.match(/^\s*file:\s*(\S+)\s*$/m);
    const c = b.match(/^\s*context:\s*(\S+)\s*$/m);
    if (f) out.set(f[1], c ? c[1] : null);
  }
  return out;
}

/** file -> context for each entry in the build-images matrix. */
function preMergeImages(text) {
  const out = new Map();
  const matrix = text.slice(text.indexOf('matrix:'), text.indexOf('steps:', text.indexOf('matrix:')));
  // Entries are `- name:` records; split on them so context and file pair up
  // per entry rather than being collected into two independent lists.
  for (const entry of matrix.split(/\n(?=\s*- name: )/)) {
    const f = entry.match(/^\s*file:\s*(\S+)\s*$/m);
    const c = entry.match(/^\s*context:\s*(\S+)\s*$/m);
    if (f) out.set(f[1], c ? c[1] : null);
  }
  return out;
}

const released = releasedImages(readFileSync(RELEASE, 'utf8'));
const preMerge = preMergeImages(readFileSync(REPRO, 'utf8'));

if (released.size === 0) {
  console.error(`FAIL: parsed 0 pushed images from ${RELEASE} — the parser is broken, not the workflow.`);
  process.exit(1);
}

const missing = [...released.keys()].filter((f) => !preMerge.has(f)).sort();

// A matrix entry that builds a released Dockerfile from a DIFFERENT context is
// not coverage — it builds something other than what ships, and then either
// fails for the wrong reason or passes without proving anything. That is not
// hypothetical: #1075 gave payment-service a `file:../../packages/service-auth`
// dependency and moved release.yml to `context: .`, while this matrix still
// said `services/payment-service`. The pre-merge build then died on
// "/services/payment-service/package.json: not found" — a red that said nothing
// about the image that actually ships. Coverage-by-path alone did not catch it.
const mismatched = [...released.entries()]
  .filter(([f, ctx]) => preMerge.has(f) && preMerge.get(f) !== ctx)
  .map(([f, ctx]) => `  - ${f}\n      release.yml context: ${ctx}\n      matrix context:     ${preMerge.get(f)}`)
  .sort();

if (mismatched.length > 0) {
  console.error(
    `FAIL: ${mismatched.length} image(s) are built pre-merge from a DIFFERENT context than\n` +
      `release.yml uses, so the pre-merge build does not reproduce what ships:\n`
  );
  for (const m of mismatched) console.error(m);
  console.error(`\nMake the matrix context match release.yml's for each.`);
  process.exit(1);
}

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

console.log(`OK: all ${released.size} released images have a pre-merge build, each from release.yml's own context.`);
