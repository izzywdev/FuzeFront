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

// Where approval decisions are recorded. A GitHub issue is the durable, auditable
// record; the design-approval workflow (or a maintainer) reads it and flips the
// per-flow `approved` in the manifest. Prefilled via plain query params — the only
// form of issue prefill that is 100% reliable (dropdown prefill is not).
const REPO_SLUG = 'izzywdev/FuzeFront';
const PAGES_BASE = 'https://izzywdev.github.io/FuzeFront';

/** The per-flow list is the source of truth for approval: `build.flows`. (Some
 *  legacy manifests carried approvable entries under `frames`; fall back to that
 *  only if `build.flows` is absent, so the two never disagree silently.) */
function flowsOf(manifest) {
  const bf = manifest?.build?.flows;
  if (Array.isArray(bf) && bf.length) return bf;
  const legacy = Array.isArray(manifest?.frames)
    ? manifest.frames.filter((f) => typeof f.approved === 'boolean')
    : [];
  return legacy;
}

/** New-issue URL that records a decision for one flow. Approve and Reject differ
 *  only in the prefilled `decision:` line, so the reviewer's click IS the record. */
function approvalHref(slug, flow, decision, stamp) {
  const flowId = flow.id ?? flow.orchestrator ?? 'flow';
  const title = `design-approval: ${decision} ${slug} / ${flowId}`;
  const body = [
    '<!-- Submit to record your decision. To reject, keep decision: reject and add your reason below. -->',
    '',
    '```yaml',
    `feature: ${slug}`,
    `flow: ${flowId}`,
    `route: ${flow.route ?? ''}`,
    `decision: ${decision}`,
    `stamp: ${stamp ?? ''}`,
    '```',
    '',
    `Frames: ${PAGES_BASE}/${slug}/`,
    '',
    decision === 'reject' ? '**Reason for rejection (required):**' : '_Optional note:_',
    '',
  ].join('\n');
  const q = new URLSearchParams({ title, body, labels: 'design-approval' });
  return `https://github.com/${REPO_SLUG}/issues/new?${q.toString()}`;
}

/** Fixed approval bar injected into every published frame of a feature, so the
 *  reviewer can approve/reject from wherever they are in the flow — not only the
 *  index. Derived entirely from the manifest's flow list. */
function renderApprovalBar(slug, manifest) {
  const flows = flowsOf(manifest);
  const stamp = manifest?.stamp ? String(manifest.stamp).slice(0, 12) : '';
  if (!flows.length) {
    return `<div class="ff-approve"><div class="ff-approve-in"><span class="ff-approve-warn">No flows declared in manifest.build.flows — nothing to approve.</span></div></div>`;
  }
  const rows = flows
    .map((f) => {
      const id = escapeHtml(f.id ?? f.orchestrator ?? 'flow');
      const done = f.approved === true;
      const state = done
        ? `<span class="ff-approve-state ff-ok">approved${f.approvedBy ? ' · ' + escapeHtml(f.approvedBy) : ''}</span>`
        : `<span class="ff-approve-state ff-pending">pending</span>`;
      const actions = done
        ? ''
        : `<a class="ff-btn ff-approve-yes" target="_blank" rel="noopener" href="${escapeHtml(approvalHref(slug, f, 'approve', stamp))}">Approve</a>` +
          `<a class="ff-btn ff-approve-no" target="_blank" rel="noopener" href="${escapeHtml(approvalHref(slug, f, 'reject', stamp))}">Reject</a>`;
      return `<div class="ff-approve-row"><span class="ff-flow">${id}</span>${state}<span class="ff-actions">${actions}</span></div>`;
    })
    .join('');
  return `<div class="ff-approve" data-ff-approve>
  <details open>
    <summary>Review · ${escapeHtml(slug)} <span class="ff-approve-hint">approve or reject each flow ↓</span></summary>
    <div class="ff-approve-in">${rows}</div>
  </details>
</div>
<style>
  .ff-approve{position:fixed;left:0;right:0;bottom:0;z-index:2147483000;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,system-ui,sans-serif;background:#0c0f14ee;backdrop-filter:blur(8px);border-top:2px solid;border-image:linear-gradient(90deg,#4dd6e8,#7b6cf6) 1;box-shadow:0 -8px 24px #0008;color:#e8ecf3}
  .ff-approve summary{cursor:pointer;list-style:none;padding:10px 20px;font-size:13px;font-weight:600;user-select:none}
  .ff-approve summary::-webkit-details-marker{display:none}
  .ff-approve-hint{font-weight:400;color:#6f7b8d;font-size:11px;margin-left:8px}
  .ff-approve-in{padding:4px 20px 16px;display:flex;flex-direction:column;gap:8px;max-height:40vh;overflow:auto}
  .ff-approve-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
  .ff-flow{font-family:ui-monospace,Menlo,monospace;font-size:12px;color:#a8b2c1;min-width:180px}
  .ff-approve-state{font-family:ui-monospace,Menlo,monospace;font-size:10px;text-transform:uppercase;letter-spacing:.08em;padding:2px 8px;border-radius:999px;border:1px solid}
  .ff-ok{color:#5fd08a;border-color:#5fd08a70}
  .ff-pending{color:#f5b950;border-color:#f5b95070}
  .ff-actions{display:flex;gap:8px;margin-left:auto}
  .ff-btn{text-decoration:none;font-size:12px;font-weight:600;padding:5px 14px;border-radius:8px;border:1px solid}
  .ff-approve-yes{color:#0c0f14;background:#5fd08a;border-color:#5fd08a}
  .ff-approve-no{color:#f5b950;background:transparent;border-color:#f5b95070}
  .ff-approve-warn{color:#f5b950;font-size:12px;padding:12px 20px;display:block}
  @media(max-width:640px){.ff-flow{min-width:0}.ff-actions{margin-left:0}}
</style>`;
}

/** Inject the approval bar into an HTML document just before </body> (or append
 *  if none). Idempotent-ish: skips if already present. */
function injectApprovalBar(html, bar) {
  if (html.includes('data-ff-approve')) return html;
  if (html.includes('</body>')) return html.replace('</body>', `${bar}\n</body>`);
  return html + bar;
}

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
  // Per-flow approval lives in build.flows (the source of truth); flowsOf falls
  // back to the legacy `frames` shape so old and new manifests read consistently.
  const perFlow = flowsOf(manifest).filter((f) => typeof f.approved === 'boolean');
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
  // Copy every feature directory, then inject the approval bar into each published
  // .html so the reviewer can approve/reject any flow from wherever they are.
  for (const f of features) {
    const dest = path.join(outDir, f.slug);
    await cp(path.join(framesDir, f.slug), dest, { recursive: true });
    const bar = renderApprovalBar(f.slug, f.manifest);
    const htmlFiles = (await readdir(dest, { withFileTypes: true }))
      .filter((e) => e.isFile() && e.name.endsWith('.html'))
      .map((e) => path.join(dest, e.name));
    for (const file of htmlFiles) {
      const html = await readFile(file, 'utf8');
      await writeFile(file, injectApprovalBar(html, bar), 'utf8');
    }
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
