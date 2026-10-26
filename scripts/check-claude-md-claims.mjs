#!/usr/bin/env node
// gate-claims — CLAUDE.md is the first thing every agent reads, so a stale line in it
// is a defect multiplied across every session. It has drifted in BOTH directions:
// announcing gaps that were already closed (`gate-frames-schema` "still does not
// exist"; the toolchain floor "survives on review alone"; the FuzeBI/FuzeX carve-out as
// "a known code/policy gap") and quoting counts that had moved on. A reader cannot tell
// a true claim from a stale one, and in at least one case an agent acted on a stale
// line.
//
// So the falsifiable claims get checked by CI rather than by whoever happens to notice.
// This deliberately covers only claims that are MECHANICALLY checkable — a path exists,
// a symbol is present, a number matches a script's live output. Prose, rationale and
// policy are out of scope and always will be: the point is to catch drift, not to
// freeze the document.
//
// Add a claim here whenever CLAUDE.md asserts something a command could confirm.
import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { validateSlugConvention } from '../packages/onboarding-kit/bin/validate-registration.mjs'

const read = p => (existsSync(p) ? readFileSync(p, 'utf8') : null)
const claude = read('CLAUDE.md')
if (claude === null) {
  console.error('gate-claims: CLAUDE.md not found — run from the repo root.')
  process.exit(1)
}

const failures = []
const checks = []

/** A claim: `name`, a `holds()` returning true when reality matches, and `detail`. */
const claim = (name, holds, detail) => {
  let ok = false
  let err = null
  try { ok = holds() } catch (e) { err = e }
  checks.push({ name, ok: ok === true })
  if (ok !== true) failures.push(`${name}\n      ${err ? `threw: ${err.message}` : detail}`)
}

// --- 1. things CLAUDE.md names as existing must exist -----------------------
// A renamed or deleted script silently turns a cited mechanism into fiction.
const citedPaths = [
  'scripts/check-frames-first.mjs',
  'scripts/check-frames-schema.mjs',
  'scripts/gate-toolchain.mjs',
  'scripts/reap-agent-worktrees.sh',
  '.github/workflows/gate-frames-first.yml',
  '.github/workflows/gate-frames-schema.yml',
  'governance/frames-first-policy.json',
  'governance/identifier-standard.md',
  'packages/onboarding-kit/bin/validate-registration.mjs',
  'frontend/src/utils/loadFederatedApp.ts',
  'backend/core/src/events/outbox.ts',
  'backend/applications/src/app-registry/builtins.ts',
]
for (const p of citedPaths) {
  if (!claude.includes(p.split('/').pop())) continue // not currently cited — skip
  claim(`cited path exists: ${p}`, () => existsSync(p), `CLAUDE.md cites it but it is missing`)
}

// --- 2. claims that a gate is WIRED, not merely present --------------------
// `gate-toolchain` existed as a script for a long while CLAUDE.md said nothing enforced
// the toolchain floor. A script nobody runs is the repo's recurring failure mode.
//
// The first version of this check asserted the wiring with two substring searches, and
// the second one passed on `governance/required-checks.json` while `gate-toolchain`
// appeared there ONLY inside `enforce._doc` — prose about the gate, not membership of
// the required set. A check that greps explanatory text for the name of the thing it is
// meant to verify is exactly the vacuity this gate exists to catch, so: parse the JSON
// and read the array (Codex #1685).
const requiredNow = () => {
  const raw = read('governance/required-checks.json')
  if (!raw) throw new Error('governance/required-checks.json not found')
  const arr = JSON.parse(raw)?.repos?.FuzeFront?.required_now
  if (!Array.isArray(arr)) throw new Error('repos.FuzeFront.required_now is not an array')
  return arr
}

// Two separate facts, and conflating them is how the CLAUDE.md line went wrong twice:
// the job FAILS (no `|| true`, exits 1) but it does NOT BLOCK (not a required context,
// so auto-merge never waits on it). Assert both, in the direction CLAUDE.md now states.
/**
 * The YAML block of one job in a workflow: from its `  <name>:` header to the next
 * job header at the same indentation.
 *
 * Written out rather than done with indexOf of the NEXT job's literal name, which was
 * the first version here: `job.slice(0, job.indexOf('\n  gate-frontend-build:'))`
 * yields `slice(0, -1)` — almost the whole file — the moment that job is renamed,
 * removed or reordered above this one. The checks below would then read every other
 * job's steps, and a `continue-on-error: true` anywhere later in the file would fail
 * this claim for a reason that has nothing to do with it (fuze-code-review #1685).
 * A boundary miss now throws instead of silently widening the window.
 */
