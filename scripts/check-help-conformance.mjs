#!/usr/bin/env node
/**
 * gate-help-conformance — the help system cannot ship stale, wrong, or placeholder content.
 *
 * THE GAP THIS EXISTS TO CLOSE
 * ----------------------------
 * frontend/src/pages/HelpPage.tsx sat in production for a long time telling every user and
 * developer things that were simply false: it called the product "FrontFuse", hard-coded
 * http://localhost:3001 as the API host, told developers to `npm install @frontfuse/sdk`
 * (a package that does not and never did exist — the scope is @fuzefront), gave Netlify/Vercel/
 * AWS deploy instructions for a platform that deploys via Kubernetes/Helm/Argo, and pointed
 * support at support@frontfuse.dev / discord.gg/frontfuse / github.com/your-org/frontfuse.
 *
 * Every one of those is a deterministic, greppable defect. Nothing caught them because nothing
 * looked. This gate looks — at the help content tree (docs/help/**) AND at the help UI source
 * (frontend/src/pages/HelpPage.tsx) — so that class of rot cannot reach production again.
 *
 * WHAT IT CHECKS (all config lives in governance/help-system-policy.json):
 *   - forbidden terms (FrontFuse, @frontfuse/, localhost:3001, admin123, …) — HARD FAIL
 *   - placeholder/localhost/example URLs in published surfaces                — HARD FAIL
 *   - unfinished markers (TODO/TBD/…) in a status:published article           — HARD FAIL
 *   - required, well-formed frontmatter on every published article            — HARD FAIL
 *   - manifest.json ↔ on-disk article coverage is bidirectional               — HARD FAIL
 *   - internal relative links resolve                                         — HARD FAIL
 *   - referenced media exists, has alt text, is not a placeholder asset       — HARD FAIL
 *   - article freshness (lastReviewed age)                        — RAMP (warn → fail by policy)
 *
 * USAGE
 *   node scripts/check-help-conformance.mjs --base origin/master   # diff against a ref
 *   node scripts/check-help-conformance.mjs --files a.md b.tsx     # explicit file list
 *   node scripts/check-help-conformance.mjs --all                  # scan the whole surface
 *
 * Exit 0 = clean (or only warnings); 1 = at least one hard failure (or freshness under mode=fail).
 *
 * Node 20+, stdlib only — no YAML or markdown dependency (frontmatter is parsed from a restricted,
 * documented subset; see parseFrontmatter).
 */

import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const POLICY_PATH = path.join(REPO_ROOT, 'governance', 'help-system-policy.json')

const RED = s => `\x1b[31m${s}\x1b[0m`
const GREEN = s => `\x1b[32m${s}\x1b[0m`
const YELLOW = s => `\x1b[33m${s}\x1b[0m`
const DIM = s => `\x1b[2m${s}\x1b[0m`

/* ------------------------------------------------------------------ globbing */

const GLOB_CACHE = new Map()

/** Translate a glob (`**`, `*`, `?`, `{a,b}`) to an anchored RegExp. `*` never crosses `/`. */
export function globToRegExp(glob) {
  const cached = GLOB_CACHE.get(glob)
  if (cached) return cached
  if (typeof glob !== 'string') throw new Error(`glob must be a string, got ${typeof glob}`)
  if (glob.length > 200) throw new Error(`glob too long (likely a mistake): ${glob.slice(0, 60)}…`)
  if (glob.includes('***')) throw new Error(`glob contains "***": ${glob}`)
  let re = ''
  let brace = 0
  const appendWildcard = atom => { if (!re.endsWith(atom)) re += atom }
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') { appendWildcard('(?:[^/]*/)*'); i += 2 }
        else { appendWildcard('.*'); i += 1 }
      } else re += '[^/]*'
    } else if (c === '?') re += '[^/]'
    else if (c === '{') { brace++; re += '(?:' }
    else if (c === '}' && brace > 0) { brace--; re += ')' }
    else if (c === ',' && brace > 0) re += '|'
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  // Repo-controlled, length-capped, fixed wildcard atoms — no untrusted input.
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
  const compiled = new RegExp('^' + re + '$')
  GLOB_CACHE.set(glob, compiled)
  return compiled
}

export function matchesAny(file, globs) {
  return (globs || []).some(g => globToRegExp(g).test(file))
}

/* ----------------------------------------------------------- frontmatter parse */

