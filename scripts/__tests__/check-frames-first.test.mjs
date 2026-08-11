/**
 * Tests for the frames-first gate.
 *
 * The most important case here is `catches the defect the gate exists for`: feature
 * UI is changed, the frames for it EXIST and claim that exact path, and the flow is
 * not approved — the gate must block. A gate that has never been shown to fail on
 * the thing it was written for is not evidence of anything.
 *
 * The second most important is `per-flow approval does not gate on siblings`:
 * CLAUDE.md promises one ready flow never waits on an unready one, and a gate that
 * quietly required whole-feature approval would break that promise while looking
 * green in every other test.
 *
 * Run with:  node --test scripts/__tests__/check-frames-first.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { globToRegExp, matchesAny, buildCoverage, evaluate } from '../check-frames-first.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const REAL_POLICY = JSON.parse(
  readFileSync(path.join(REPO_ROOT, 'governance', 'frames-first-policy.json'), 'utf8')
)

/** Policy with the ramp turned OFF, to test the destination behaviour. */
const strictPolicy = { ...REAL_POLICY, uncovered: { ...REAL_POLICY.uncovered, mode: 'fail' } }

/* -------------------------------------------------------------------- globs */

test('globToRegExp: * does not cross a path separator', () => {
  assert.ok(globToRegExp('packages/*-ui/**').test('packages/chat-ui/src/a.tsx'))
  // `*` must not swallow `chat-ui/src`, or `packages/*-ui/**` would match anything.
  assert.ok(!globToRegExp('packages/*-ui/x.tsx').test('packages/chat-ui/src/x.tsx'))
})

test('globToRegExp: **/ matches zero or more directories', () => {
  assert.ok(globToRegExp('**/*.test.ts').test('a.test.ts'))
  assert.ok(globToRegExp('**/*.test.ts').test('packages/chat-ui/tests/chatReducer.test.ts'))
  assert.ok(!globToRegExp('**/*.test.ts').test('packages/chat-ui/src/useChat.ts'))
})

test('globToRegExp: rejects pathological globs rather than compiling them', () => {
  // A typo in a manifest must not be able to hang CI on a backtracking regex.
  assert.throws(() => globToRegExp('a***b'), /ambiguous/)
  assert.throws(() => globToRegExp('x'.repeat(201)), /exceeds/)
})

test('globToRegExp: compiled globs are cached (same RegExp instance)', () => {
  assert.equal(globToRegExp('frontend/src/**'), globToRegExp('frontend/src/**'))
})

test('globToRegExp: the CLAUDE.md UI globs match real repo paths', () => {
  assert.ok(matchesAny('frontend/src/pages/ApplicationsPage.tsx', REAL_POLICY.uiPaths))
  assert.ok(matchesAny('packages/chat-ui/src/lib/markdown.tsx', REAL_POLICY.uiPaths))
  assert.ok(!matchesAny('backend/src/routes/apps.ts', REAL_POLICY.uiPaths))
  assert.ok(!matchesAny('packages/identity/src/index.ts', REAL_POLICY.uiPaths)) // not a *-ui package
})

/* ----------------------------------------------------------------- coverage */

test('buildCoverage: a flow inherits feature paths but can narrow them', () => {
  const cov = buildCoverage([
    {
      feature: 'mfa-management',
      manifest: {
        implementation: { paths: ['packages/account-security-ui/**'] },
        build: {
          flows: [
            { id: 'mfa-overview', approved: true },
            {
              id: 'totp-enroll',
              approved: false,
              implementation: { paths: ['packages/account-security-ui/src/totp/**'] },
            },
          ],
        },
      },
    },
  ])
  assert.deepEqual(cov.find(c => c.flow === 'mfa-overview').paths, ['packages/account-security-ui/**'])
  assert.deepEqual(cov.find(c => c.flow === 'totp-enroll').paths, ['packages/account-security-ui/src/totp/**'])
})

