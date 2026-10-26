import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseFrontmatter,
  bodyOf,
  scanForbiddenTerms,
  scanForbiddenUrls,
  scanPlaceholders,
  checkFrontmatter,
  checkFreshness,
  checkMedia,
  checkInternalLinks,
  checkManifestCoverage,
  checkArticle,
  checkCode,
  matchesAny,
  shouldFullScan,
} from '../check-help-conformance.mjs'

const POLICY = {
  contentRoots: ['docs/help'],
  codeSurfaces: ['frontend/src/pages/HelpPage.tsx'],
  manifest: { path: 'docs/help/manifest.json', requireBidirectional: true },
  frontmatter: {
    required: ['title', 'description', 'audience', 'order', 'owner', 'lastReviewed', 'status'],
    audienceValues: ['user', 'developer'],
    statusValues: ['published', 'draft'],
    ownerPattern: '^@[A-Za-z0-9-]+$',
    datePattern: '^\\d{4}-\\d{2}-\\d{2}$',
  },
  forbiddenTerms: {
    entries: [
      { term: 'FrontFuse', reason: 'old name' },
      { term: '@frontfuse/sdk', reason: 'never existed' },
      { term: 'localhost:3001', reason: 'not a user-facing host' },
      { term: 'admin123', reason: 'fake credential' },
      { term: 'OldName', reason: 'renamed', allowIn: ['docs/help/**/changelog.md'] },
    ],
  },
  forbiddenUrlPatterns: {
    entries: [
      { pattern: 'https?://localhost(:\\d+)?', reason: 'localhost' },
      { pattern: 'https?://your-[a-z0-9-]+', reason: 'placeholder' },
    ],
  },
  placeholderMarkers: { entries: ['TODO', 'TBD', 'COMING SOON'], allowedInStatus: ['draft'] },
  freshness: { days: 180, mode: 'warn' },
  media: {
    assetDir: 'docs/help/_assets',
    allowedImageExtensions: ['.png', '.webp', '.svg'],
    requireAlt: true,
    maxImageKB: 500,
    forbidPlaceholderAssets: true,
    videoAllowedHosts: ['developers.fuzefront.com', 'youtu.be'],
  },
  links: { checkInternalRelative: true },
  exemptPaths: { paths: ['docs/help/README.md', 'docs/help/**/README.md', 'docs/help/_assets/**'] },
}

const FM = [
  '---',
  'title: Getting Started',
  'description: How to start',
  'audience: user',
  'order: 1',
  'owner: "@izzywdev"',
  'lastReviewed: 2026-10-26',
  'status: published',
  '---',
  '',
  'Body here.',
].join('\n')

test('parseFrontmatter reads scalars and strips quotes', () => {
  const { data, found } = parseFrontmatter(FM)
  assert.equal(found, true)
  assert.equal(data.title, 'Getting Started')
  assert.equal(data.owner, '@izzywdev')
  assert.equal(data.order, '1')
})

test('parseFrontmatter handles media flow-maps', () => {
  const t = [
    '---',
    'title: X',
    'media:',
    '  - { src: _assets/x.png, alt: "The X screen", type: image }',
    '  - { src: https://youtu.be/abc, alt: Walkthrough, type: video }',
    '---',
    'body',
  ].join('\n')
  const { data } = parseFrontmatter(t)
  assert.equal(data.media.length, 2)
  assert.equal(data.media[0].src, '_assets/x.png')
  assert.equal(data.media[0].alt, 'The X screen')
  assert.equal(data.media[1].type, 'video')
})

test('parseFrontmatter returns found=false with no block', () => {
  assert.equal(parseFrontmatter('# just a heading\n').found, false)
})

test('bodyOf strips the frontmatter block', () => {
  assert.equal(bodyOf(FM).trim(), 'Body here.')
})

test('scanForbiddenTerms catches the OLD HelpPage defects (regression)', () => {
  // The exact strings that shipped to production in HelpPage.tsx.
  const samples = [
    'Welcome to FrontFuse',
    'npm install @frontfuse/sdk',
    'curl -X POST http://localhost:3001/api/auth/login',
    '{"email": "admin@frontfuse.dev", "password": "admin123"}',
  ]
  for (const s of samples) {
    assert.ok(scanForbiddenTerms('frontend/src/pages/HelpPage.tsx', s, POLICY).length > 0, `should flag: ${s}`)
  }
})

