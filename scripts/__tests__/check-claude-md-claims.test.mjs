// Unit tests for gate-claims' job-scoping logic, against the REAL implementation.
//
// Why these exist: gate-claims took seven accepted review findings on the PR that
// introduced it, and five were checks that passed on something adjacent to the claim
// rather than the claim — vacuity in the gate written to catch vacuity. Each was
// mutation-tested by hand at the time, which proved the fix but preserved nothing. These
// tests pin the two bugs that were structural rather than one-off, so a regression fails
// CI instead of waiting for a reviewer to notice again.
//
// They import `scripts/lib/workflow-jobs.mjs` rather than restating the logic: a test
// carrying its own copy proves the copy works, which is the same defect in a new costume.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { jobBlock, jobBlockAround, stripYamlComments } from '../lib/workflow-jobs.mjs'

const WF = [
  'name: example',
  '',
  'jobs:',
  '  first:',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - run: node scripts/real-gate.mjs',
  '  optional-notice:',
  '    runs-on: ubuntu-latest',
  '    continue-on-error: true',
  '    steps:',
  '      - run: echo advisory',
  '',
].join('\n')

test('jobBlock starts at the named job and stops before the next', () => {
  const job = jobBlock(WF, 'first')
  assert.match(job, /node scripts\/real-gate\.mjs/)
  assert.doesNotMatch(job, /optional-notice/)
  assert.doesNotMatch(job, /echo advisory/)
})

test('jobBlock throws on a boundary miss rather than widening the window', () => {
  // The original bug was indexOf() of the NEXT job's literal name returning -1, so
  // slice(0, -1) handed the caller almost the whole file. Silence is the failure mode
  // being guarded against here.
  assert.throws(() => jobBlock(WF, 'no-such-job'), /job `no-such-job` not found/)
})

test('an unrelated optional job does not leak continue-on-error into another job', () => {
  // The reported false positive: scanning the raw file text sees `continue-on-error: true`
  // from `optional-notice` and fails a claim about `first`.
  assert.match(WF, /continue-on-error:\s*true/) // present in the file …
  assert.doesNotMatch(jobBlock(WF, 'first'), /continue-on-error:\s*true/) // … but not in this job
})

test('continue-on-error ON the relevant job is still caught after scoping', () => {
  // The scoping must not be so narrow that it stops detecting real suppression.
  assert.match(jobBlock(WF, 'optional-notice'), /continue-on-error:\s*true/)
})

test('jobBlockAround resolves the job owning a located line', () => {
  const lines = WF.split('\n')
  const at = lines.findIndex(l => l.includes('node scripts/real-gate.mjs'))
  const job = jobBlockAround(lines, at)
  assert.match(job, /^ {2}first:/)
  assert.doesNotMatch(job, /continue-on-error/)
})

test('jobBlockAround on a line inside the last job runs to end of file', () => {
  const lines = WF.split('\n')
  const at = lines.findIndex(l => l.includes('echo advisory'))
  assert.match(jobBlockAround(lines, at), /^ {2}optional-notice:/)
})

test('stripYamlComments: a comment mentioning continue-on-error is not configuration', () => {
  // The bug this guards: gate-claims failed on its own workflow because a comment
  // explaining the continue-on-error false positive matched the continue-on-error regex.
  const job = [
    '  claims:',
    '    runs-on: ubuntu-latest',
    '    # explains why an unrelated `continue-on-error: true` used to fail this claim',
    '    steps:',
    '      - run: node scripts/check-claude-md-claims.mjs',
  ].join('\n')
  assert.match(job, /continue-on-error:\s*true/)                      // present as prose …
  assert.doesNotMatch(stripYamlComments(job), /continue-on-error:\s*true/) // … not as config
})

test('stripYamlComments: real configuration survives, and a commented-out suppression does not count', () => {
  assert.match(stripYamlComments('    continue-on-error: true'), /continue-on-error:\s*true/)
  assert.doesNotMatch(stripYamlComments('      - run: node x.mjs # || true'), /\|\|\s*true/)
  assert.match(stripYamlComments('      - run: node x.mjs || true'), /\|\|\s*true/)
})

test('stripYamlComments: a # with no leading space is left alone', () => {
  // URL fragments and quoted values must not be truncated.
  assert.match(stripYamlComments('      - run: echo "a#b" || true'), /a#b/)
})
