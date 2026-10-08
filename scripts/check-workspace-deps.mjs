#!/usr/bin/env node
// Enforce: an in-repo package referenced by a consumer must resolve LOCALLY.
//
// The PR #65 failure: frontend/package.json listed "@fuzefront/identity-ui": "^0.1.0"
// for a package that lives in this repo but was not a resolvable workspace, so
// `npm ci` tried the registry and 404'd. design-system worked because it resolved
// from source. This gate makes that class of break a fast, deterministic CI failure
// instead of a registry 404 deep in the build.
//
// Rule: if a dependency name matches a package that physically exists in this repo,
// the version spec must resolve to that local package — i.e. EITHER
//   * use the workspace:/file:/link: protocol, OR
//   * the local package's directory is covered by the root package.json "workspaces"
//     globs (so npm resolves it from the workspace).
// A bare semver ("^0.1.0", "1.0.0", "*", "latest") on an in-repo package that is NOT
// a registered workspace is a violation — it falls back to the registry.
//
// SECOND RULE — the range must also be SATISFIED by the local version.
//
// Resolvability is not correctness. Being a registered workspace made the first rule
// `continue` without ever comparing the spec to the version it resolves to, so a range
// could drift arbitrarily far from reality and nothing said a word. Measured 2026-08-27:
// account-security-ui / identity-ui / portal-admin-ui each declared
// `peerDependencies["@fuzefront/security-client"]` at ^0.5.0 / ^0.6.0 / ^0.7.0 while the
// workspace shipped 0.8.0 — and under 0.x semantics a caret does NOT span minors, so
// every one of those ranges was unsatisfiable by the very package it names.
//
// Unsatisfied ranges can also make npm fetch an unavailable registry version during
// an in-repo install rather than use the workspace. Published consumers following
// docs/guides/BUILDING_ON_FUZEFRONT.md installs @fuzefront/account-security-ui and gets
// ERESOLVE against the published @fuzefront/security-client@0.8.0. The drift arrived
// because a client release bumps its own version and the consumers' exact devDep pins
// (the #704 / #834 convention) but nothing pulled the peer ranges along.
//
// Dependency-free — including this rule. `semver` is NOT importable here: the workflow
// runs the script with no `npm ci` step (that is what makes it cheap enough to run
// unfiltered on every PR), so node_modules does not exist in CI. The comparator below
// therefore handles only the forms this repo actually uses on in-repo packages — exact,
// ^, ~, and the `*`/`x` wildcards — and anything else is counted as UNCHECKED and
// printed in the summary rather than silently passing. A rising unchecked count is the
// signal to widen the parser; it must never read as conformant.
//
// Run from the repo root: `node scripts/check-workspace-deps.mjs`.

import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = process.cwd()
const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
const LOCAL_PROTOCOLS = ['workspace:', 'file:', 'link:', 'portal:']

function readJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return null }
}

// All tracked package.json files, excluding build output / vendored deps.
const pkgFiles = execFileSync('git', ['ls-files', '*package.json'], { encoding: 'utf8' })
  .split(/\r?\n/)
  .filter(Boolean)
  .filter((f) => !/(^|\/)node_modules\//.test(f) && !/(^|\/)dist\//.test(f))

// name -> { dir (repo-relative, posix), version } for every package that lives in the repo.
const localPkgs = new Map()
for (const f of pkgFiles) {
  const p = readJson(resolve(root, f))
  if (p?.name) localPkgs.set(p.name, { dir: dirname(f).split(sep).join('/'), version: p.version ?? null })
}

// Root "workspaces" globs -> a matcher over repo-relative posix dirs.
//
// Matched by walking path SEGMENTS, not by compiling the glob into a RegExp. Building a
// regex at runtime out of package.json content is an unbounded-backtracking (ReDoS)
// surface -- the previous expansion (`**` -> `.*`, `*` -> `[^/]+`, via a NUL sentinel)
// turns a glob such as `packages/**/**/*x` into adjacent greedy quantifiers that
// backtrack catastrophically on a long non-matching path -- and it bought nothing: npm
// workspace globs only ever need `*` (any run of characters WITHIN one segment) and `**`
// (any number of whole segments). Both are matched directly below, in bounded time.
const rootPkg = readJson(resolve(root, 'package.json')) ?? {}
const wsGlobs = Array.isArray(rootPkg.workspaces) ? rootPkg.workspaces : rootPkg.workspaces?.packages ?? []

// One segment; `*` matches any run of characters. Classic single-star wildcard match:
// exactly one resume point is ever retained, so the worst case is O(pat x seg), never
// exponential.
export function matchSegment(pat, seg) {
  let p = 0
  let s = 0
  let starP = -1
  let starS = 0
  while (s < seg.length) {
    if (p < pat.length && pat[p] === '*') {
      starP = p++
      starS = s
    } else if (p < pat.length && pat[p] === seg[s]) {
      p++
      s++
    } else if (starP !== -1) {
      p = starP + 1
      s = ++starS
    } else {
      return false
    }
  }
  while (p < pat.length && pat[p] === '*') p++
  return p === pat.length
}

// Whole path. `**` spans zero or more whole segments; recursion depth is bounded by the
// number of `**` in the glob, which is author-written and tiny.
export function matchGlob(patSegs, segs, i = 0, j = 0) {
  while (i < patSegs.length) {
    if (patSegs[i] === '**') {
      for (let k = segs.length; k >= j; k--) if (matchGlob(patSegs, segs, i + 1, k)) return true
      return false
    }
    if (j >= segs.length || !matchSegment(patSegs[i], segs[j])) return false
    i++
    j++
  }
  return j === segs.length
}

const wsGlobSegs = wsGlobs.map((g) => String(g).split('/'))
const isRegisteredWorkspace = (dir) => wsGlobSegs.some((pat) => matchGlob(pat, dir.split('/')))

// --- minimal range satisfaction (see the header for why `semver` is unavailable) ---
// Returns true / false, or null for "this comparator does not understand the spec".
export function parseVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(v).trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]

