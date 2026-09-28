#!/usr/bin/env node
// gate-version — a changed published package or API contract must bump its version.
//
// WHY THIS IS ENFORCING
// ---------------------
// packages-publish.yml publishes a package ONLY when its version changed; an
// unchanged version is skipped as "already published". So a PR that changes a
// published package's source without a bump merges green and then never ships —
// consumers keep installing the old code while the tree says otherwise. The
// previous gate-version (inline in harden-gate.yml) could see this but ended in
// `exit 0`, while being a REQUIRED context: a check that could only pass.
//
// It also could not have been flipped as written: it matched every changed file
// against EVERY package.json whose directory is a prefix, so the root
// package.json (dir ".") owned every file in the repo and nested workspaces were
// charged to their parents too. Here each changed file belongs to exactly ONE
// package — the nearest publishable one — or to none.
//
// WHAT COUNTS
// -----------
//   Packages   The publishable set is `node scripts/publish-packages.mjs --list-dirs`
//              — the same definition the publish workflow uses, so the gate and
//              the publisher cannot disagree about what ships. Private apps
//              (backend, frontend, services) are versioned by image SHA in
//              release.yml and are not checked here.
//   Contracts  OpenAPI/Swagger specs: a changed spec must change `info.version`.
//
// Files that do not change what a consumer installs are ignored: tests, markdown,
// lockfiles, and test/lint config (see IGNORED).
//
// A version must be valid SemVer and must INCREASE. A package or spec that is
// new in this PR only needs a valid version.
//
// Usage:
//   node scripts/check-version-bump.mjs [--base <ref>]   # default origin/master

import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

// Changes that never alter the installed artifact.
const IGNORED = [
  /(^|\/)(__tests__|__mocks__|tests?|e2e)\//,
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /\.stories\.[cm]?[jt]sx?$/,
  /\.md$/i,
  /(^|\/)package-lock\.json$/,
  /(^|\/)\.npmrc$/,
  /(^|\/)(jest|vitest|playwright)\.config\.[cm]?[jt]s$/,
  /(^|\/)\.eslintrc(\.[a-z]+)?$/,
  /(^|\/)eslint\.config\.[cm]?js$/,
  /(^|\/)\.prettierrc(\.[a-z]+)?$/,
]

// Frozen history and third-party trees — never a live contract.
const SPEC_EXCLUDED = /(^|\/)(node_modules|docs|sdd|\.github)\//
const SPEC_FILE = /(^|\/)[^/]*(openapi|swagger)[^/]*\.(ya?ml|json)$/i

export function isIgnored(file) {
  return IGNORED.some(re => re.test(file))
}

export function isSpec(file) {
  return SPEC_FILE.test(file) && !SPEC_EXCLUDED.test(file)
}

/** [major, minor, patch, prerelease|null], or null when not SemVer. */
export function parseSemver(v) {
  const m = SEMVER.exec(String(v ?? '').trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3]), m[4] ?? null] : null
}

/** >0 when a > b. Prerelease ordering is simplified: a release outranks any prerelease of it. */
export function compareSemver(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]
  if (a[3] === b[3]) return 0
  if (a[3] === null) return 1
  if (b[3] === null) return -1
  return a[3] < b[3] ? -1 : 1
}

/** The nearest (longest-prefix) publishable dir that owns `file`, or null. */
export function ownerOf(file, dirs) {
  let best = null
  for (const d of dirs) {
    if (file.startsWith(d + '/') && (!best || d.length > best.length)) best = d
  }
  return best
}

/**
 * `info.version` of an OpenAPI/Swagger document, or null. Reads YAML by
 * structure — the first `version:` nested under the top-level `info:` block —
 * rather than the first `version:` anywhere, which in a real spec is as likely
 * to be a schema property.
 */
