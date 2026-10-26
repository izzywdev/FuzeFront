import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hostedCoverage } from '../lib/fuzex-review.mjs'

const hostedStamp = 'a'.repeat(64)
const sourceStamp = 'b'.repeat(64)
const config = { mode: 'hosted', baseUrl: 'https://example.test/apps/fuzex', sourceRepo: 'izzywdev/FuzeFront', features: { login: 'login' } }
const coverage = [{ feature: 'login', flow: 'sign-in', approved: true, paths: ['frontend/src/login/**'] }]
function options({ decision = 'approve', contentStamp = hostedStamp, provenance = sourceStamp, current = true, fail = false, changed = false } = {}) {
  let stampReads = 0
  return {
    config, framesDir: '/frames', stamp: async () => sourceStamp,
    fetcher: async (url, init) => {
      assert.equal(init.redirect, 'error')
      assert.ok(init.signal)
      if (fail) return { ok: false, status: 503 }
      let body
      if (url.endsWith('/stamp')) {
        stampReads++
        body = { stamp: changed && stampReads > 1 ? 'c'.repeat(64) : hostedStamp, manifestStamp: hostedStamp, current }
      } else if (url.includes('/revisions/')) {
        body = { stamp: hostedStamp, manifest: { sourceRepo: 'https://github.com/izzywdev/FuzeFront', sourceStamp: provenance } }
      } else {
        assert.ok(url.endsWith('/flows/sign-in/approvals?limit=1'))
        body = { items: decision ? [{ slug: 'login', flowId: 'sign-in', decision, contentStamp }] : [] }
      }
      return { ok: true, json: async () => body }
    },
  }
}

test('hosted decision approves exact imported source bytes despite local false flag', async () => {
  const result = await hostedCoverage([{ ...coverage[0], approved: false }], options())
  assert.equal(result[0].approved, true)
  assert.equal(result[0].approvalSource, 'fuzex')
})
for (const override of [{ decision: 'reject' }, { decision: null }, { contentStamp: null }, { contentStamp: 'c'.repeat(64) }]) {
  test(`hosted decision blocks local true flag: ${JSON.stringify(override)}`, async () => {
    assert.equal((await hostedCoverage(coverage, options(override)))[0].approved, false)
  })
}
for (const [name, override, error] of [
  ['outage', { fail: true }, /503/],
  ['uncommitted revision', { current: false }, /immutable/],
  ['different Git content', { provenance: 'c'.repeat(64) }, /provenance/],
  ['concurrent import', { changed: true }, /changed during/],
]) {
  test(`hosted ${name} fails without legacy fallback`, async () => {
    await assert.rejects(hostedCoverage(coverage, options(override)), error)
  })
}
test('unmigrated features retain their legacy decisions', async () => {
  const legacy = [{ feature: 'other', flow: 'main', approved: true }]
  assert.deepEqual(await hostedCoverage(legacy, options({ fail: true })), legacy)
  assert.equal(await hostedCoverage(coverage, { config: { mode: 'legacy' } }), coverage)
})
test('rejects insecure URL configuration and unknown migration modes', async () => {
  await assert.rejects(hostedCoverage(coverage, { ...options(), config: { ...config, baseUrl: 'http://example.test' } }), /HTTPS/)
  await assert.rejects(hostedCoverage(coverage, { ...options(), config: { mode: 'typo' } }), /legacy or hosted/)
})
test('feature-level approvals need flow IDs for hosted migration', async () => {
  await assert.rejects(hostedCoverage([{ ...coverage[0], flow: '(feature-level)' }], options()), /explicit flow IDs/)
})