/**
 * Parse the YAML frontmatter block from a markdown file. DELIBERATELY a restricted subset, so
 * the gate carries no YAML dependency and the accepted shape is unambiguous:
 *   - top-level scalars:   key: value            (optional surrounding quotes stripped)
 *   - one list field, media, of FLOW maps:
 *         media:
 *           - { src: _assets/x.png, alt: "The X screen", type: image }
 * Anything else in the block is ignored. Returns { data, found } where data is a plain object;
 * media (if present) is an array of { src, alt, type } objects.
 */
export function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  if (!m) return { data: {}, found: false }
  const body = m[1]
  const lines = body.split(/\r?\n/)
  const data = {}
  let inMedia = false
  const strip = v => v.replace(/^['"]|['"]$/g, '').trim()
  // Scalar values may carry an inline YAML comment (`status: published # published | draft`),
  // which the authoring template uses. Drop an unquoted trailing ` #…` the way YAML does; a
  // quoted value is kept verbatim so a legitimate '#' inside quotes survives.
  const scalar = raw => {
    const v = raw.trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1)
    const h = v.search(/\s#/)
    return (h === -1 ? v : v.slice(0, h)).trim()
  }
  for (const line of lines) {
    if (!line.trim()) continue
    if (/^media:\s*$/.test(line)) { inMedia = true; data.media = []; continue }
    if (inMedia && /^\s*-\s*\{.*\}\s*$/.test(line)) {
      const inner = line.replace(/^\s*-\s*\{/, '').replace(/\}\s*$/, '')
      const entry = {}
      // split on commas that are not inside quotes
      for (const pair of inner.split(/,(?=(?:[^"']*["'][^"']*["'])*[^"']*$)/)) {
        const kv = /^\s*([A-Za-z0-9_]+)\s*:\s*(.*)$/.exec(pair)
        if (kv) entry[kv[1]] = strip(kv[2])
      }
      data.media.push(entry)
      continue
    }
    const top = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line)
    if (top) { inMedia = false; data[top[1]] = scalar(top[2]) }
  }
  return { data, found: true }
}

/* ----------------------------------------------------------------- scanners */

/** Returns the body text below the frontmatter (or the whole text if none). */
export function bodyOf(text) {
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(text)
  return m ? text.slice(m[0].length) : text
}

export function scanForbiddenTerms(relPath, text, policy) {
  const out = []
  for (const e of policy.forbiddenTerms?.entries ?? []) {
    if (matchesAny(relPath, e.allowIn || [])) continue
    if (text.toLowerCase().includes(e.term.toLowerCase())) {
      out.push({ kind: 'forbidden-term', term: e.term, reason: e.reason })
    }
  }
  return out
}

const URL_RE = /https?:\/\/[^\s"'`)>\]]+/g

export function scanForbiddenUrls(text, policy) {
  const out = []
  const urls = text.match(URL_RE) || []
  for (const url of urls) {
    for (const p of policy.forbiddenUrlPatterns?.entries ?? []) {
      // p.pattern is a repo-controlled policy value (governance/help-system-policy.json, reviewed
      // in a PR), not untrusted input, and this is a CI tool, not a request path.
      // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
      if (new RegExp(p.pattern, 'i').test(url)) out.push({ kind: 'forbidden-url', url, reason: p.reason })
    }
  }
  return out
}

export function scanPlaceholders(text, policy, status) {
  const allowed = policy.placeholderMarkers?.allowedInStatus ?? []
  if (allowed.includes(status)) return []
  const out = []
  for (const marker of policy.placeholderMarkers?.entries ?? []) {
    // word-ish boundary so "todo" inside "methodology" does not trip. `marker` is a repo-controlled
    // policy value and is regex-escaped here; not untrusted input.
    // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
    const re = new RegExp(`(^|[^A-Za-z])${marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z]|$)`, 'i')
    if (re.test(text)) out.push({ kind: 'placeholder', marker })
  }
  return out
}

/* ---------------------------------------------------------- frontmatter checks */

export function checkFrontmatter(data, found, policy) {
  const out = []
  const fm = policy.frontmatter ?? {}
  if (!found) { out.push({ kind: 'frontmatter', msg: 'missing YAML frontmatter block' }); return out }
  for (const field of fm.required ?? []) {
    if (data[field] === undefined || data[field] === '') out.push({ kind: 'frontmatter', msg: `missing required field: ${field}` })
  }
  if (data.audience && !(fm.audienceValues ?? []).includes(data.audience))
    out.push({ kind: 'frontmatter', msg: `audience "${data.audience}" not one of ${(fm.audienceValues ?? []).join('|')}` })
  if (data.status && !(fm.statusValues ?? []).includes(data.status))
    out.push({ kind: 'frontmatter', msg: `status "${data.status}" not one of ${(fm.statusValues ?? []).join('|')}` })
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- fm.ownerPattern is repo-controlled policy config
  if (data.owner && fm.ownerPattern && !new RegExp(fm.ownerPattern).test(data.owner))
    out.push({ kind: 'frontmatter', msg: `owner "${data.owner}" must match ${fm.ownerPattern}` })
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- fm.datePattern is repo-controlled policy config
  if (data.lastReviewed && fm.datePattern && !new RegExp(fm.datePattern).test(data.lastReviewed))
    out.push({ kind: 'frontmatter', msg: `lastReviewed "${data.lastReviewed}" must be YYYY-MM-DD` })
  return out
}

/** Freshness is the one rampable check. Returns { stale, ageDays } or null. */
export function checkFreshness(data, policy, today = new Date()) {
  const days = policy.freshness?.days
  if (!days || !data.lastReviewed) return null
  const reviewed = new Date(data.lastReviewed + 'T00:00:00Z')
  if (Number.isNaN(reviewed.getTime())) return null
  const ageDays = Math.floor((today.getTime() - reviewed.getTime()) / 86400000)
  return ageDays > days ? { stale: true, ageDays } : { stale: false, ageDays }
}

/* -------------------------------------------------------------- media checks */

export function checkMedia(relPath, data, policy, { statOf, existsOf }) {
  const out = []
  const mediaCfg = policy.media ?? {}
  const articleDir = path.posix.dirname(relPath)
  for (const entry of data.media ?? []) {
    if (!entry.src) { out.push({ kind: 'media', msg: 'media entry has no src' }); continue }
    if (mediaCfg.requireAlt && !entry.alt) out.push({ kind: 'media', msg: `media ${entry.src} has no alt/caption text` })
    const type = entry.type || (entry.src.startsWith('http') ? 'video' : 'image')
    if (type === 'video') {
      if (/^https?:\/\//.test(entry.src)) {
        const host = entry.src.replace(/^https?:\/\//, '').split('/')[0]
        if ((mediaCfg.videoAllowedHosts ?? []).length && !mediaCfg.videoAllowedHosts.includes(host))
          out.push({ kind: 'media', msg: `video host "${host}" not in videoAllowedHosts` })
      }
      continue // video is hosted, not committed to git
    }
    // image: resolve the src, check it exists, is non-empty, allowed ext, not placeholder.
    // The documented reference format is help-root-relative `_assets/<slug>/x.png` (see
    // docs/help/_assets/README.md and the policy frontmatter example), which resolves against
    // the parent of media.assetDir (i.e. docs/help). A `docs/`-prefixed src is taken as-is; any
    // other relative src falls back to article-relative.
    const assetDir = mediaCfg.assetDir || 'docs/help/_assets'
    const helpRoot = path.posix.dirname(assetDir)
    let rel
    if (entry.src.startsWith('docs/')) rel = entry.src
    else if (entry.src.startsWith('_assets/')) rel = path.posix.join(helpRoot, entry.src)
    else rel = path.posix.join(articleDir, entry.src)
    const ext = path.posix.extname(rel).toLowerCase()
    if ((mediaCfg.allowedImageExtensions ?? []).length && !mediaCfg.allowedImageExtensions.includes(ext))
      out.push({ kind: 'media', msg: `media ${rel} extension "${ext}" not allowed` })
    if (!existsOf(rel)) { out.push({ kind: 'media', msg: `media file does not exist: ${rel}` }); continue }
    const st = statOf(rel)
    if (mediaCfg.forbidPlaceholderAssets && st && st.size === 0)
      out.push({ kind: 'media', msg: `media file is a 0-byte placeholder: ${rel}` })
    if (mediaCfg.maxImageKB && st && st.size > mediaCfg.maxImageKB * 1024 && ext !== '.svg')
      out.push({ kind: 'media', msg: `media ${rel} is ${Math.round(st.size / 1024)}KB > maxImageKB ${mediaCfg.maxImageKB}` })
  }
  return out
}

/* -------------------------------------------------------------- link checks */

const MD_LINK_RE = /\[[^\]]*\]\(([^)]+)\)/g

export function checkInternalLinks(relPath, body, { existsOf }) {
  const out = []
  const articleDir = path.posix.dirname(relPath)
  let m
  while ((m = MD_LINK_RE.exec(body))) {
    let target = m[1].trim().split(/\s+/)[0] // drop any "title"
    if (/^(https?:|mailto:|tel:|#)/.test(target)) continue // external or anchor
    target = target.split('#')[0].split('?')[0]
    if (!target) continue
    const rel = target.startsWith('docs/') ? target : path.posix.normalize(path.posix.join(articleDir, target))
    if (!existsOf(rel)) out.push({ kind: 'link', msg: `internal link target does not exist: ${target}` })
  }
  return out
}

/* --------------------------------------------------- manifest coverage check */

export function checkManifestCoverage(manifest, onDiskArticles) {
  const out = []
  const listed = new Set()
  for (const section of manifest?.sections ?? []) {
    for (const a of section.articles ?? []) listed.add(a)
  }
  const onDisk = new Set(onDiskArticles)
  for (const a of listed) if (!onDisk.has(a)) out.push({ kind: 'manifest', msg: `manifest lists "${a}" but no such article exists (dangling nav item)` })
  for (const a of onDisk) if (!listed.has(a)) out.push({ kind: 'manifest', msg: `article "${a}" exists but is not listed in manifest.json (orphan)` })
  return out
}

/* --------------------------------------------------------- per-file driver */

function isContentArticle(relPath, policy) {
  if (!relPath.endsWith('.md')) return false
  if (!(policy.contentRoots ?? []).some(r => relPath.startsWith(r + '/'))) return false
  if (matchesAny(relPath, policy.exemptPaths?.paths ?? [])) return false
  if (path.basename(relPath).startsWith('_')) return false
  return true
}

function isCodeSurface(relPath, policy) {
  return (policy.codeSurfaces ?? []).includes(relPath)
}

/** Check one content article. io = { existsOf, statOf, today }. Returns { errors, warnings }. */
export function checkArticle(relPath, text, policy, io) {
  const errors = []
  const warnings = []
  const { data, found } = parseFrontmatter(text)
  const status = data.status || 'published'
  errors.push(...checkFrontmatter(data, found, policy))
  errors.push(...scanForbiddenTerms(relPath, text, policy))
  errors.push(...scanForbiddenUrls(text, policy))
  errors.push(...scanPlaceholders(bodyOf(text), policy, status))
  errors.push(...checkMedia(relPath, data, policy, io))
  if (policy.links?.checkInternalRelative) errors.push(...checkInternalLinks(relPath, bodyOf(text), io))
  const fresh = checkFreshness(data, policy, io.today)
  if (fresh?.stale) {
    const entry = { kind: 'freshness', msg: `lastReviewed is ${fresh.ageDays} days old (> ${policy.freshness.days})` }
    if ((policy.freshness?.mode ?? 'warn') === 'fail') errors.push(entry)
    else warnings.push(entry)
  }
  return { errors, warnings }
}

/** Check one code surface (e.g. HelpPage.tsx) — forbidden terms/URLs/placeholders, no frontmatter. */
export function checkCode(relPath, text, policy) {
  const errors = []
  errors.push(...scanForbiddenTerms(relPath, text, policy))
  errors.push(...scanForbiddenUrls(text, policy))
  errors.push(...scanPlaceholders(text, policy, 'published'))
  return { errors, warnings: [] }
}

/**
 * Decide whether a diff must be escalated to a full-surface scan. Tightening a machine rule
 * (the policy JSON) must revalidate the content it governs — otherwise a PR that only edits the
 * policy passes with zero files checked. Likewise, deleting or renaming an article (or changing
 * the manifest) can break incoming links/media refs in UNCHANGED articles, which a diff-scoped
 * run never looks at. In those cases we scan everything.
 */
export function shouldFullScan(changed, policy, policyRel, existsOf) {
  if (changed.includes(policyRel)) return true
  if (policy.manifest?.path && changed.includes(policy.manifest.path)) return true
  return changed.some(f => isContentArticle(f, policy) && !existsOf(f)) // deleted/renamed target
}

/* --------------------------------------------------------------------- I/O */

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name)
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback
}
const hasFlag = name => process.argv.includes(name)
function argList(name) {
  const i = process.argv.indexOf(name)
  if (i === -1) return null
  const out = []
  for (let j = i + 1; j < process.argv.length && !process.argv[j].startsWith('--'); j++) out.push(process.argv[j])
  return out
}

function gitFiles(args, max = 64 * 1024 * 1024) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: max })
    .split('\n').map(s => s.trim()).filter(Boolean)
}

/** Every tracked article under the content roots, repo-relative, POSIX. */
function allArticles(policy) {
  const out = []
  for (const root of policy.contentRoots ?? []) {
    const abs = path.join(REPO_ROOT, root)
    if (!existsSync(abs)) continue
    const walk = dir => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else {
          const rel = path.relative(REPO_ROOT, p).split(path.sep).join('/')
          if (isContentArticle(rel, policy)) out.push(rel)
        }
      }
    }
    walk(abs)
  }
  return out.sort()
}