test('buildCoverage: a manifest with no build.flows collapses to a feature-level entry', () => {
  // billing-invoices / federated-apps / locked-app-mode have this older shape on
  // master. They must not silently read as "no coverage".
  const cov = buildCoverage([
    {
      feature: 'billing-invoices',
      manifest: { approved: true, implementation: { paths: ['packages/billing-ui/**'] } },
    },
  ])
  assert.equal(cov.length, 1)
  assert.equal(cov[0].approved, true)
  assert.equal(cov[0].flow, '(feature-level)')
})

test('buildCoverage: a manifest declaring no implementation.paths contributes nothing', () => {
  // This is every manifest on master today — hence the ramp.
  assert.deepEqual(
    buildCoverage([{ feature: 'app-management', manifest: { build: { flows: [{ id: 'app-list', approved: false }] } } }]),
    []
  )
})

/* --------------------------------------------------------------- the defect */

test('catches the defect the gate exists for: covered path, flow NOT approved', () => {
  const cov = buildCoverage([
    {
      feature: 'account-security',
      manifest: {
        implementation: { paths: ['packages/account-security-ui/**'] },
        build: { flows: [{ id: 'sessions-list', approved: false }] },
      },
    },
  ])
  const res = evaluate(['packages/account-security-ui/src/SessionsPanel.tsx'], cov, REAL_POLICY)

  assert.equal(res.blocked.length, 1, 'must block UI whose flow is unapproved')
  assert.equal(res.ok.length, 0)
  assert.equal(res.blocked[0].claims[0].flow, 'sessions-list')
  // And it must block under the RAMP policy too — this verdict is not rampable.
  assert.equal(evaluate(['packages/account-security-ui/src/SessionsPanel.tsx'], cov, strictPolicy).blocked.length, 1)
})

test('approved flow lets its own code through', () => {
  const cov = buildCoverage([
    {
      feature: 'account-security',
      manifest: {
        implementation: { paths: ['packages/account-security-ui/**'] },
        build: { flows: [{ id: 'sessions-list', approved: true }] },
      },
    },
  ])
  const res = evaluate(['packages/account-security-ui/src/SessionsPanel.tsx'], cov, REAL_POLICY)
  assert.equal(res.ok.length, 1)
  assert.equal(res.blocked.length, 0)
})

/* ----------------------------------------------------------- per-flow rules */

test('per-flow approval does not gate on siblings', () => {
  // CLAUDE.md: "one ready flow never waits on an unready sibling."
  const cov = buildCoverage([
    {
      feature: 'mfa-management',
      manifest: {
        build: {
          flows: [
            { id: 'mfa-overview', approved: true, implementation: { paths: ['packages/account-security-ui/src/overview/**'] } },
            { id: 'totp-enroll', approved: false, implementation: { paths: ['packages/account-security-ui/src/totp/**'] } },
          ],
        },
      },
    },
  ])
  const res = evaluate(
    ['packages/account-security-ui/src/overview/Panel.tsx', 'packages/account-security-ui/src/totp/Enroll.tsx'],
    cov,
    REAL_POLICY
  )
  assert.deepEqual(res.ok.map(o => o.file), ['packages/account-security-ui/src/overview/Panel.tsx'])
  assert.deepEqual(res.blocked.map(b => b.file), ['packages/account-security-ui/src/totp/Enroll.tsx'])
})

test('a file claimed by two flows passes if EITHER is approved', () => {
  // Shared code legitimately belongs to the approved flow's build inventory.
  const cov = buildCoverage([
    {
      feature: 'account-security',
      manifest: {
        implementation: { paths: ['packages/account-security-ui/**'] },
        build: { flows: [{ id: 'a', approved: false }, { id: 'b', approved: true }] },
      },
    },
  ])
  const res = evaluate(['packages/account-security-ui/src/shared/Field.tsx'], cov, REAL_POLICY)
  assert.equal(res.ok.length, 1)
  assert.equal(res.blocked.length, 0)
})