export function satisfies(spec, version) {
  const v = parseVersion(version)
  if (!v) return null // unparseable local version (prerelease/odd) — do not guess
  const s = spec.trim()
  if (s === '*' || s === 'x' || s === '') return true
  let m
  if ((m = /^(\d+)\.(\d+)\.(\d+)$/.exec(s))) return cmp(v, [+m[1], +m[2], +m[3]]) === 0
  if ((m = /^~(\d+)\.(\d+)\.(\d+)$/.exec(s))) {
    const b = [+m[1], +m[2], +m[3]]
    return cmp(v, b) >= 0 && v[0] === b[0] && v[1] === b[1]
  }
  if ((m = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(s))) {
    const b = [+m[1], +m[2], +m[3]]
    if (cmp(v, b) < 0) return false
    // npm's caret pins to the left-most NON-ZERO component: ^1.2.3 allows <2.0.0,
    // ^0.2.3 allows <0.3.0, ^0.0.3 allows only 0.0.3. Treating 0.x like 1.x is
    // exactly the mistake that made these three ranges look fine to a human.
    if (b[0] > 0) return v[0] === b[0]
    if (b[1] > 0) return v[0] === 0 && v[1] === b[1]
    return v[0] === 0 && v[1] === 0 && v[2] === b[2]
  }
  return null
}

function main() {
  const violations = []
  const rangeViolations = []
  let unchecked = 0
  for (const f of pkgFiles) {
    const p = readJson(resolve(root, f))
    if (!p) continue
    for (const field of DEP_FIELDS) {
      for (const [name, spec] of Object.entries(p[field] ?? {})) {
        const local = localPkgs.get(name)
        if (!local) continue // not an in-repo package; npm fetches it from the registry as intended
        const specStr = String(spec)
        if (LOCAL_PROTOCOLS.some((proto) => specStr.startsWith(proto))) continue // explicit local resolution
        if (!isRegisteredWorkspace(local.dir)) {
          violations.push(
            `${f}\n    "${name}": "${specStr}"  ->  in-repo package at ./${local.dir} is NOT a registered workspace; this spec falls back to the registry (404).`
          )
          continue
        }
        // A registered workspace only satisfies a registry range when its version
        // matches. Otherwise npm may fetch another version instead of linking it.
        if (!local.version) continue
        const ok = satisfies(specStr, local.version)
        if (ok === null) {
          unchecked++
          continue
        }
        if (!ok) {
          rangeViolations.push(
            `${f}\n    ${field}["${name}"] = "${specStr}"  ->  the in-repo ./${local.dir} is version ${local.version}, which this range does NOT admit.`
          )
        }
      }
    }
  }

  if (violations.length || rangeViolations.length) {
    if (violations.length) {
      console.error('\n✗ Workspace dependency check FAILED — in-repo packages referenced by registry specs:\n')
      for (const v of violations) console.error('  ' + v + '\n')
      console.error('Fix: add the package directory to the root package.json "workspaces", or use the')
      console.error('"workspace:*" / "file:" protocol, so it resolves from source instead of the registry.')
      console.error('(See the fuzefront-ui-package skill, non-negotiable #7.)\n')
    }
    if (rangeViolations.length) {
      console.error('\n✗ Workspace dependency check FAILED — ranges the local version does not satisfy:\n')
      for (const v of rangeViolations) console.error('  ' + v + '\n')
      console.error('Unsatisfied ranges can trigger registry fetches in-repo and also break published')
      console.error('consumers. Every local workspace reference must admit its actual version.')
      console.error('Fix: widen the range to admit the version this repo actually ships. Note that under')
      console.error('0.x a caret does NOT span minors — ^0.7.0 excludes 0.8.0.\n')
    }
    process.exit(1)
  }

  console.log(
    `✓ Workspace dependency check passed (${localPkgs.size} in-repo packages, ${pkgFiles.length} manifests scanned` +
      (unchecked ? `, ${unchecked} range(s) UNCHECKED — comparator does not parse them` : '') +
      ').'
  )
}

// Only scan when invoked as a CLI; importing this module (the unit tests do) must not
// scan the repo or call process.exit.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