test('scanForbiddenTerms respects allowIn', () => {
  assert.equal(scanForbiddenTerms('docs/help/user-guide/changelog.md', 'OldName was renamed', POLICY).length, 0)
  assert.ok(scanForbiddenTerms('docs/help/user-guide/getting-started.md', 'OldName', POLICY).length > 0)
})

test('scanForbiddenUrls flags localhost and placeholder hosts', () => {
  assert.ok(scanForbiddenUrls('see http://localhost:3001/api-docs', POLICY).length > 0)
  assert.ok(scanForbiddenUrls('deploy to https://your-app.example', POLICY).length > 0)
  assert.equal(scanForbiddenUrls('see https://developers.fuzefront.com', POLICY).length, 0)
})

test('scanPlaceholders fails published, allows draft', () => {
  assert.ok(scanPlaceholders('This is TODO still', POLICY, 'published').length > 0)
  assert.equal(scanPlaceholders('This is TODO still', POLICY, 'draft').length, 0)
  // substring inside a word must not trip
  assert.equal(scanPlaceholders('methodology and metadata', POLICY, 'published').length, 0)
})

test('checkFrontmatter catches missing and invalid fields', () => {
  assert.ok(checkFrontmatter({}, true, POLICY).some(e => e.msg.includes('title')))
  const bad = { title: 't', description: 'd', audience: 'nobody', order: '1', owner: 'izzy', lastReviewed: '10-2026', status: 'live' }
  const errs = checkFrontmatter(bad, true, POLICY)
  assert.ok(errs.some(e => e.msg.includes('audience')))
  assert.ok(errs.some(e => e.msg.includes('owner')))
  assert.ok(errs.some(e => e.msg.includes('lastReviewed')))
  assert.ok(errs.some(e => e.msg.includes('status')))
})

test('checkFrontmatter passes a good block', () => {
  const { data, found } = parseFrontmatter(FM)
  assert.equal(checkFrontmatter(data, found, POLICY).length, 0)
})

test('checkFreshness flags stale and passes fresh', () => {
  const today = new Date('2026-10-26T00:00:00Z')
  assert.equal(checkFreshness({ lastReviewed: '2026-10-01' }, POLICY, today).stale, false)
  assert.equal(checkFreshness({ lastReviewed: '2025-01-01' }, POLICY, today).stale, true)
})

test('checkMedia enforces alt, existence, placeholder, video host', () => {
  // _assets/... resolves against the help root (dirname of media.assetDir), NOT article-relative.
  const io = {
    existsOf: rel => rel === 'docs/help/_assets/real.png' || rel === 'docs/help/_assets/empty.png',
    statOf: rel => (rel.endsWith('empty.png') ? { size: 0 } : { size: 1024 }),
  }
  const rel = 'docs/help/user-guide/getting-started.md'
  // missing alt
  assert.ok(checkMedia(rel, { media: [{ src: '_assets/real.png', type: 'image' }] }, POLICY, io).some(e => e.msg.includes('alt')))
  // ok
  assert.equal(checkMedia(rel, { media: [{ src: '_assets/real.png', alt: 'ok', type: 'image' }] }, POLICY, io).length, 0)
  // missing file
  assert.ok(checkMedia(rel, { media: [{ src: '_assets/nope.png', alt: 'x', type: 'image' }] }, POLICY, io).some(e => e.msg.includes('does not exist')))
  // 0-byte placeholder
  assert.ok(checkMedia(rel, { media: [{ src: '_assets/empty.png', alt: 'x', type: 'image' }] }, POLICY, io).some(e => e.msg.includes('placeholder')))
  // bad video host
  assert.ok(checkMedia(rel, { media: [{ src: 'https://evil.example/v', alt: 'x', type: 'video' }] }, POLICY, io).some(e => e.msg.includes('host')))
  // good video host
  assert.equal(checkMedia(rel, { media: [{ src: 'https://youtu.be/abc', alt: 'x', type: 'video' }] }, POLICY, io).length, 0)
})

test('checkInternalLinks resolves relative, ignores external/anchors', () => {
  const io = { existsOf: rel => rel === 'docs/help/user-guide/next.md' }
  const rel = 'docs/help/user-guide/getting-started.md'
  assert.equal(checkInternalLinks(rel, 'see [next](next.md) and [site](https://x.com) and [top](#top)', io).length, 0)
  assert.ok(checkInternalLinks(rel, 'see [gone](missing.md)', io).length > 0)
})