export function specVersion(text, file = '') {
  if (text == null) return null
  if (/\.json$/i.test(file)) {
    try {
      return JSON.parse(text)?.info?.version ?? null
    } catch {
      return null
    }
  }
  let inInfo = false
  let childIndent = null
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(#|$)/.test(line)) continue
    const indent = line.length - line.trimStart().length
    if (indent === 0) {
      if (inInfo) return null
      inInfo = /^info:\s*$/.test(line)
      continue
    }
    if (!inInfo) continue
    if (childIndent === null) childIndent = indent
    if (indent !== childIndent) continue
    const m = /^\s*version:\s*(.+?)\s*$/.exec(line)
    if (m) return m[1].replace(/\s+#.*$/, '').replace(/^['"]|['"]$/g, '')
  }
  return null
}

/** One finding per violation; empty when the bump is fine. */
export function checkBump(label, oldV, newV) {
  if (newV == null || newV === '') return [`${label}: has no version`]
  const n = parseSemver(newV)
  if (!n) return [`${label}: version '${newV}' is not valid SemVer`]
  if (oldV == null) return [] // new in this PR
  const o = parseSemver(oldV)
  if (!o) return [] // base was not SemVer; any valid SemVer now is an improvement
  const cmp = compareSemver(n, o)
  if (cmp === 0)
    return [`${label}: changed but version not bumped (still ${oldV})`]
  if (cmp < 0) return [`${label}: version went backwards (${oldV} -> ${newV})`]
  return []
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 << 20 })
}

function atBase(base, file) {
  try {
    return git(['show', `${base}:${file}`])
  } catch {
    return null
  }
}

function main() {
  const i = process.argv.indexOf('--base')
  const base = i === -1 ? 'origin/master' : process.argv[i + 1]

  const changed = git([
    'diff',
    '--name-only',
    '--diff-filter=ACMR',
    `${base}...HEAD`,
  ])
    .split('\n')
    .filter(Boolean)

  const dirs = execFileSync(
    'node',
    ['scripts/publish-packages.mjs', '--list-dirs'],
    {
      encoding: 'utf8',
    }
  )
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)
  if (dirs.length === 0) {
    // Fail closed: an empty publishable set would make this gate vacuous.
    console.error(
      '::error title=gate-version::publish-packages.mjs --list-dirs returned no packages'
    )
    process.exit(1)
  }

  const findings = []

  const touched = new Map()
  for (const f of changed) {
    if (isIgnored(f)) continue
    const owner = ownerOf(f, dirs)
    if (owner) touched.set(owner, [...(touched.get(owner) ?? []), f])
  }
  for (const [dir, files] of touched) {
    const pj = `${dir}/package.json`
    const head = JSON.parse(readFileSync(pj, 'utf8'))
    const baseText = atBase(base, pj)
    const oldV = baseText ? JSON.parse(baseText).version : null
    for (const msg of checkBump(
      `package ${head.name} (${dir})`,
      oldV,
      head.version
    )) {
      findings.push(
        `${msg} — changed: ${files.slice(0, 3).join(', ')}${files.length > 3 ? ', …' : ''}`
      )
    }
  }

  for (const spec of changed.filter(isSpec)) {
    const newV = specVersion(readFileSync(spec, 'utf8'), spec)
    const oldText = atBase(base, spec)
    const oldV = oldText == null ? null : specVersion(oldText, spec)
    findings.push(
      ...checkBump(`API contract ${spec} (info.version)`, oldV, newV)
    )
  }

  for (const f of findings) console.log(`::error title=gate-version::${f}`)
  if (findings.length > 0) {
    console.log(
      `gate-version: ${findings.length} finding(s). Bump per SemVer — fix: patch, feat: minor, ` +
        'breaking: major (.claude/skills/versioning/SKILL.md). An unbumped published package is ' +
        'skipped by packages-publish and never ships.'
    )
    process.exit(1)
  }
  console.log(
    `gate-version: OK (${touched.size} published package(s), ` +
      `${changed.filter(isSpec).length} contract(s) touched; all bumped)`
  )
}

if (process.argv[1]?.endsWith('check-version-bump.mjs')) main()
