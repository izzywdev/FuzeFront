#!/usr/bin/env node
/**
 * gate-frames-first — no feature UI ships before its design is approved.
 *
 * THE GAP THIS EXISTS TO CLOSE
 * ----------------------------
 * CLAUDE.md ("Design-first gate") has stated for months:
 *
 *   "gate-frames-first fails any PR touching feature UI (frontend/src/**,
 *    packages/*-ui/**) without an approved design/frames/<feature>/manifest.json
 *    covering it. Governance nobody can skip beats a step someone is supposed to
 *    remember."
 *
 * No workflow implemented it. So the one rule the design-first pipeline described
 * as un-skippable was, in fact, the only part of it that could be skipped: sibling
 * gates (gate-frames-stamped, gate-ds-conformance) police frames that EXIST, and
 * nothing at all policed UI shipped with no frames. The failure the section was
 * written about — six Security backends built with no UI and nothing to catch it —
 * is the inverse of a gap that was still open.
 *
 * THE HARD PART: mapping a changed UI path to a feature
 * -----------------------------------------------------
 * `frontend/src/**` and `packages/*-ui/**` carry no feature slug, and slugs do not
 * line up with directories (design/frames/devices-sessions and
 * design/frames/mfa-management both build into packages/account-security-ui). Any
 * filename heuristic would be guessable, trivially bypassable, and would fire at
 * random — and a gate nobody trusts gets disabled, which is worse than an honest
 * absence.
 *
 * So the mapping is DECLARED, not inferred. A manifest states which source paths
 * its frames cover:
 *
 *     "implementation": { "paths": ["packages/account-security-ui/**"] }
 *
 * and, per flow, where flows own different code:
 *
 *     "build": { "flows": [{ "id": "totp-enroll",
 *         "implementation": { "paths": ["packages/account-security-ui/src/totp/**"] } }] }
 *
 * That declaration is part of the design contract the owner approves, it is inside
 * the stamped manifest, and a reviewer can check it by reading the frames PR.
 *
 * APPROVAL IS PER FLOW
 * --------------------
 * CLAUDE.md is explicit that one ready flow never waits on an unready sibling, so
 * this gate resolves per flow, never per feature: a changed file passes if AT LEAST
 * ONE flow claiming it is approved. Requiring the whole feature to be approved would
 * break per-flow approval, which is the thing that lets a feature ship incrementally.
 *
 * THE THREE VERDICTS
 * ------------------
 *   ok        - covered by >= 1 approved flow.
 *   BLOCKED   - covered, but every flow claiming it is unapproved. ALWAYS fails.
 *               Not rampable: if a feature declared its frames cover this path,
 *               shipping it unapproved is precisely the defect.
 *   uncovered - matches no manifest's declared paths. Governed by
 *               `uncovered.mode` in governance/frames-first-policy.json ("warn"
 *               today — see that file for the ramp and its removal criterion).
 *
 * Usage:
 *   node scripts/check-frames-first.mjs --base origin/master   # diff against a ref
 *   node scripts/check-frames-first.mjs --files a.tsx b.tsx    # explicit file list
 *   node scripts/check-frames-first.mjs --report-uncovered     # audit master, never fails
 *
 * Exit 0 = nothing blocked; 1 = at least one blocked (or uncovered under mode=fail).
 *
 * Node 20+, stdlib only.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// fileURLToPath, not new URL().pathname — the latter yields "/D:/..." on Windows.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const POLICY_PATH = path.join(REPO_ROOT, 'governance', 'frames-first-policy.json')
const FRAMES_DIR = path.join(REPO_ROOT, 'design', 'frames')

const RED = s => `\x1b[31m${s}\x1b[0m`
const GREEN = s => `\x1b[32m${s}\x1b[0m`
const YELLOW = s => `\x1b[33m${s}\x1b[0m`
const DIM = s => `\x1b[2m${s}\x1b[0m`

/* ------------------------------------------------------------------ globbing */

/**
 * Compiled-glob cache. Without it every changed file recompiles every glob —
 * O(files x globs) RegExp constructions on each run.
 */
const GLOB_CACHE = new Map()

/** Longest glob we will compile. See the ReDoS note on globToRegExp. */
const MAX_GLOB_LENGTH = 200