test('checkManifestCoverage flags orphans and dangling entries', () => {
  const manifest = { sections: [{ id: 'u', articles: ['docs/help/user-guide/a.md', 'docs/help/user-guide/gone.md'] }] }
  const onDisk = ['docs/help/user-guide/a.md', 'docs/help/user-guide/orphan.md']
  const errs = checkManifestCoverage(manifest, onDisk)
  assert.ok(errs.some(e => e.msg.includes('gone.md') && e.msg.includes('dangling')))
  assert.ok(errs.some(e => e.msg.includes('orphan.md') && e.msg.includes('orphan')))
})

test('checkArticle: clean article has no errors', () => {
  const io = { existsOf: () => true, statOf: () => ({ size: 100 }), today: new Date('2026-10-26T00:00:00Z') }
  const res = checkArticle('docs/help/user-guide/getting-started.md', FM, POLICY, io)
  assert.equal(res.errors.length, 0)
})

test('checkArticle: freshness is a warning under mode=warn', () => {
  const stale = FM.replace('2026-10-26', '2024-01-01')
  const io = { existsOf: () => true, statOf: () => ({ size: 100 }), today: new Date('2026-10-26T00:00:00Z') }
  const res = checkArticle('docs/help/user-guide/getting-started.md', stale, POLICY, io)
  assert.equal(res.errors.length, 0)
  assert.ok(res.warnings.some(w => w.kind === 'freshness'))
})

test('checkArticle: freshness is an error under mode=fail', () => {
  const stale = FM.replace('2026-10-26', '2024-01-01')
  const failPolicy = { ...POLICY, freshness: { days: 180, mode: 'fail' } }
  const io = { existsOf: () => true, statOf: () => ({ size: 100 }), today: new Date('2026-10-26T00:00:00Z') }
  const res = checkArticle('docs/help/user-guide/getting-started.md', stale, failPolicy, io)
  assert.ok(res.errors.some(e => e.kind === 'freshness'))
})

test('checkCode flags forbidden strings in a code surface', () => {
  const res = checkCode('frontend/src/pages/HelpPage.tsx', 'const title = "FrontFuse"', POLICY)
  assert.ok(res.errors.length > 0)
})

test('parseFrontmatter strips inline YAML comments on unquoted scalars (template)', () => {
  // The authoring template carries inline comments; copying it verbatim must still validate.
  const t = [
    '---',
    'title: Getting Started',
    'description: How to start',
    'audience: user            # user | developer',
    'order: 1',
    'owner: "@izzywdev"',
    'lastReviewed: 2026-10-26   # today, YYYY-MM-DD',
    'status: published          # published | draft',
    '---',
    'body',
  ].join('\n')
  const { data, found } = parseFrontmatter(t)
  assert.equal(data.audience, 'user')
  assert.equal(data.status, 'published')
  assert.equal(data.lastReviewed, '2026-10-26')
  assert.equal(checkFrontmatter(data, found, POLICY).length, 0)
})

test('checkMedia resolves the documented _assets/<slug> format against the help root', () => {
  const io = {
    existsOf: rel => rel === 'docs/help/_assets/getting-started/01-dashboard.png',
    statOf: () => ({ size: 2048 }),
  }
  const rel = 'docs/help/user-guide/getting-started.md'
  const errs = checkMedia(rel, { media: [{ src: '_assets/getting-started/01-dashboard.png', alt: 'Dashboard', type: 'image' }] }, POLICY, io)
  assert.equal(errs.length, 0)
})

test('shouldFullScan escalates on policy/manifest change or article removal', () => {
  const existsAll = () => true
  // policy-only change
  assert.equal(shouldFullScan(['governance/help-system-policy.json'], POLICY, 'governance/help-system-policy.json', existsAll), true)
  // manifest change
  assert.equal(shouldFullScan(['docs/help/manifest.json'], POLICY, 'governance/help-system-policy.json', existsAll), true)
  // article deleted/renamed (changed but no longer on disk)
  assert.equal(shouldFullScan(['docs/help/user-guide/getting-started.md'], POLICY, 'governance/help-system-policy.json', () => false), true)
  // ordinary article edit → no escalation
  assert.equal(shouldFullScan(['docs/help/user-guide/getting-started.md'], POLICY, 'governance/help-system-policy.json', existsAll), false)
})

test('matchesAny glob basics', () => {
  assert.ok(matchesAny('docs/help/user-guide/a.md', ['docs/help/**']))
  assert.ok(matchesAny('docs/help/README.md', ['docs/help/**/README.md', 'docs/help/README.md']))
  assert.ok(!matchesAny('docs/help/user-guide/a.md', ['docs/help/_assets/**']))
})
