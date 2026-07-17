#!/usr/bin/env node
/**
 * build-frames-site.mjs — assemble the GitHub Pages site for design/frames/**.
 *
 * The top-level index is DERIVED from the directories actually present under
 * design/frames/ (and each feature's own manifest.json). It is never a
 * hand-maintained list: adding a feature directory is the only action needed for
 * it to appear. A restated list is the two-sources-of-truth drift defect this
 * repo has been bitten by repeatedly — do not reintroduce it here.
 *
 * Usage: node scripts/build-frames-site.mjs [--out <dir>] [--frames <dir>]
 */
import { readdir, readFile, mkdir, cp, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not new URL().pathname — the latter yields "/D:/..." on Windows.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const framesDir = path.resolve(arg('--frames', path.join(repoRoot, 'design', 'frames')));
const outDir = path.resolve(arg('--out', path.join(repoRoot, '_site')));

const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

/** Feature directories present on disk — the source of truth. `_`-prefixed dirs
 *  (e.g. `_template`) are scaffolding, not features awaiting review. */
async function discoverFeatures() {
  const entries = await readdir(framesDir, { withFileTypes: true });
  const features = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('_') || e.name.startsWith('.')) continue;
    const dir = path.join(framesDir, e.name);
    const manifestPath = path.join(dir, 'manifest.json');
    let manifest = null;
    let manifestError = null;
    if (existsSync(manifestPath)) {
      try {
        manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      } catch (err) {
        manifestError = err.message;
      }
    }
    const entryFile = manifest?.entry ?? 'index.html';
    features.push({
      slug: e.name,
      manifest,
      manifestError,
      hasEntry: existsSync(path.join(dir, entryFile)),
      entryFile,
    });
  }
  return features.sort((a, b) => a.slug.localeCompare(b.slug));
}

/** Approval state derived from the manifest: per-flow `approved` (the current
 *  model) or the legacy top-level `approved`. Reported, never asserted. */
function approvalOf(manifest) {
  if (!manifest) return { label: 'no manifest', state: 'unknown' };
  const flows = Array.isArray(manifest.frames) ? manifest.frames : [];
  const perFlow = flows.filter((f) => typeof f.approved === 'boolean');
  if (perFlow.length > 0) {
    const yes = perFlow.filter((f) => f.approved).length;
    if (yes === perFlow.length) return { label: `approved (${yes}/${perFlow.length} flows)`, state: 'approved' };
    if (yes === 0) return { label: `pending (0/${perFlow.length} flows)`, state: 'pending' };
    return { label: `partial (${yes}/${perFlow.length} flows)`, state: 'partial' };
  }
  if (manifest.approved === true) return { label: 'approved', state: 'approved' };
  return { label: 'pending', state: 'pending' };
}