const jobBlock = (wf, name) => {
  const lines = wf.split('\n')
  const start = lines.findIndex(l => l === `  ${name}:`)
  if (start === -1) throw new Error(`job \`${name}\` not found`)
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^  \S.*:\s*$/.test(lines[i])) { end = i; break }
  }
  return lines.slice(start, end).join('\n')
}

claim(
  'gate-toolchain runs unsuppressed in harden-gate.yml',
  () => {
    const job = jobBlock(read('.github/workflows/harden-gate.yml') || '', 'gate-toolchain')
    return (
      job.includes('node scripts/gate-toolchain.mjs') &&
      !/gate-toolchain\.mjs[^\n]*(\|\| true|\|\|true)/.test(job) &&
      !/continue-on-error:\s*true/.test(job)
    )
  },
  'CLAUDE.md says gate-toolchain runs in harden-gate.yml and fails on a violation; the step is missing or suppressed',
)

claim(
  'gate-toolchain is NOT in the live required set, as CLAUDE.md states',
  () => !requiredNow().includes('gate-toolchain'),
  'gate-toolchain is now a required context — CLAUDE.md says it reports without blocking a merge; update that line',
)

// The required set itself, because CLAUDE.md quotes it in full. Verified equal to the
// live ruleset (`gh api repos/izzywdev/FuzeFront/rules/branches/master`) on 2026-10-26;
// required-checks.json is the in-repo mirror a CI job can read without a token.
// SET EQUALITY, BOTH DIRECTIONS, over the ONE sentence that enumerates the set.
// The first version asked only "does CLAUDE.md contain this context's name anywhere",
// which is two bugs at once: PROMOTING gate-authz passed because the document names it
// in the paragraph saying it is NOT required, and REMOVING gate-test passed because the
// document still listed it. Both reproduced (Codex #1685). So: parse the enumerating
// sentence, and compare sets.
claim(
  'the required-check list quoted in CLAUDE.md matches required_now exactly',
  () => {
    const m = claude.match(/the required set is exactly (\d+) contexts \u2014 (.+?) \u2014/s)
    if (!m) throw new Error('CLAUDE.md no longer has the "required set is exactly N contexts — ..." sentence')
    const [, statedCount, list] = m
    const documented = [...list.matchAll(/`([^`]+)`/g)].map(x => x[1])
    const live = requiredNow()
    if (documented.length !== Number(statedCount)) {
      throw new Error(`CLAUDE.md says "exactly ${statedCount} contexts" but enumerates ${documented.length}`)
    }
    const onlyLive = live.filter(c => !documented.includes(c))
    const onlyDoc = documented.filter(c => !live.includes(c))
    if (onlyLive.length || onlyDoc.length) {
      throw new Error(
        [
          onlyLive.length ? `required but undocumented: ${onlyLive.join(', ')}` : '',
          onlyDoc.length ? `documented but not required: ${onlyDoc.join(', ')}` : '',
        ].filter(Boolean).join('; '),
      )
    }
    return true
  },
  'the live required set and the list in CLAUDE.md disagree',
)

// --- 3. the FuzeBI/FuzeX carve-out is encoded, as CLAUDE.md now states -----
// Grepping the source for 'FuzeBI'/'FuzeX' passed even with the exemption set emptied,
// because the validator's own COMMENT names both products — so the check could not fail
// on the one disagreement it was written to catch (Codex #1685). Call the function.
claim(
  'validateSlugConvention exempts FuzeBI/FuzeX, and flags other Fuze-prefixed names',
  () => {
    const exempt = ['FuzeBI', 'FuzeX']
    for (const name of exempt) {
      for (const field of ['name', 'menuLabel']) {
        const findings = validateSlugConvention({ slug: 'x', name: 'Ok', menuLabel: 'Ok', [field]: name })
        if (findings.length) throw new Error(`${name} rejected in ${field}: ${JSON.stringify(findings)}`)
      }
    }
    // The control: without a working carve-out this would also come back clean, which is
    // what made the old grep vacuous.
    const flagged = validateSlugConvention({ slug: 'fuzesales', name: 'FuzeSales', menuLabel: 'FuzeSales' })
    if (!flagged.length) throw new Error('a Fuze-prefixed display name was not flagged at all')
    return true
  },
  'CLAUDE.md says the FuzeBI/FuzeX carve-out is encoded in validateSlugConvention; the validator disagrees',
)

// --- 4. quoted counts must match the live gate ------------------------------
// The one number CLAUDE.md itself warns about ("it drifts as manifests gain coverage").
// Rather than hard-code it here too, re-derive it and compare.
claim(
  'frames-first covered/blocked counts in CLAUDE.md match the live gate',
  () => {
    // --report-uncovered is documented and implemented as "never fails": that branch
    // returns 0 before any gating logic runs, so covered-but-unapproved flows cannot
    // make it exit non-zero. A throw therefore means the gate itself broke, not that
    // this PR is unapproved — so keep the numbers if they were still printed, and
    // surface stderr rather than failing with a bare "Command failed".
    let out
    try {
      out = execFileSync('node', ['scripts/check-frames-first.mjs', '--report-uncovered'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (e) {
      out = e.stdout || ''
      if (!/covered \d+, blocked \d+/.test(out)) {
        const why = String(e.stderr || '').trim() || e.message
        throw new Error(
          `scripts/check-frames-first.mjs --report-uncovered failed (exit ${e.status}): ${why}`,
        )
      }
    }
    const plain = out.replace(/\x1b\[[0-9;]*m/g, '')
    // Every number CLAUDE.md quotes from this report, not just the first two. It quoted
    // "22 flows" against an actual 65 for as long as nothing compared them, and offered
    // `blocked` as the flip-to-fail worklist when `uncovered` is the number that governs
    // that decision — so check the flow count and the uncovered count too (Codex #1685).
    const live = {
      covered: plain.match(/covered (\d+)/)?.[1],
      blocked: plain.match(/blocked (\d+)/)?.[1],
      flows: plain.match(/coverage: (\d+) flow\(s\) across (\d+) feature\(s\)/)?.[1],
      features: plain.match(/coverage: (\d+) flow\(s\) across (\d+) feature\(s\)/)?.[2],
      uncovered: plain.match(/no declared coverage: (\d+)/)?.[1],
    }
    for (const [k, v] of Object.entries(live)) {
      if (v === undefined) throw new Error(`could not parse ${k} from the gate output`)
    }
    const quoted = {
      covered: claude.match(/\*\*(\d+) covered \/ (\d+) blocked\*\*/)?.[1],
      blocked: claude.match(/\*\*(\d+) covered \/ (\d+) blocked\*\*/)?.[2],
      flows: claude.match(/\*\*(\d+) flows across (\d+) of (\d+)\*\* manifests/)?.[1],
      features: claude.match(/\*\*(\d+) flows across (\d+) of (\d+)\*\* manifests/)?.[2],
      uncovered: claude.match(/while \*\*(\d+)\*\* tracked feature-UI files/)?.[1],
    }
    const wrong = Object.keys(live).filter(k => quoted[k] !== live[k])
    if (wrong.length) {
      throw new Error(
        wrong.map(k => `${k}: CLAUDE.md says ${quoted[k] ?? '(not quoted)'}, gate reports ${live[k]}`).join('; '),
      )
    }
    return true
  },
  'the numbers in CLAUDE.md no longer match scripts/check-frames-first.mjs — re-measure and update the line',
)

// --- 5. no claim that a wired gate does not exist --------------------------
// The exact shape of drift that cost the most: CLAUDE.md announcing a gap that was
// already closed. Cheap to assert, and it fails loudly if the old sentence returns.
//
// QUOTED HISTORY IS NOT A CLAIM. This file deliberately quotes its own past mistakes
// ("it said X for months") because the correction is the useful part — and the first
// version of this check flagged exactly that, on the section documenting the check.
// A sentence is only a live claim when it is asserting in the document's own voice, so
// strip the quoted spans before matching: text in "..." or in a `>` blockquote is
// evidence being cited, not an assertion being made.
const assertingVoice = claude
  .replace(/"[^"]{0,400}"/g, ' ')     // quoted inline; spans line breaks, since prose rewraps
  .replace(/^>.*$/gm, ' ')            // blockquoted historical notes
for (const gate of ['gate-frames-schema', 'gate-toolchain']) {
  claim(
    `CLAUDE.md does not claim ${gate} is missing`,
    () => !new RegExp(`\`${gate}\`[^.]{0,80}(does not exist|is not wired|nothing enforces)`, 'i').test(assertingVoice),
    `${gate} is wired, but CLAUDE.md still describes it as absent`,
  )
}

// --- report ----------------------------------------------------------------
for (const c of checks) console.log(`  ${c.ok ? 'ok  ' : 'FAIL'}  ${c.name}`)
console.log(`\ngate-claims: ${checks.length} claim(s) checked, ${failures.length} stale.`)
if (failures.length) {
  console.error('\ngate-claims: CLAUDE.md disagrees with the repo:\n')
  for (const f of failures) console.error(`  ✗ ${f}\n`)
  console.error('Fix the document (or the code) so they agree. CLAUDE.md is read by every')
  console.error('agent before it does anything, so a stale line here is a defect, not a nit.')
  process.exit(1)
}
