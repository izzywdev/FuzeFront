#!/usr/bin/env node
/**
 * build-api-docs.mjs — generate static Swagger UI pages for every service
 * that ships an openapi.yaml, and write them into the Pages site.
 *
 * Discovery rule: services/*\/openapi.yaml — adding a spec file is the only
 * action a new service needs. No hand-maintained list. (Same philosophy as
 * build-frames-site.mjs derives its index from design/frames/*\/.)
 *
 * Output layout (relative to --out, default _site/api):
 *   api/
 *     index.html            ← listing of all discovered services
 *     <service-slug>/
 *       index.html          ← Swagger UI, loads ./openapi.yaml
 *       openapi.yaml        ← verbatim copy of the spec
 *
 * Usage: node scripts/build-api-docs.mjs [--out <dir>] [--services <dir>]
 */
import { readdir, readFile, mkdir, copyFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function arg(name, fallback) {
  const i = process.argv.indexOf(name)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const servicesDir = path.resolve(arg('--services', path.join(repoRoot, 'services')))
const outDir = path.resolve(arg('--out', path.join(repoRoot, '_site', 'api')))

const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  )

/** Discover services that have an openapi.yaml. */
async function discoverServices() {
  const entries = await readdir(servicesDir, { withFileTypes: true })
  const services = []
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('_') || e.name.startsWith('.')) continue
    const specPath = path.join(servicesDir, e.name, 'openapi.yaml')
    if (!existsSync(specPath)) continue
    const raw = await readFile(specPath, 'utf8')
    // Pull title / version / summary from the YAML header without a parser dep.
    const title = (raw.match(/^  title:\s*(.+)$/m) ?? [])[1]?.trim() ?? e.name
    const version = (raw.match(/^  version:\s*(.+)$/m) ?? [])[1]?.trim() ?? ''
    const summary = (raw.match(/^  summary:\s*(.+)$/m) ?? [])[1]?.trim() ?? ''
    // Derive a URL slug from the service directory name (strip trailing '-service').
    const slug = e.name.replace(/-service$/, '')
    services.push({ dir: e.name, slug, specPath, title, version, summary })
  }
  return services.sort((a, b) => a.slug.localeCompare(b.slug))
}