/**
 * Translate a glob to an anchored RegExp. Supports `**`, `*`, `?` and `{a,b}`.
 * `*` never crosses a `/`; `**\/` matches zero or more directories, so
 * `frontend/src/**` matches `frontend/src/pages/X.tsx` and `**\/*.test.ts`
 * matches a test at any depth.
 *
 * ReDoS: this builds a RegExp from a non-literal, which Semgrep flags. The globs
 * are repo-controlled config — governance/frames-first-policy.json and the
 * in-repo manifests, both reviewed in a PR — not request input, so there is no
 * untrusted-input path here. The generated shapes are also the bounded ones: a
 * `**` directory segment emits a group whose every iteration must consume a
 * path separator, so backtracking is anchored rather than free. `***` (which
 * would emit adjacent unbounded wildcards) is rejected, and glob length is
 * capped, so a typo in a manifest cannot hang CI.
 */
export function globToRegExp(glob) {
  const cached = GLOB_CACHE.get(glob)
  if (cached) return cached

  if (typeof glob !== 'string') throw new Error(`glob must be a string, got ${typeof glob}`)
  if (glob.length > MAX_GLOB_LENGTH) {
    throw new Error(`glob exceeds ${MAX_GLOB_LENGTH} chars (likely a mistake): ${glob.slice(0, 60)}…`)
  }
  if (glob.includes('***')) {
    throw new Error(`glob contains "***", which is ambiguous — use "**" or "*": ${glob}`)
  }

  let re = ''
  let braceDepth = 0
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          re += '(?:[^/]*/)*' // **/ => zero or more path segments
          i += 2
        } else {
          re += '.*'
          i += 1
        }
      } else {
        re += '[^/]*'
      }
    } else if (c === '?') {
      re += '[^/]'
    } else if (c === '{') {
      braceDepth++
      re += '(?:'
    } else if (c === '}' && braceDepth > 0) {
      braceDepth--
      re += ')'
    } else if (c === ',' && braceDepth > 0) {
      re += '|'
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  const compiled = new RegExp('^' + re + '$')
  GLOB_CACHE.set(glob, compiled)
  return compiled
}

/** True if `file` matches any glob in `globs`. */
export function matchesAny(file, globs) {
  return (globs || []).some(g => globToRegExp(g).test(file))
}

/* ------------------------------------------------------------- coverage index */

/**
 * Build the coverage index from feature manifests.
 *
 * Returns entries of { feature, flow, paths, approved }. One entry per FLOW, since
 * approval is per flow. A flow inherits the feature-level `implementation.paths`
 * unless it declares its own (a flow that owns a narrower slice of the code).
 *
 * A manifest with no `build.flows` (billing-invoices, federated-apps,
 * locked-app-mode on master) collapses to a single pseudo-flow carrying the
 * manifest's top-level `approved`, so the older feature-level shape still resolves
 * instead of being silently treated as "no coverage".
 */
export function buildCoverage(manifests) {
  const entries = []
  for (const { feature, manifest } of manifests) {
    const featurePaths = manifest?.implementation?.paths ?? []
    const flows = manifest?.build?.flows

    if (Array.isArray(flows) && flows.length) {
      for (const flow of flows) {
        const paths = flow?.implementation?.paths ?? featurePaths
        if (!paths.length) continue // declares no coverage — contributes nothing
        entries.push({
          feature,
          flow: flow.id ?? '(unnamed flow)',
          paths,
          approved: flow.approved === true,
        })
      }
    } else if (featurePaths.length) {
      entries.push({
        feature,
        flow: '(feature-level)',
        paths: featurePaths,
        approved: manifest.approved === true,
      })
    }
  }
  return entries
}

/** Read every design/frames/<feature>/manifest.json. `_`/`.` dirs are scaffolding. */
export function loadManifests(framesDir = FRAMES_DIR) {
  if (!existsSync(framesDir)) return []
  const out = []
  for (const entry of readdirSync(framesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('_') || entry.name.startsWith('.')) continue
    const manifestPath = path.join(framesDir, entry.name, 'manifest.json')
    if (!existsSync(manifestPath)) continue
    try {
      out.push({ feature: entry.name, manifest: JSON.parse(readFileSync(manifestPath, 'utf8')) })
    } catch (err) {
      // Fail loudly: an unparseable manifest must not read as "this feature has
      // no coverage", which would silently downgrade BLOCKED to uncovered.
      throw new Error(`design/frames/${entry.name}/manifest.json is not valid JSON: ${err.message}`)
    }
  }
  return out.sort((a, b) => a.feature.localeCompare(b.feature))
}

