#!/usr/bin/env node
// Regression guard for FuzeFront#286.
//
// The bug: the branch ruleset's REQUIRED status check "In-repo packages resolve from
// source" was produced by a workflow path-filtered to `**/package.json`. A path-filtered
// workflow does not run — the check run is never CREATED — on a PR touching none of its
// paths. GitHub treats a required-but-never-reported context as unsatisfied, so the PR sits
// permanently at "Expected — waiting for status to be reported": no red to click, no run to
// re-trigger. Fixed in #794 by dropping the `paths:` filter (the job is dependency-free and
// costs nothing to run unconditionally). This script keeps it fixed: it fails if any
// workflow named in governance/required-check-triggers.json regains a `paths:` /
// `paths-ignore:` filter on its `pull_request:` trigger.
//
// The same bug has a second home: a MERGE QUEUE. A queue builds each candidate on a
// `refs/heads/gh-readonly-queue/...` branch and emits `merge_group`, never `pull_request`.
// A required context whose workflow has no `merge_group:` trigger is therefore never
// created for a queue entry, and the entry sits unsatisfied exactly as #286's PRs did —
// only now it strands the queue rather than one PR. So for every entry the manifest marks
// `requiredInRuleset`, this script also asserts a `merge_group:` trigger is present.
//
// Deliberately dependency-free (no js-yaml) so it runs with a bare `node`, same as
// scripts/check-workspace-deps.mjs. It needs to understand only two shapes, both inside
// the top-level `on:` mapping: a `pull_request:` block containing `paths:`/`paths-ignore:`,
// and the presence of a `merge_group:` key. A line-based indentation scan is enough — a
// real YAML parser is not needed to detect the keys that matter.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const manifestPath = resolve(root, 'governance/required-check-triggers.json')

let manifest
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
} catch (err) {
  console.error(`✗ Could not read/parse ${manifestPath}: ${err.message}`)
  process.exit(1)
}

const entries = Array.isArray(manifest.workflows) ? manifest.workflows : []
if (entries.length === 0) {
  console.error(`✗ ${manifestPath} declares no workflows — this gate would be vacuous. Fix the manifest.`)
  process.exit(1)
}

// Find a `pull_request:` mapping nested under a top-level `on:` key, and report whether
// IT (not some unrelated indentation level) directly contains `paths:`/`paths-ignore:`.
// Handles both block form (`on:\n  pull_request:\n    paths:`) and the flow-style
// `on: pull_request` shorthand some workflows use for other triggers (which by definition
// carries no paths filter).
function findPathsFilterOnPullRequest(source) {
  const lines = source.split(/\r?\n/)
  const indentOf = (line) => line.match(/^[ \t]*/)[0].length

  let onIndent = -1
  let prIndent = -1
  let inPullRequest = false

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const line = raw.split('#')[0] // strip trailing comments before matching keys
    if (!line.trim()) continue
    const indent = indentOf(raw)

    if (onIndent === -1) {
      if (/^on:\s*$/.test(line.trim()) || /^on:\s*\{/.test(line.trim())) {
        onIndent = indent
      }
      continue
    }

    // Left the `on:` block entirely (back to <= its own indent, and not `on:` itself).
    if (indent <= onIndent && !/^on:/.test(line.trim())) {
      if (!inPullRequest) continue
      break
    }

    if (!inPullRequest) {
      if (indent > onIndent && /^pull_request:\s*$/.test(line.trim())) {
        inPullRequest = true
        prIndent = indent
      }
      continue
    }

    // Inside pull_request:. A line at or below prIndent's indent (that isn't pull_request's
    // own children) ends the block.
    if (indent <= prIndent) break
    if (/^(paths|paths-ignore):/.test(line.trim())) return true
  }
  return false
}

// Is there a `merge_group:` key directly inside the top-level `on:` mapping? Accepts the
// bare `merge_group:` form (which defaults to the `checks_requested` activity type) and a
// `merge_group:` block with `types:`. Deliberately scoped to `on:`'s direct children so a
// `merge_group` mentioned in a comment, a job `if:`, or a nested value cannot satisfy it.
function hasMergeGroupTrigger(source) {
  const lines = source.split(/\r?\n/)
  const indentOf = (line) => line.match(/^[ \t]*/)[0].length

  let onIndent = -1
  let childIndent = -1

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const line = raw.split('#')[0]
    if (!line.trim()) continue
    const indent = indentOf(raw)

    if (onIndent === -1) {
      if (/^on:\s*$/.test(line.trim()) || /^on:\s*\{/.test(line.trim())) onIndent = indent
      continue
    }

    // Left the `on:` block entirely.
    if (indent <= onIndent && !/^on:/.test(line.trim())) break

    // Only direct children of `on:` count. The first child establishes that depth.
    if (childIndent === -1) childIndent = indent
    if (indent !== childIndent) continue

    if (/^merge_group:/.test(line.trim())) return true
  }
  return false
}

let failures = 0
for (const entry of entries) {
  const { context, file } = entry
  if (!context || !file) {
    console.error(`✗ Malformed entry in ${manifestPath}: ${JSON.stringify(entry)}`)
    failures++
    continue
  }
  const wfPath = resolve(root, file)
  let source
  try {
    source = readFileSync(wfPath, 'utf8')
  } catch {
    console.error(`✗ [${context}] declared workflow does not exist: ${file}`)
    failures++
    continue
  }
  if (findPathsFilterOnPullRequest(source)) {
    console.error(
      `✗ [${context}] ${file} has a paths:/paths-ignore: filter on pull_request:.\n` +
        `  This context is REQUIRED on the branch ruleset — a path-filtered required check\n` +
        `  never reports on a PR that misses its paths, and the PR is permanently BLOCKED\n` +
        `  (FuzeFront#286). Drop the filter, or if the job must stay path-scoped, add a\n` +
        `  companion job with the SAME check name that runs on the complementary condition\n` +
        `  and succeeds trivially — never remove the context from the required set.`
    )
    failures++
  } else {
    console.log(`✓ [${context}] ${file} runs unconditionally on pull_request`)
  }

  // Only contexts the ruleset actually requires need to report for a merge-queue entry.
  // Demanding it of the others would run them on every queue build for no gating benefit.
  if (entry.requiredInRuleset === true) {
    if (!hasMergeGroupTrigger(source)) {
      console.error(
        `✗ [${context}] ${file} has no merge_group: trigger.\n` +
          `  This context is REQUIRED on the branch ruleset. A merge queue builds each\n` +
          `  candidate on a refs/heads/gh-readonly-queue/... branch and emits merge_group,\n` +
          `  not pull_request — so this context would never be created for a queue entry,\n` +
          `  and a required-but-never-reported context counts as unsatisfied. The entry\n` +
          `  would sit in the queue forever with nothing to re-run (FuzeFront#286, moved\n` +
          `  into the queue). Add \`merge_group:\` to the workflow's on: block.`
      )
      failures++
    } else {
      console.log(`✓ [${context}] ${file} also triggers on merge_group`)
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} required-check workflow(s) failed the trigger check.`)
  process.exit(1)
}
const requiredCount = entries.filter((e) => e.requiredInRuleset === true).length
console.log(
  `\n✓ All ${entries.length} listed workflow(s) run unconditionally on pull_request, ` +
    `and all ${requiredCount} ruleset-required one(s) also trigger on merge_group.`
)
