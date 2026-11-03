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
import { jobBlock, jobBlockAround, stepBlockAround, stripYamlComments } from '../lib/workflow-jobs.mjs'

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

// --- step-level vs job-level suppression -----------------------------------------
// `continue-on-error` is valid at both levels, and treating them as one made an
// unrelated step's flag report the gate invocation as suppressed, while a commented-out
// invocation still counted as wired. Both were reproduced by review on #1685.
// A suppressed sibling sits on BOTH sides of the invoking step, deliberately. With the
// invocation last, a stepBlockAround() whose boundary never terminates runs to end of
// file and picks up nothing extra — so the test passes even with the boundary broken,
// and pins nothing. That is how the first version of this fixture was written, and the
// mutation run is what exposed it.
const JOB = [
  '  frames-schema:',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - name: Unit-test the gate itself',
  '        continue-on-error: true',
  '        run: node --test scripts/__tests__/x.test.mjs',
  '      - name: Validate',
  '        run: |',
  '          node scripts/real-gate.mjs --base main',
  '      - name: Upload an advisory artifact',
  '        continue-on-error: true',
  '        run: echo advisory',
  '',
].join('\n')

test('stepBlockAround isolates the invoking step from a suppressed sibling', () => {
  const lines = JOB.split('\n')
  const at = lines.findIndex(l => l.includes('node scripts/real-gate.mjs'))
  const step = stepBlockAround(lines, at)
  assert.match(step, /node scripts\/real-gate\.mjs/)
  // The sibling's continue-on-error must NOT appear in this step …
  assert.doesNotMatch(step, /continue-on-error/)
  // … though it is plainly present in the job as a whole.
  assert.match(jobBlockAround(lines, at), /continue-on-error:\s*true/)
})

test('stepBlockAround keeps a suppression that really is on the invoking step', () => {
  const lines = JOB.replace('      - name: Validate\n', '      - name: Validate\n        continue-on-error: true\n').split('\n')
  const at = lines.findIndex(l => l.includes('node scripts/real-gate.mjs'))
  assert.match(stepBlockAround(lines, at), /continue-on-error:\s*true/)
})

test('job-level suppression is distinguishable by indentation', () => {
  const jobLevel = JOB.replace('    runs-on: ubuntu-latest', '    runs-on: ubuntu-latest\n    continue-on-error: true')
  assert.match(jobLevel, /^ {4}continue-on-error:\s*true/m)        // job key, 4 spaces
  assert.doesNotMatch(JOB, /^ {4}continue-on-error:\s*true/m)      // only the step has it
})

test('a commented-out invocation is not an invocation', () => {
  // The reported regression: locating the command on raw text accepted a `#`-disabled
  // line, so one character disconnected a gate while the claim still reported it wired.
  const disabled = JOB.replace('          node scripts/real-gate.mjs --base main',
                               '#          node scripts/real-gate.mjs --base main')
  const live = stripYamlComments(disabled)
    .split('\n')
    .findIndex(l => l.includes('node scripts/real-gate.mjs') && !l.includes('--test'))
  assert.equal(live, -1)
  // And the same search on the raw text is exactly what used to pass.
  assert.notEqual(disabled.split('\n').findIndex(l => l.includes('node scripts/real-gate.mjs')), -1)
})
