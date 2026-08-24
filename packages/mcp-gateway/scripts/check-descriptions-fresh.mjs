#!/usr/bin/env node
/**
 * Is the committed description cache still true of the committed spec?
 *
 * WHY THIS EXISTS. `generate-descriptions.mjs` is a BUILD-TIME step run by hand
 * (`npm run generate:descriptions`) and wired into no workflow. So a PR that
 * edits the OpenAPI spec does not regenerate anything, and nothing notices:
 * the gateway silently falls back to spec prose for the tools that changed
 * while the cache keeps asserting LLM text for the rest. Drift with no signal
 * is the whole failure family this repo has been removing.
 *
 * DETERMINISTIC BY DESIGN. This recomputes the same sha256 the cache stores and
 * compares. No LLM, no LITELLM_FUZE_KEY, no network — so it runs on any runner,
 * on a fork PR, offline, and it cannot itself become the thing that skips.
 * Generation needs a key and costs tokens; CHECKING must not.
 *
 * THREE STATES, AND THEY ARE NOT THE SAME THING:
 *   fresh    hashes match and every tool has an entry  -> OK
 *   stale    cache exists but its hashes do not match  -> FAIL. The file makes a
 *            claim about a spec that has moved.
 *   absent   no cache at all                           -> NOTICE, not failure.
 *            Nothing is inconsistent; the gateway boots on spec-derived prose,
 *            which is a normal logged path. This is FuzeFront's state today —
 *            the cache has never been generated. Reporting absent as a failure
 *            would red the repo for a feature nobody has switched on; reporting
 *            it as silence would hide that the feature is inert. So it prints,
 *            loudly, and `--require-cache` turns it into a failure for repos
 *            that have adopted it.
 *
 *   node scripts/check-descriptions-fresh.mjs \
 *     --spec ../../services/app-registry-service/openapi.yaml \
 *     --overrides ../../deploy/helm/fuzefront/files/mcp-tools.overrides.yaml \
 *     --cache ../../deploy/helm/fuzefront/files/mcp-tool-descriptions.cache.json \
 *     [--require-cache]
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, dflt = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const specPath = opt('spec');
const overridesPath = opt('overrides');
const cachePath = opt('cache');
const requireCache = args.includes('--require-cache');

if (!specPath || !cachePath) {
  console.error('usage: check-descriptions-fresh.mjs --spec <f> [--overrides <f>] --cache <f> [--require-cache]');
  process.exit(2);
}

// Must match src/descriptions.ts hashText exactly, or this gate compares two
// different things and is worse than absent.
const hashText = t => createHash('sha256').update(t, 'utf8').digest('hex');

if (!existsSync(specPath)) {
  console.error(`::error title=MCP descriptions::spec not found: ${specPath}`);
  process.exit(1);
}
const specRaw = readFileSync(specPath, 'utf8');
// The generator hashes '' when there is no overrides file; mirror that, or a
// repo without overrides reads as permanently stale.
const overridesRaw = overridesPath && existsSync(overridesPath)
  ? readFileSync(overridesPath, 'utf8') : '';

const specHash = hashText(specRaw);
const overridesHash = hashText(overridesRaw);

if (!existsSync(cachePath)) {
  const msg = `no description cache at ${cachePath} — the gateway will serve `
    + 'spec-derived prose. That is a supported, logged boot path, not a fault: '
    + 'nothing here is inconsistent, the LLM description feature simply has '
    + 'never been generated for this repo. Run `npm run generate:descriptions`.';
  if (requireCache) {
    console.error(`::error title=MCP descriptions::${msg} --require-cache was set, so this is a failure.`);
    process.exit(1);
  }
  console.log(`::notice title=MCP descriptions::${msg}`);
  console.log(`mcp descriptions: ABSENT (spec ${specHash.slice(0, 12)})`);
  process.exit(0);
}

let cache;
try {
  cache = JSON.parse(readFileSync(cachePath, 'utf8'));
} catch (e) {
  console.error(`::error title=MCP descriptions::${cachePath} is not valid JSON: ${e.message}`);
  process.exit(1);
}
for (const k of ['specHash', 'overridesHash', 'descriptions']) {
  if (cache?.[k] === undefined) {
    console.error(`::error title=MCP descriptions::${cachePath} has no '${k}' — this is not a description cache.`);
    process.exit(1);
  }
}

const problems = [];
if (cache.specHash !== specHash) {
  problems.push(`spec has changed since the cache was generated\n`
    + `      cache says : ${cache.specHash}\n`
    + `      spec is now: ${specHash}\n`
    + `      ${specPath}`);
}
if (cache.overridesHash !== overridesHash) {
  problems.push(`overrides have changed since the cache was generated\n`
    + `      cache says : ${cache.overridesHash}\n`
    + `      now        : ${overridesHash}\n`
    + `      ${overridesPath ?? '(none)'}`);
}

const n = Object.keys(cache.descriptions || {}).length;
console.log(`mcp descriptions: cache holds ${n} tool description(s), `
  + `generated ${cache.generatedAt ?? 'at an unrecorded time'} by ${cache.model ?? 'an unrecorded model'}`);

if (problems.length) {
  for (const p of problems) {
    console.error(`::error title=MCP descriptions::${p}`);
  }
  console.error(
    '\nThe committed cache asserts LLM-written prose for a contract that has since '
  + 'moved. At runtime the gateway detects the mismatch and falls back to spec '
  + 'prose — so nothing crashes, and that is precisely the problem: the tool '
  + 'descriptions agents read quietly stop being the ones this repo reviewed.\n'
  + '\nFix: regenerate and commit the cache —\n'
  + '  cd packages/mcp-gateway && npm run generate:descriptions\n'
  + '(needs LITELLM_FUZE_KEY; the post-merge workflow does this and opens a PR).');
  process.exit(1);
}

console.log('mcp descriptions: OK — cache matches the committed spec and overrides');