/* ---------------------------------------------------------------- evaluation */

/**
 * Classify each changed file. Pure — all I/O is done by the caller, so the gate's
 * logic is testable against fixtures with no git and no repo checkout.
 */
export function evaluate(changedFiles, coverage, policy) {
  const uiPaths = policy.uiPaths ?? []
  const nonFeature = policy.nonFeaturePaths?.paths ?? []
  const exemptions = policy.exemptions?.entries ?? []

  const result = { ok: [], blocked: [], uncovered: [], exempt: [], skipped: [] }

  for (const file of changedFiles) {
    if (!matchesAny(file, uiPaths)) continue // not UI at all
    if (matchesAny(file, nonFeature)) {
      result.skipped.push({ file, reason: 'not feature UI (nonFeaturePaths)' })
      continue
    }

    const exemption = exemptions.find(e => matchesAny(file, e.paths || []))
    if (exemption) {
      result.exempt.push({ file, exemption })
      continue
    }

    const claims = coverage.filter(c => matchesAny(file, c.paths))
    if (!claims.length) {
      result.uncovered.push({ file })
      continue
    }
    // Per-flow approval: ONE approved flow claiming this file is enough. A sibling
    // flow still iterating must not hold back the flow that was approved.
    const approved = claims.filter(c => c.approved)
    if (approved.length) result.ok.push({ file, claims: approved })
    else result.blocked.push({ file, claims })
  }
  return result
}

/* --------------------------------------------------------------------- input */

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name)
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : fallback
}
const hasFlag = name => process.argv.includes(name)

function argList(name) {
  const i = process.argv.indexOf(name)
  if (i === -1) return null
  const out = []
  for (let j = i + 1; j < process.argv.length; j++) {
    if (process.argv[j].startsWith('--')) break
    out.push(process.argv[j])
  }
  return out
}

function changedFilesFromGit(base) {
  // Three-dot: what THIS branch changed relative to the merge base, so files the
  // base branch moved on its own are not attributed to this PR.
  const out = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
  return out.split('\n').map(s => s.trim()).filter(Boolean)
}