function renderIndex(features) {
  const cards = features
    .map((f) => {
      const m = f.manifest;
      const title = escapeHtml(m?.feature ?? m?.name ?? f.slug);
      const desc = escapeHtml(m?.description ?? 'No description in manifest.json.');
      const approval = approvalOf(m);
      const frameCount = Array.isArray(m?.frames) ? m.frames.length : 0;
      const stamp = m?.stamp ? `<code>${escapeHtml(String(m.stamp).slice(0, 12))}</code>` : '<span class="dim">unstamped</span>';
      const warn = f.manifestError
        ? `<p class="warn">manifest.json failed to parse: ${escapeHtml(f.manifestError)}</p>`
        : !f.hasEntry
          ? `<p class="warn">entry <code>${escapeHtml(f.entryFile)}</code> not found</p>`
          : '';
      return `      <a class="card" href="${escapeHtml(f.slug)}/${escapeHtml(f.entryFile)}" data-feature="${escapeHtml(f.slug)}">
        <div class="seam"></div>
        <div class="slug">${escapeHtml(f.slug)}</div>
        <h2>${title}</h2>
        <p>${desc}</p>
        ${warn}
        <div class="card-meta">
          <span class="pill" data-approval="${approval.state}">${escapeHtml(approval.label)}</span>
          <span class="dim">${frameCount} frame${frameCount === 1 ? '' : 's'}</span>
          <span class="dim">stamp ${stamp}</span>
        </div>
      </a>`;
    })
    .join('\n');

  const empty = `      <p class="dim">No feature frames found under <code>design/frames/</code>.</p>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>FuzeFront — Design Frames</title>
<style>
  :root {
    --bg: #0c0f14; --bg-2: #12161d; --bg-3: #171c25;
    --text: #e8ecf3; --text-2: #a8b2c1; --text-3: #6f7b8d;
    --border: #232b37; --border-strong: #35404f;
    --cyan: #4dd6e8; --seam: linear-gradient(90deg, #4dd6e8, #7b6cf6);
    --ok: #5fd08a; --warn: #f5b950; --partial: #7b6cf6;
    --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif; }
  .wrap { max-width: 960px; margin: 0 auto; padding: 64px 32px 96px; }
  .eyebrow { font-family: var(--mono); font-size: 11px; letter-spacing: .14em; text-transform: uppercase;
    color: var(--cyan); margin-bottom: 12px; }
  h1 { font-size: 34px; letter-spacing: -0.02em; margin: 0 0 10px; }
  .lead { color: var(--text-2); margin: 0; max-width: 68ch; line-height: 1.6; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 40px; }
  @media (max-width: 720px) { .grid { grid-template-columns: 1fr; } .wrap { padding: 40px 20px 64px; } }
  .card { display: block; text-decoration: none; color: inherit; background: var(--bg-3);
    border: 1px solid var(--border); border-radius: 14px; padding: 24px; position: relative;
    overflow: hidden; transition: transform .18s ease, border-color .18s ease; }
  .card:hover { transform: translateY(-2px); border-color: var(--border-strong); }
  .card .seam { position: absolute; inset: 0 0 auto 0; height: 2px; background: var(--seam); opacity: 0; transition: opacity .18s; }
  .card:hover .seam { opacity: 1; }
  .slug { font-family: var(--mono); font-size: 11px; color: var(--text-3); letter-spacing: .08em; }
  .card h2 { margin: 8px 0; font-size: 18px; }
  .card p { margin: 0; color: var(--text-3); font-size: 13px; line-height: 1.55; }
  .card-meta { margin-top: 18px; display: flex; flex-wrap: wrap; gap: 10px; align-items: center; font-size: 11px; }
  .pill { font-family: var(--mono); font-size: 10px; text-transform: uppercase; letter-spacing: .08em;
    padding: 3px 9px; border-radius: 999px; border: 1px solid var(--border-strong); color: var(--text-2); }
  .pill[data-approval="approved"] { color: var(--ok); border-color: rgba(95,208,138,.45); }
  .pill[data-approval="pending"] { color: var(--warn); border-color: rgba(245,185,80,.45); }
  .pill[data-approval="partial"] { color: var(--partial); border-color: rgba(123,108,246,.45); }
  .dim { color: var(--text-3); font-family: var(--mono); }
  .warn { color: var(--warn) !important; font-family: var(--mono); font-size: 11px; margin-top: 10px !important; }
  code { font-family: var(--mono); color: var(--text-2); }
  footer { margin-top: 56px; padding-top: 24px; border-top: 1px solid var(--border);
    color: var(--text-3); font-size: 12px; line-height: 1.7; }
  footer a { color: var(--cyan); }
</style>
</head>
<body>
<div class="wrap">
  <div class="eyebrow">Contract-freeze · UX approval</div>
  <h1>FuzeFront — Design Frames</h1>
  <p class="lead">Every feature awaiting UX approval. Each entry is a navigable HTML frame set built in
    the fuse-seam design system — the visual contract that implementation and Playwright verification
    are measured against. This directory is generated from the folders present in
    <code>design/frames/</code>; it is never hand-maintained.</p>

  <div class="grid" data-frames-index>
${features.length ? cards : empty}
  </div>

  <footer>
    Generated by <code>scripts/build-frames-site.mjs</code> · published by
    <code>.github/workflows/pages-frames.yml</code> ·
    source: <a href="https://github.com/izzywdev/FuzeFront/tree/master/design/frames">design/frames</a><br />
    Approval state is read from each feature's <code>manifest.json</code>. Approve via the in-frame
    control, not by editing this page.
  </footer>
</div>
</body>
</html>
`;
}

async function main() {
  if (!existsSync(framesDir)) {
    console.error(`frames dir not found: ${framesDir}`);
    process.exit(1);
  }
  const features = await discoverFeatures();
  await mkdir(outDir, { recursive: true });
  // Copy every feature directory verbatim (frames reference tokens.css relatively).
  for (const f of features) {
    await cp(path.join(framesDir, f.slug), path.join(outDir, f.slug), { recursive: true });
  }
  await writeFile(path.join(outDir, 'index.html'), renderIndex(features), 'utf8');
  // Jekyll would otherwise skip `_`-prefixed paths and mangle the output.
  await writeFile(path.join(outDir, '.nojekyll'), '', 'utf8');

  console.log(`Built ${features.length} feature(s) -> ${outDir}`);
  for (const f of features) {
    console.log(`  - ${f.slug} (${approvalOf(f.manifest).label})`);
    if (f.manifestError) console.log(`      WARN manifest parse error: ${f.manifestError}`);
    if (!f.hasEntry) console.log(`      WARN missing entry: ${f.entryFile}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
