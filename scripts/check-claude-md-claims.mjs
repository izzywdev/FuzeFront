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
// `gate-toolchain` existed as a script for a long while CLAUDE.md said nothing
// enforced the toolchain floor. A script nobody runs is the repo's recurring failure
// mode, so assert the wiring too.
claim(
  'gate-toolchain is wired into harden-gate + required-checks',
  () =>
    (read('.github/workflows/harden-gate.yml') || '').includes('gate-toolchain') &&
    (read('governance/required-checks.json') || '').includes('gate-toolchain'),
  'CLAUDE.md claims the Node/React floor is enforced by gate-toolchain; it is not wired',
)

// --- 3. the FuzeBI/FuzeX carve-out is encoded, as CLAUDE.md now states -----
claim(
  'validateSlugConvention encodes the FuzeBI/FuzeX carve-out',
  () => {
    const v = read('packages/onboarding-kit/bin/validate-registration.mjs') || ''
    return v.includes('FuzeBI') && v.includes('FuzeX')
  },
  'CLAUDE.md says the carve-out is encoded in the validator; the names are absent',
)

// --- 4. quoted counts must match the live gate ------------------------------
// The one number CLAUDE.md itself warns about ("it drifts as manifests gain coverage").
// Rather than hard-code it here too, re-derive it and compare.
claim(
  'frames-first covered/blocked counts in CLAUDE.md match the live gate',
  () => {
    const out = execFileSync('node', ['scripts/check-frames-first.mjs', '--report-uncovered'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const m = out.replace(/\x1b\[[0-9;]*m/g, '').match(/covered (\d+), blocked (\d+)/)
    if (!m) throw new Error('could not parse "covered N, blocked N" from the gate output')
    const [, covered, blocked] = m
    const quoted = claude.match(/\*\*(\d+) covered \/ (\d+) blocked\*\*/)
    if (!quoted) throw new Error('CLAUDE.md no longer quotes "**N covered / N blocked**"')
    return quoted[1] === covered && quoted[2] === blocked
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