test('approved must be exactly true — a truthy string is not an approval', () => {
  const cov = buildCoverage([
    {
      feature: 'x',
      manifest: {
        implementation: { paths: ['packages/billing-ui/**'] },
        build: { flows: [{ id: 'f', approved: 'yes' }] },
      },
    },
  ])
  assert.equal(evaluate(['packages/billing-ui/src/a.tsx'], cov, REAL_POLICY).blocked.length, 1)
})

/* ------------------------------------------------------------- ramp + scope */

test('the ramp: uncovered UI warns under mode=warn and fails under mode=fail', () => {
  const files = ['frontend/src/pages/ApplicationsPage.tsx']
  const warn = evaluate(files, [], REAL_POLICY)
  assert.equal(warn.uncovered.length, 1)
  assert.equal(warn.blocked.length, 0, 'the ramp must not manufacture BLOCKED verdicts')

  const strict = evaluate(files, [], strictPolicy)
  assert.equal(strict.uncovered.length, 1)
})

test('non-UI files are ignored entirely', () => {
  const res = evaluate(['backend/src/routes/apps.ts', 'docs/planning/x.md'], [], REAL_POLICY)
  assert.equal(res.ok.length + res.blocked.length + res.uncovered.length + res.skipped.length, 0)
})

test('structural non-feature files inside the UI tree are skipped, not blocked', () => {
  const cov = buildCoverage([
    {
      feature: 'chat',
      manifest: {
        implementation: { paths: ['packages/chat-ui/**'] },
        build: { flows: [{ id: 'chat', approved: false }] },
      },
    },
  ])
  const res = evaluate(
    [
      'packages/chat-ui/tests/chatReducer.test.ts',
      'packages/chat-ui/package.json',
      'frontend/src/i18n/en.json',
      'packages/chat-ui/src/lib/markdown.tsx', // real feature UI — still blocked
    ],
    cov,
    REAL_POLICY
  )
  assert.equal(res.skipped.length, 3)
  assert.deepEqual(res.blocked.map(b => b.file), ['packages/chat-ui/src/lib/markdown.tsx'])
})

test('an exemption releases a file but is reported with its owner and removal criterion', () => {
  const policy = {
    ...REAL_POLICY,
    exemptions: {
      entries: [
        { paths: ['packages/chat-ui/**'], owner: 'izzywdev', reason: 'shipped pre-gate', removeWhen: 'chat frames land' },
      ],
    },
  }
  const cov = buildCoverage([
    {
      feature: 'chat',
      manifest: {
        implementation: { paths: ['packages/chat-ui/**'] },
        build: { flows: [{ id: 'chat', approved: false }] },
      },
    },
  ])
  const res = evaluate(['packages/chat-ui/src/lib/markdown.tsx'], cov, policy)
  assert.equal(res.blocked.length, 0)
  assert.equal(res.exempt.length, 1)
  assert.equal(res.exempt[0].exemption.owner, 'izzywdev')
  assert.ok(res.exempt[0].exemption.removeWhen, 'an exemption without a removal criterion is just a hole')
})

/* --------------------------------------------------- policy file self-checks */

test('every policy exemption carries an owner and a removal criterion', () => {
  for (const e of REAL_POLICY.exemptions?.entries ?? []) {
    assert.ok(e.owner, `exemption ${JSON.stringify(e.paths)} has no owner`)
    assert.ok(e.removeWhen, `exemption ${JSON.stringify(e.paths)} has no removeWhen`)
    assert.ok(Array.isArray(e.paths) && e.paths.length, 'exemption has no paths')
  }
})

test('the real policy declares the UI paths CLAUDE.md names', () => {
  assert.ok(REAL_POLICY.uiPaths.includes('frontend/src/**'))
  assert.ok(REAL_POLICY.uiPaths.includes('packages/*-ui/**'))
})
