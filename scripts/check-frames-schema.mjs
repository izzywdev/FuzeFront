#!/usr/bin/env node
/**
 * gate-frames-schema — validate every design-frames manifest against the
 * load-bearing shape in design/frames/_template/manifest.schema.json, AND enforce
 * that a changed feature's flows declare mobile coverage.
 *
 * WHY THIS EXISTS
 * ---------------
 * CLAUDE.md ("Design-first gate") named `gate-frames-schema` as a frames-PR gate
 * for months while NOTHING validated a manifest against the schema — a documented
 * gate that did not exist, which is exactly the "a check is green so it must be
 * working" failure class this repo keeps hitting. gate-frames-first depends on the
 * `implementation.paths` declarations inside these manifests; gate-frames-stamped
 * depends on the stamp; design-approval writes per-flow `approved`. All of that
 * trusts the manifest's shape, and until now nothing checked it.
 *
 * WHY A HAND-WRITTEN VALIDATOR (no ajv)
 * -------------------------------------
 * The repo's frames tooling (stamp-frames.mjs, check-frames-first.mjs) is Node
 * stdlib only, so CI runs it with bare `node` and no `npm ci`. ajv is not a
 * dependency. The schema's own description says it "pins the load-bearing shape
 * that stamping, approval and QA depend on" rather than every field — so this
 * validator asserts that same load-bearing shape directly. If the schema grows a
 * new load-bearing constraint, add the assertion here in the same PR.
 *
 * TWO CHECKS, TWO SCOPES
 * ----------------------
 *   1. SCHEMA  — every design/frames/<feature>/manifest.json must match the shape.
 *                Runs for ALL manifests; a violation always fails. This is pure
 *                structural truth that should already hold, so it does not need a
 *                ramp.
 *   2. MOBILE  — each flow in a CHANGED feature must declare mobile coverage:
 *                a `build.flows[].responsive` pointing at a mobile/responsive frame
 *                (or listing a mobile viewport), OR a frame tagged
 *                `viewport: mobile|responsive` belonging to that flow, OR an
 *                explicit `responsive.exempt` + `exemptReason`. FuzeFront declares
 *                mobile required (.fuze/manifest.json), and a desktop-only frame set
 *                is the "works on desktop, breaks on mobile" defect. Enforced
 *                block-now, but scoped to features this PR changed, so the 28
 *                pre-existing sets are reported — not retro-failed — exactly as
 *                gate-ds-conformance enforces on changed lines only.
 *
 * Usage:
 *   node scripts/check-frames-schema.mjs                 # schema(all) + mobile(changed vs origin/master)
 *   node scripts/check-frames-schema.mjs --base <ref>    # changed-feature diff base
 *   node scripts/check-frames-schema.mjs --all-mobile    # enforce mobile coverage on ALL features (audit the ramp's end state)
 *   node scripts/check-frames-schema.mjs --report        # never fail; print schema + mobile status for every feature
 *
 * Exit 0 = valid (and no changed feature missing mobile coverage); 1 = a failure.
 * Node 20+, stdlib only.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FRAMES_DIR = path.join(REPO_ROOT, 'design', 'frames')

const RED = s => `\x1b[31m${s}\x1b[0m`
const GREEN = s => `\x1b[32m${s}\x1b[0m`
const YELLOW = s => `\x1b[33m${s}\x1b[0m`
const DIM = s => `\x1b[2m${s}\x1b[0m`

const VIEWPORTS = ['mobile', 'tablet', 'desktop', 'responsive']
const MOBILE_VIEWPORTS = ['mobile', 'responsive']
const ENDPOINT_RE = /^(GET|POST|PUT|PATCH|DELETE) \//
const FLAG_RE = /^[a-z0-9-]+\.[a-z0-9-]+\.[a-z0-9-]+$/
const STAMP_RE = /^[0-9a-f]{64}$/

// A JSON object, not an array and not null. `typeof [] === 'object'` is true, so a
// manifest with `"build": []` must be rejected here, not treated as an empty object.
const isObj = v => typeof v === 'object' && v !== null && !Array.isArray(v)

/* ------------------------------------------------------------- tiny assert kit */