async function main() {
  const policy = JSON.parse(readFileSync(POLICY_PATH, 'utf8'))
  const existsOf = rel => existsSync(path.join(REPO_ROOT, rel))
  const statOf = rel => { try { return statSync(path.join(REPO_ROOT, rel)) } catch { return null } }
  const io = { existsOf, statOf, today: new Date() }

  const policyRel = path.relative(REPO_ROOT, POLICY_PATH).split(path.sep).join('/')
  let changed
  if (hasFlag('--all')) {
    changed = [...allArticles(policy), ...(policy.codeSurfaces ?? []).filter(existsOf)]
  } else {
    const explicit = argList('--files')
    const base = arg('--base', 'origin/master')
    changed = explicit ?? gitFiles(['diff', '--name-only', `${base}...HEAD`])
    // Not in explicit --files mode (targeted/local checks and the unit tests).
    if (!explicit && shouldFullScan(changed, policy, policyRel, existsOf)) {
      changed = [...new Set([...changed.filter(existsOf), ...allArticles(policy), ...(policy.codeSurfaces ?? []).filter(existsOf)])]
      console.log(DIM('(policy/manifest change or article removal → full-surface scan)'))
    }
  }

  const articles = changed.filter(f => isContentArticle(f, policy))
  const codeSurfaces = changed.filter(f => isCodeSurface(f, policy))
  const manifestTouched = changed.includes(policy.manifest?.path) || articles.length > 0

  let hardFailures = 0
  let warnings = 0
  const report = (file, res) => {
    for (const e of res.errors) { console.log(`${RED('FAIL')} ${file}  ${e.reason || e.msg}${e.term ? ` (“${e.term}”)` : ''}${e.url ? ` (${e.url})` : ''}`); hardFailures++ }
    for (const w of res.warnings) { console.log(`${YELLOW('warn')} ${file}  ${w.msg}`); warnings++ }
  }

  for (const f of articles) {
    if (!existsOf(f)) continue // deleted in this diff
    report(f, checkArticle(f, readFileSync(path.join(REPO_ROOT, f), 'utf8'), policy, io))
  }
  for (const f of codeSurfaces) {
    if (!existsOf(f)) continue
    report(f, checkCode(f, readFileSync(path.join(REPO_ROOT, f), 'utf8'), policy))
  }

  // Manifest coverage runs against the WHOLE on-disk surface whenever any article or the
  // manifest itself changed — coverage is a property of the set, not of one file.
  if (policy.manifest?.requireBidirectional && manifestTouched) {
    const manifestPath = path.join(REPO_ROOT, policy.manifest.path)
    if (!existsSync(manifestPath)) { console.log(`${RED('FAIL')} ${policy.manifest.path}  manifest file is missing`); hardFailures++ }
    else {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      for (const e of checkManifestCoverage(manifest, allArticles(policy))) { console.log(`${RED('FAIL')} ${policy.manifest.path}  ${e.msg}`); hardFailures++ }
    }
  }

  console.log(DIM(`\nchecked ${articles.length} article(s), ${codeSurfaces.length} code surface(s); policy=${path.relative(REPO_ROOT, POLICY_PATH)} freshness.mode=${policy.freshness?.mode}`))
  if (hardFailures) {
    console.error(RED(`\ngate-help-conformance: ${hardFailures} hard failure(s).`))
    console.error(DIM('See governance/help-system-policy.md and .claude/skills/help-system/ for how to fix each.'))
    return 1
  }
  console.log(GREEN(`\ngate-help-conformance: OK${warnings ? ` (${warnings} warning(s) — not blocking)` : ''}`))
  return 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code }).catch(err => { console.error(RED(err.stack || err.message || err)); process.exitCode = 1 })
}