/** Generate a self-contained Swagger UI page that loads the spec from ./openapi.yaml. */
function renderSwaggerPage(service) {
  // Swagger UI loaded from unpkg (pinned major; GitHub Pages is a public site).
  // deepLinking preserves the selected operation in the URL hash so links are shareable.
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(service.title)} — API Docs</title>
<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
<style>
  :root { --bg: #0c0f14; --text: #e8ecf3; --cyan: #4dd6e8; --border: #232b37; }
  body { margin: 0; background: var(--bg); color: var(--text); }
  .ff-nav {
    position: sticky; top: 0; z-index: 9000;
    background: #0c0f14ee; backdrop-filter: blur(8px);
    border-bottom: 1px solid var(--border);
    padding: 10px 24px; display: flex; align-items: center; gap: 20px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif;
    font-size: 13px;
  }
  .ff-nav a { color: var(--cyan); text-decoration: none; }
  .ff-nav a:hover { text-decoration: underline; }
  .ff-nav .sep { color: #35404f; }
  .ff-nav .title { color: var(--text); font-weight: 600; }
  #swagger-ui .topbar { display: none; }
  /* Adapt Swagger UI to the dark shell */
  #swagger-ui { filter: none; }
  .swagger-ui .info .title,
  .swagger-ui .info p,
  .swagger-ui .info li,
  .swagger-ui .opblock-summary-description { color: var(--text); }
</style>
</head>
<body>
<nav class="ff-nav">
  <a href="../../">← Design Frames</a>
  <span class="sep">/</span>
  <a href="../">API Docs</a>
  <span class="sep">/</span>
  <span class="title">${escapeHtml(service.title)}</span>
  ${service.version ? `<span style="color:#6f7b8d;font-family:monospace;font-size:11px">v${escapeHtml(service.version)}</span>` : ''}
  <a href="./openapi.yaml" style="margin-left:auto;color:#6f7b8d;font-size:11px">openapi.yaml ↓</a>
</nav>
<div id="swagger-ui"></div>
<script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
<script>
  SwaggerUIBundle({
    url: './openapi.yaml',
    dom_id: '#swagger-ui',
    presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
    layout: 'BaseLayout',
    deepLinking: true,
    filter: true,
    tryItOutEnabled: false,
  })
</script>
</body>
</html>
`
}

/** Generate the API docs index listing all discovered services. */
function renderApiIndex(services) {
  const PAGES_BASE = 'https://izzywdev.github.io/FuzeFront'

  const cards = services
    .map((s) => `      <a class="card" href="${escapeHtml(s.slug)}/">
        <div class="seam"></div>
        <div class="slug">${escapeHtml(s.dir)}</div>
        <h2>${escapeHtml(s.title)}</h2>
        ${s.summary ? `<p>${escapeHtml(s.summary)}</p>` : ''}
        <div class="card-meta">
          ${s.version ? `<span class="pill">v${escapeHtml(s.version)}</span>` : ''}
          <a class="spec-link" href="${escapeHtml(s.slug)}/openapi.yaml">openapi.yaml</a>
        </div>
      </a>`)
    .join('\n')

  const empty = `      <p class="dim">No services with <code>openapi.yaml</code> found under <code>services/</code>.</p>`

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>FuzeFront — API Docs</title>
<style>
  :root {
    --bg: #0c0f14; --bg-2: #12161d; --bg-3: #171c25;
    --text: #e8ecf3; --text-2: #a8b2c1; --text-3: #6f7b8d;
    --border: #232b37; --border-strong: #35404f;
    --cyan: #4dd6e8; --seam: linear-gradient(90deg, #4dd6e8, #7b6cf6);
    --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif; }
  .wrap { max-width: 960px; margin: 0 auto; padding: 64px 32px 96px; }
  .nav { margin-bottom: 40px; font-size: 13px; }
  .nav a { color: var(--cyan); text-decoration: none; }
  .nav a:hover { text-decoration: underline; }
  .eyebrow { font-family: var(--mono); font-size: 11px; letter-spacing: .14em;
    text-transform: uppercase; color: var(--cyan); margin-bottom: 12px; }
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
  .spec-link { font-family: var(--mono); font-size: 11px; color: var(--cyan); text-decoration: none; margin-left: auto; }
  .spec-link:hover { text-decoration: underline; }
  .dim { color: var(--text-3); font-family: var(--mono); }
  footer { margin-top: 56px; padding-top: 24px; border-top: 1px solid var(--border);
    color: var(--text-3); font-size: 12px; line-height: 1.7; }
  footer a { color: var(--cyan); }
</style>
</head>
<body>
<div class="wrap">
  <div class="nav"><a href="../">← Design Frames</a></div>
  <div class="eyebrow">FuzeFront · Published APIs</div>
  <h1>API Docs</h1>
  <p class="lead">Browsable Swagger UI for every FuzeFront service that ships an
    <code>openapi.yaml</code>. Discovered automatically from <code>services/*/openapi.yaml</code> —
    adding a spec is the only action needed for a service to appear here.</p>

  <div class="grid">
${services.length ? cards : empty}
  </div>

  <footer>
    Generated by <code>scripts/build-api-docs.mjs</code> · published by
    <code>.github/workflows/pages-frames.yml</code> ·
    source: <a href="https://github.com/izzywdev/FuzeFront/tree/master/services">services/*/openapi.yaml</a>
  </footer>
</div>
</body>
</html>
`
}

async function main() {
  if (!existsSync(servicesDir)) {
    console.error(`services dir not found: ${servicesDir}`)
    process.exit(1)
  }
  const services = await discoverServices()
  await mkdir(outDir, { recursive: true })

  for (const s of services) {
    const dest = path.join(outDir, s.slug)
    await mkdir(dest, { recursive: true })
    await copyFile(s.specPath, path.join(dest, 'openapi.yaml'))
    await writeFile(path.join(dest, 'index.html'), renderSwaggerPage(s), 'utf8')
  }

  await writeFile(path.join(outDir, 'index.html'), renderApiIndex(services), 'utf8')

  console.log(`Built API docs for ${services.length} service(s) -> ${outDir}`)
  for (const s of services) {
    console.log(`  - ${s.dir} (${s.title} v${s.version})`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