// Collect per-manifest errors as `path: message` strings; a non-empty list fails.
function makeChecker(errors) {
  const isStr = (v, min = 0) => typeof v === 'string' && v.length >= min
  const isArr = v => Array.isArray(v)
  const push = (where, msg) => errors.push(`${where}: ${msg}`)

  const reqStr = (obj, key, where, min = 1) => {
    if (!(key in obj)) return push(where, `missing required "${key}"`)
    if (!isStr(obj[key], min)) push(`${where}.${key}`, `must be a string${min ? ` (min length ${min})` : ''}`)
  }
  const optStr = (obj, key, where, min = 0) => {
    if (key in obj && !isStr(obj[key], min)) push(`${where}.${key}`, `must be a string`)
  }
  const reqArrStr = (obj, key, where, { min = 1, itemPattern = null, itemMin = 1 } = {}) => {
    if (!(key in obj)) return push(where, `missing required "${key}"`)
    if (!isArr(obj[key]) || obj[key].length < min) return push(`${where}.${key}`, `must be an array with >= ${min} item(s)`)
    obj[key].forEach((v, i) => {
      if (!isStr(v, itemMin)) push(`${where}.${key}[${i}]`, `must be a non-empty string`)
      else if (itemPattern && !itemPattern.test(v)) push(`${where}.${key}[${i}]`, `"${v}" does not match ${itemPattern}`)
    })
  }
  // Optional arrays default to min 0 — the schema sets `minItems` only on the
  // required arrays (frames, testHooks, build.flows), so an empty components /
  // packages / schemas / paths array is valid and must not be rejected.
  const optArrStr = (obj, key, where, opts = {}) => {
    if (key in obj) reqArrStr(obj, key, where, { min: 0, ...opts })
  }
  return { isStr, isArr, push, reqStr, optStr, reqArrStr, optArrStr }
}

/* ----------------------------------------------------------------- schema pass */