/** Every tracked file under the UI paths — used by --report-uncovered. */
function allUiFiles(policy) {
  const out = execFileSync('git', ['ls-files'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  return out.split('\n').map(s => s.trim()).filter(Boolean)
    .filter(f => matchesAny(f, policy.uiPaths ?? []))
}

/* ---------------------------------------------------------------------- main */

function main() {
  const policy = JSON.parse(readFileSync(POLICY_PATH, 'utf8'))

  // --uncovered-mode previews the ramp's destination without editing the policy,
  // so "what would flipping to fail actually block?" is a question anyone can
  // answer before the flip rather than by landing it and watching CI go red.
  const modeOverride = arg('--uncovered-mode')
  if (modeOverride) {
    if (!['warn', 'fail'].includes(modeOverride)) {
      throw new Error(`--uncovered-mode must be "warn" or "fail", got "${modeOverride}"`)
    }
    policy.uncovered = { ...policy.uncovered, mode: modeOverride }
    console.log(DIM(`(preview: uncovered.mode overridden to "${modeOverride}")`))
  }

  const coverage = buildCoverage(loadManifests())

  const declaring = new Set(coverage.map(c => c.feature))
  console.log(DIM(`policy:   ${path.relative(REPO_ROOT, POLICY_PATH)} (uncovered.mode=${policy.uncovered?.mode})`))
  console.log(DIM(`coverage: ${coverage.length} flow(s) across ${declaring.size} feature(s) declare implementation.paths`))

  // --report-uncovered: audit the whole tracked UI surface. Never fails; it exists
  // to regenerate the ratchet worklist in the policy file.
  if (hasFlag('--report-uncovered')) {
    const res = evaluate(allUiFiles(policy), coverage, policy)
    const dirs = new Set(
      res.uncovered.map(u => {
        const parts = u.file.split('/')
        parts.pop() // the containing directory, not the file itself
        return parts.slice(0, 3).join('/')
      })
    )
    console.log(`\nTracked feature-UI files with no declared coverage: ${res.uncovered.length}`)
    for (const d of [...dirs].sort()) console.log(`  ${d}/**`)
    console.log(DIM(`\n(covered ${res.ok.length}, blocked ${res.blocked.length}, structural-skip ${res.skipped.length})`))
    return 0
  }

  const explicit = argList('--files')
  const base = arg('--base', 'origin/master')
  const changed = explicit ?? changedFilesFromGit(base)
  if (!explicit) console.log(DIM(`diff:     ${base}...HEAD (${changed.length} file(s) changed)`))

  const res = evaluate(changed, coverage, policy)
  const considered = res.ok.length + res.blocked.length + res.uncovered.length + res.exempt.length
  if (!considered && !res.skipped.length) {
    console.log(GREEN('\ngate-frames-first: OK — this PR changes no feature UI.'))
    return 0
  }

  for (const { file, claims } of res.ok) {
    const who = claims.map(c => `${c.feature}/${c.flow}`).join(', ')
    console.log(`${GREEN('ok       ')} ${file}  ${DIM(`approved by ${who}`)}`)
  }
  for (const { file, reason } of res.skipped) {
    console.log(`${DIM('skip     ')} ${DIM(`${file}  (${reason})`)}`)
  }
  for (const { file, exemption } of res.exempt) {
    console.log(`${YELLOW('exempt   ')} ${file}  ${DIM(`owner @${exemption.owner} — remove when: ${exemption.removeWhen}`)}`)
  }
  for (const { file } of res.uncovered) {
    const label = policy.uncovered?.mode === 'fail' ? RED('UNCOVERED') : YELLOW('uncovered')
    console.log(`${label} ${file}`)
  }
  for (const { file, claims } of res.blocked) {
    const who = claims.map(c => `${c.feature}/${c.flow}`).join(', ')
    console.log(`${RED('BLOCKED  ')} ${file}  ${DIM(`claimed by ${who} — not approved`)}`)
  }

  let failed = false

  if (res.blocked.length) {
    failed = true
    const flows = [...new Set(res.blocked.flatMap(b => b.claims.map(c => `${c.feature}/${c.flow}`)))]
    console.error(RED(`\ngate-frames-first: ${res.blocked.length} file(s) belong to a flow whose design is NOT approved.`))
    console.error(`\nUnapproved flow(s) claiming this code:`)
    for (const f of flows) console.error(`  - ${f}`)
    console.error(`
What to do next — do NOT edit the manifest's \`approved\` field by hand:
  1. Open design/frames/<feature>/index.html (published to GitHub Pages) and use the
     in-frame "Approve" control on the flow. It files a design-approval issue and
     design-approval.yml flips \`approved\` on master after verifying the stamp.
  2. If the frames still need work, that is the gate doing its job: iterate the frames
     (product-designer owns design/frames/**) and land them as their own PR first.
  3. If this code genuinely does not belong to that flow, fix the claim — narrow
     \`implementation.paths\` in design/frames/<feature>/manifest.json.`)
  }

  if (res.uncovered.length) {
    const mode = policy.uncovered?.mode ?? 'warn'
    const msg = `${res.uncovered.length} feature-UI file(s) are covered by no design frames.`
    if (mode === 'fail') {
      failed = true
      console.error(RED(`\ngate-frames-first: ${msg}`))
      console.error(`
Feature UI must have approved frames before it is written (CLAUDE.md, "Design-first gate"):
  1. product-designer authors design/frames/<feature>/ and lands it as its own PR.
  2. The manifest declares which source paths it covers:
       "implementation": { "paths": ["packages/<pkg>/**"] }
  3. The owner approves the flow; then this code can merge.
If these files are not feature UI (plumbing, config, fixtures), add them to
nonFeaturePaths in governance/frames-first-policy.json instead.`)
    } else {
      console.log(YELLOW(`\ngate-frames-first: ${msg}`))
      console.log(DIM(`Not failing: uncovered.mode="warn" (the ramp — see governance/frames-first-policy.json).
No manifest on master declares implementation.paths yet, so failing here would block every UI PR.
Claim these paths in the owning feature's manifest to bring them under enforcement.`))
    }
  }

  if (res.exempt.length) {
    console.log(YELLOW(`\n${res.exempt.length} file(s) passed on a time-boxed exemption — these are debt, not approval.`))
  }

  if (!failed) console.log(GREEN('\ngate-frames-first: OK'))
  return failed ? 1 : 0
}

// Only run when executed directly, so the test file can import the pure helpers.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exit(main())
  } catch (err) {
    console.error(RED(err.message ?? err))
    process.exit(1)
  }
}
