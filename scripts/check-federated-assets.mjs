#!/usr/bin/env node
/**
 * Prove a federated remote actually LOADS — not merely that its entry file exists.
 *
 * WHY THIS EXISTS. `remoteEntry.js` returning 200 proves almost nothing. The
 * four-layer path contract (manifest `integration.remoteEntry` / build `base` +
 * `assetsDir` / Ingress / nginx `location`+`alias`) can disagree in a way that
 * serves the ENTRY correctly and 404s every chunk the entry imports. The host
 * then mounts a blank panel while every healthcheck in the pipeline is green —
 * which is exactly the failure `gate_federation_contract.py` reasons about
 * statically, and exactly what a curl of one URL cannot see.
 *
 * Chunk specifiers inside remoteEntry.js are RELATIVE TO remoteEntry.js's own
 * URL, not to the app base. That distinction is the whole `assetsDir: ''`
 * subtlety — resolving them with `new URL(spec, remoteEntryUrl)` is what makes
 * this test the real thing rather than a re-derivation of the config we are
 * trying to check.
 *
 * THE 200 THAT ISN'T. A dev server or SPA fallback answers a missing chunk with
 * 200 and an HTML body. `curl -fsS` is satisfied; the browser is not — it gets
 * HTML where it expected a module and the panel dies. So every response is
 * checked for a JavaScript content-type, and an HTML body is treated as the
 * 404 it really is. e2e.yml already learned this for the entry file itself;
 * the chunks need the same treatment or the lesson only covers one URL.
 *
 *   node scripts/check-federated-assets.mjs <remoteEntryUrl> [--origin <url>]
 *
 * Exits non-zero on: entry not reachable, entry not JS, ANY referenced chunk
 * not 200, any chunk served as HTML, or ZERO chunks discovered.
 */

const args = process.argv.slice(2);
const entryUrl = args.find(a => !a.startsWith('--'));
const originIdx = args.indexOf('--origin');
const origin = originIdx >= 0 ? args[originIdx + 1] : null;

if (!entryUrl) {
  console.error('usage: check-federated-assets.mjs <remoteEntryUrl> [--origin <url>]');
  process.exit(2);
}

const JS_CT = /(javascript|ecmascript|text\/jsx?)/i;
const HTML_CT = /text\/html/i;

function fail(msg) {
  console.error(`::error title=Federated assets::${msg}`);
  process.exitCode = 1;
}

async function get(url) {
  const headers = origin ? { Origin: origin } : {};
  const res = await fetch(url, { headers, redirect: 'follow' });
  const ct = res.headers.get('content-type') || '';
  const body = await res.text();
  return { status: res.status, ct, body };
}

/**
 * Module specifiers referenced by the entry.
 *
 * Deliberately broad — every quoted string that looks like a JS path — because
 * the alternative is encoding one bundler's emit shape and going quiet the day
 * it changes. A false candidate costs one HTTP request; a missed chunk costs
 * the whole point of this check. Absolute URLs on other origins are dropped:
 * those are somebody else's asset, not this remote's contract.
 */
function extractChunkSpecifiers(src) {
  const out = new Set();
  for (const m of src.matchAll(/['"`]([^'"`\s]+?\.m?js)['"`]/g)) {
    const spec = m[1];
    if (spec.startsWith('data:') || spec.startsWith('blob:')) continue;
    if (/^https?:\/\//i.test(spec)) {
      try {
        if (new URL(spec).origin !== new URL(entryUrl).origin) continue;
      } catch { continue; }
    }
    out.add(spec);
  }
  return [...out];
}

const entry = await get(entryUrl).catch(e => {
  fail(`could not fetch remoteEntry ${entryUrl}: ${e.message}`);
  return null;
});
if (!entry) process.exit(1);

console.log(`entry  ${entry.status}  ${entry.ct || '(no content-type)'}  ${entryUrl}`);
if (entry.status !== 200) fail(`remoteEntry.js returned ${entry.status}, not 200`);
if (HTML_CT.test(entry.ct) || /^\s*<!doctype html/i.test(entry.body)) {
  fail('remoteEntry.js was served as HTML — this is the SPA fallback answering a '
     + '404 with 200. The path contract is wrong even though the status says fine.');
}

const specs = extractChunkSpecifiers(entry.body);

// ANTI-VACUITY. A federated remote exposes modules, and exposed modules are
// chunks it must reference. Finding none means the extractor stopped working,
// not that the remote is unusually tidy — and a checker that examined nothing
// must never be allowed to print a pass.
if (specs.length === 0) {
  fail(`remoteEntry.js references ZERO loadable chunks (${entry.body.length} bytes read). `
     + 'Either the bundler emit shape changed and this extractor no longer '
     + 'recognises it, or the entry exposes nothing. Both need a human — this is '
     + 'the check being broken, not the remote being clean.');
  process.exit(1);
}

let ok = 0;
const failures = [];
for (const spec of specs) {
  const url = new URL(spec, entryUrl).href;
  let r;
  try {
    r = await get(url);
  } catch (e) {
    failures.push(`${spec} -> ${url}: ${e.message}`);
    continue;
  }
  const htmlBody = HTML_CT.test(r.ct) || /^\s*<!doctype html/i.test(r.body);
  if (r.status !== 200) {
    failures.push(`${spec} -> ${url}: HTTP ${r.status}`);
  } else if (htmlBody) {
    failures.push(`${spec} -> ${url}: HTTP 200 but served as HTML (SPA fallback masking a 404)`);
  } else if (!JS_CT.test(r.ct)) {
    failures.push(`${spec} -> ${url}: HTTP 200 with content-type '${r.ct || 'none'}', not JavaScript`);
  } else {
    ok++;
    console.log(`chunk  200  ${r.ct}  ${url}`);
  }
}

// The census prints whether or not anything failed: "OK" on its own cannot be
// told apart from "looked at nothing".
console.log(`\nfederated assets: ${specs.length} chunk(s) referenced — ${ok} loadable, ${failures.length} broken`);

for (const f of failures) fail(f);
if (failures.length) {
  console.error(
    '\nremoteEntry.js loads but its chunks do not. In a browser this is a blank '
  + 'panel behind a green healthcheck. The cause is a disagreement between the '
  + 'four layers of the path contract — manifest remoteEntry / build base+assetsDir '
  + '/ Ingress path / nginx location+alias. Chunk URLs above are resolved RELATIVE '
  + 'TO remoteEntry.js, so compare them against what the server actually serves.');
  process.exit(1);
}
console.log('federated assets: OK — entry and every referenced chunk load as JavaScript');