export function validateSchema(feature, m) {
  const errors = []
  const c = makeChecker(errors)
  const root = `${feature}`

  if (typeof m !== 'object' || m === null || Array.isArray(m)) {
    errors.push(`${root}: manifest must be a JSON object`)
    return errors
  }

  c.reqStr(m, 'name', root)
  c.reqStr(m, 'description', root)
  if (!('designSystem' in m)) errors.push(`${root}: missing required "designSystem"`)
  else c.optStr(m, 'designSystem', root)
  if (!('entry' in m)) errors.push(`${root}: missing required "entry"`)
  else if (!c.isStr(m.entry) || !/\.html$/.test(m.entry)) errors.push(`${root}.entry: must be a string ending in .html`)
  if ('stamp' in m && !STAMP_RE.test(String(m.stamp))) errors.push(`${root}.stamp: must be bare lowercase sha256 hex`)
  if ('plan' in m) c.optStr(m, 'plan', root)

  if ('implementation' in m) {
    const impl = m.implementation
    if (!isObj(impl)) errors.push(`${root}.implementation: must be an object`)
    else c.optArrStr(impl, 'paths', `${root}.implementation`)
  }

  // frames (required, >= 1)
  if (!('frames' in m)) errors.push(`${root}: missing required "frames"`)
  else if (!Array.isArray(m.frames) || m.frames.length < 1) errors.push(`${root}.frames: must be an array with >= 1 item`)
  else {
    m.frames.forEach((f, i) => {
      const w = `${root}.frames[${i}]`
      if (!isObj(f)) return errors.push(`${w}: must be an object`)
      c.reqStr(f, 'id', w)
      if (!('file' in f)) errors.push(`${w}: missing required "file"`)
      else if (!c.isStr(f.file) || !/\.html$/.test(f.file)) errors.push(`${w}.file: must be a string ending in .html`)
      c.reqStr(f, 'label', w)
      c.reqStr(f, 'summary', w)
      c.optStr(f, 'route', w)
      c.optStr(f, 'flow', w)
      c.optStr(f, 'acceptanceNotes', w, 1)
      if ('viewport' in f && !VIEWPORTS.includes(f.viewport)) errors.push(`${w}.viewport: must be one of ${VIEWPORTS.join('|')}`)
      c.reqArrStr(f, 'testHooks', w)
    })
  }

  if ('contract' in m) {
    const ct = m.contract
    if (!isObj(ct)) errors.push(`${root}.contract: must be an object`)
    else {
      c.optStr(ct, 'openapi', `${root}.contract`)
      c.optStr(ct, 'client', `${root}.contract`)
      c.optArrStr(ct, 'schemas', `${root}.contract`)
      c.optArrStr(ct, 'endpoints', `${root}.contract`, { itemPattern: ENDPOINT_RE })
      c.optStr(ct, 'component', `${root}.contract`, 1)
      if ('featureFlag' in ct && !FLAG_RE.test(String(ct.featureFlag))) errors.push(`${root}.contract.featureFlag: must match <repo>.<domain>.<flag>`)
    }
  }

  if ('build' in m) {
    const b = m.build
    if (!isObj(b)) errors.push(`${root}.build: must be an object`)
    else {
      if ('flows' in b) {
        if (!Array.isArray(b.flows) || b.flows.length < 1) errors.push(`${root}.build.flows: must be an array with >= 1 item`)
        else b.flows.forEach((fl, i) => validateFlow(fl, `${root}.build.flows[${i}]`, errors, c))
      }
      c.optArrStr(b, 'components', `${root}.build`)
      c.optArrStr(b, 'packages', `${root}.build`, { itemPattern: /^@(fuzefront|fuzeone)\// })
    }
  }

  return errors
}

function validateFlow(fl, w, errors, c) {
  if (!isObj(fl)) return errors.push(`${w}: must be an object`)
  c.reqStr(fl, 'id', w)
  c.reqStr(fl, 'orchestrator', w)
  if (!('route' in fl)) errors.push(`${w}: missing required "route"`)
  else if (!c.isStr(fl.route) || !/^\//.test(fl.route)) errors.push(`${w}.route: must be a string starting with /`)
  if ('implementation' in fl) {
    const impl = fl.implementation
    if (!isObj(impl)) errors.push(`${w}.implementation: must be an object`)
    else c.optArrStr(impl, 'paths', `${w}.implementation`)
  }
  if ('approved' in fl && typeof fl.approved !== 'boolean') errors.push(`${w}.approved: must be a boolean`)
  if ('approvedBy' in fl && !(fl.approvedBy === null || c.isStr(fl.approvedBy))) errors.push(`${w}.approvedBy: must be a string or null`)
  if ('approvedAt' in fl && !(fl.approvedAt === null || c.isStr(fl.approvedAt))) errors.push(`${w}.approvedAt: must be a string or null`)
  if (('approvedBy' in fl || 'approvedAt' in fl) && !('approved' in fl)) errors.push(`${w}: approvedBy/approvedAt require "approved"`)
  if ('responsive' in fl) {
    const r = fl.responsive
    if (!isObj(r)) errors.push(`${w}.responsive: must be an object`)
    else {
      c.optStr(r, 'mobileFrame', `${w}.responsive`)
      if ('coveredViewports' in r) {
        if (!Array.isArray(r.coveredViewports)) errors.push(`${w}.responsive.coveredViewports: must be an array`)
        else r.coveredViewports.forEach((v, i) => { if (!VIEWPORTS.includes(v)) errors.push(`${w}.responsive.coveredViewports[${i}]: must be one of ${VIEWPORTS.join('|')}`) })
      }
      if ('exempt' in r && typeof r.exempt !== 'boolean') errors.push(`${w}.responsive.exempt: must be a boolean`)
      if (r.exempt === true && !c.isStr(r.exemptReason, 1)) errors.push(`${w}.responsive.exemptReason: required (non-empty) when exempt is true`)
    }
  }
}

/* --------------------------------------------------------------- mobile pass */

// A flow has mobile coverage if it is exempt (with reason), or points at a mobile
// frame, or lists a mobile viewport, or a frame belonging to it is mobile/responsive.
export function flowMobileCoverage(flow, frames) {
  const r = flow.responsive || {}
  if (r.exempt === true && typeof r.exemptReason === 'string' && r.exemptReason.length) {
    return { covered: true, reason: `exempt: ${r.exemptReason}` }
  }
  const framesById = new Map(frames.map(f => [f.id, f]))
  if (r.mobileFrame) {
    const mf = framesById.get(r.mobileFrame)
    if (!mf) return { covered: false, reason: `responsive.mobileFrame "${r.mobileFrame}" is not a frame id` }
    // A frame explicitly assigned to another flow does not cover THIS flow — else a
    // desktop-only flow could claim a sibling flow's mobile frame.
    if (mf.flow && mf.flow !== flow.id) {
      return { covered: false, reason: `responsive.mobileFrame "${r.mobileFrame}" belongs to flow "${mf.flow}", not "${flow.id}"` }
    }
    if (MOBILE_VIEWPORTS.includes(mf.viewport)) return { covered: true, reason: `mobileFrame ${r.mobileFrame}` }
    return { covered: false, reason: `responsive.mobileFrame "${r.mobileFrame}" viewport is "${mf.viewport || 'desktop'}", not mobile/responsive` }
  }
  if (Array.isArray(r.coveredViewports) && r.coveredViewports.some(v => MOBILE_VIEWPORTS.includes(v))) {
    return { covered: true, reason: `coveredViewports ${r.coveredViewports.join(',')}` }
  }
  const flowFrames = frames.filter(f => f.flow === flow.id)
  if (flowFrames.some(f => MOBILE_VIEWPORTS.includes(f.viewport))) {
    return { covered: true, reason: `frame(s) tagged mobile/responsive` }
  }
  return { covered: false, reason: 'no mobile frame, responsive.mobileFrame, coveredViewports, or exemption' }
}

// Returns { feature, uncoveredFlows: [{id, reason}] } for features with flows.
export function mobileReport(manifests) {
  const out = []
  for (const { feature, manifest } of manifests) {
    const flows = manifest.build?.flows
    if (!Array.isArray(flows) || flows.length === 0) continue // nothing to cover
    const frames = Array.isArray(manifest.frames) ? manifest.frames : []
    const uncoveredFlows = []
    for (const flow of flows) {
      const { covered, reason } = flowMobileCoverage(flow, frames)
      if (!covered) uncoveredFlows.push({ id: flow.id ?? '(no id)', reason })
    }
    out.push({ feature, uncoveredFlows })
  }
  return out
}

/* ------------------------------------------------------------------ discovery */

export function loadManifests(framesDir = FRAMES_DIR) {
  if (!existsSync(framesDir)) return []
  const out = []
  for (const entry of readdirSync(framesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('_') || entry.name.startsWith('.')) continue
    const manifestPath = path.join(framesDir, entry.name, 'manifest.json')
    if (!existsSync(manifestPath)) continue
    let manifest
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    } catch (err) {
      // Unparseable JSON is itself a schema failure — record it, do not throw,
      // so one bad manifest does not hide the rest.
      out.push({ feature: entry.name, manifest: null, parseError: err.message })
      continue
    }
    out.push({ feature: entry.name, manifest })
  }
  return out.sort((a, b) => a.feature.localeCompare(b.feature))
}

function changedFeaturesFromGit(base) {
  try {
    const out = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], {
      cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    })
    const feats = new Set()
    for (const line of out.split('\n').map(s => s.trim()).filter(Boolean)) {
      const m = /^design\/frames\/([^/_][^/]*)\//.exec(line)
      if (m) feats.add(m[1])
    }
    return feats
  } catch {
    // Shallow clone / unknown base: no changed-feature scope available. Schema
    // still runs for all; mobile coverage simply has nothing scoped to enforce.
    return null
  }
}

// A changed feature directory that still exists but has no manifest.json escapes
// loadManifests entirely, so the required gate would pass with nothing to enforce on
// it. Adding frames without a manifest, or deleting an existing manifest, must FAIL
// rather than silently skip. A directory that no longer exists is a legitimate
// whole-feature removal and is not flagged.
export function missingManifestFeatures(changed, framesDir = FRAMES_DIR) {
  if (!changed) return []
  const out = []
  for (const feature of changed) {
    const dir = path.join(framesDir, feature)
    if (!existsSync(dir)) continue // whole feature removed — legitimate
    if (existsSync(path.join(dir, 'manifest.json'))) continue // has one — validated elsewhere
    out.push(feature)
  }
  return out.sort()
}

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const hasFlag = name => process.argv.includes(name)

/* ----------------------------------------------------------------------- main */

function main() {
  const report = hasFlag('--report')
  const all = hasFlag('--all') || hasFlag('--all-mobile') // --all-mobile kept as an alias
  const base = arg('--base', 'origin/master')
  const manifests = loadManifests()

  // Scope. Both checks enforce on CHANGED features only by default (block-now for
  // new/edited manifests, without retro-failing the pre-existing backlog), exactly
  // as gate-ds-conformance enforces on changed lines. --all enforces everywhere
  // (use before flipping the ramp); --report never fails.
  const changed = (all || report) ? null : changedFeaturesFromGit(base)

  // A changed feature with frames but no manifest.json would otherwise slip the gate
  // entirely (loadManifests skips it). Fail for it under the enforcing scope.
  const missing = missingManifestFeatures(changed)
  let missingFailures = 0
  for (const feature of missing) {
    missingFailures++
    console.log(RED(`✗ ${feature}: feature directory has frames but no manifest.json — it cannot be validated or approved`))
  }

  if (manifests.length === 0 && missingFailures === 0) {
    console.log(YELLOW('No design/frames/<feature>/manifest.json found — nothing to validate.'))
    return 0
  }

  if (!all && !report && changed === null) {
    console.log(YELLOW('Could not compute the changed-feature set (shallow clone / unknown base).'))
    console.log(YELLOW('Nothing is enforced this run; use --all to validate every manifest, or --report to audit.'))
  }
  const enforced = feature => all || (changed !== null && changed.has(feature))

  // 1) SCHEMA — validated for every manifest; a failure COUNTS only for an
  //    enforced (changed) manifest. Backlog errors are printed as warnings.
  let schemaFailures = 0
  const schemaClean = [] // manifests with no schema errors — eligible for the mobile pass
  for (const entry of manifests) {
    const { feature, manifest, parseError } = entry
    const errs = parseError ? [`${feature}: invalid JSON — ${parseError}`] : validateSchema(feature, manifest)
    if (errs.length === 0) { schemaClean.push(entry); continue }
    const on = enforced(feature)
    if (on) schemaFailures += errs.length
    const head = on ? RED : YELLOW
    console.log(head(`${on ? '✗' : '•'} ${feature}: ${errs.length} schema error(s)${on ? '' : ' (backlog — not this PR)'}`))
    for (const e of errs) console.log(head(`    ${e}`))
  }

  // 2) MOBILE — same scope. Only schema-clean manifests are mobile-checked.
  const reports = mobileReport(schemaClean)
  let mobileFailures = 0
  for (const r of reports) {
    if (r.uncoveredFlows.length === 0) {
      if (report || all) console.log(GREEN(`✓ ${r.feature}: all flow(s) have mobile coverage`))
      continue
    }
    const on = enforced(r.feature)
    if (on) mobileFailures += r.uncoveredFlows.length
    const head = on ? RED : YELLOW
    console.log(head(`${on ? '✗' : '•'} ${r.feature}: ${r.uncoveredFlows.length} flow(s) missing mobile coverage${on ? '' : ' (backlog — not this PR)'}`))
    for (const f of r.uncoveredFlows) console.log(head(`    flow "${f.id}" — ${f.reason}`))
  }

  // Verdict.
  console.log('')
  if (report) {
    const schemaBad = manifests.length - schemaClean.length
    const mobileBad = reports.reduce((a, r) => a + r.uncoveredFlows.length, 0)
    console.log(DIM(`report only — ${manifests.length} manifest(s): ${schemaBad} with schema errors, ${mobileBad} flow(s) without mobile coverage.`))
    return 0
  }
  const scopeLabel = all ? 'all features' : `changed feature(s): ${changed && changed.size ? [...changed].join(', ') : '(none)'}`
  if (schemaFailures > 0 || mobileFailures > 0 || missingFailures > 0) {
    if (missingFailures > 0) console.log(RED(`gate-frames-schema FAILED: ${missingFailures} changed feature(s) have frames but no manifest.json.`))
    if (schemaFailures > 0) console.log(RED(`gate-frames-schema FAILED: ${schemaFailures} schema error(s) in ${scopeLabel}.`))
    if (mobileFailures > 0) {
      console.log(RED(`gate-frames-schema FAILED: ${mobileFailures} flow(s) in ${scopeLabel} declare no mobile coverage.`))
      console.log(DIM('Fix: give each flow a mobile/responsive frame (frames[].viewport) or build.flows[].responsive, or set responsive.exempt + exemptReason. See docs/design-system/building-a-screen.md.'))
    }
    return 1
  }
  console.log(GREEN(`✓ gate-frames-schema: ${schemaClean.length}/${manifests.length} manifest(s) schema-clean; no enforced failures (${scopeLabel}).`))
  return 0
}

// Run only as a CLI; exports above are for unit tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main())
}
