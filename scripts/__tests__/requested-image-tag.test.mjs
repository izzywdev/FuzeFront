import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractImageTag } from '../requested-image-tag.mjs'

const VALUES = `
backend:
  image:
    repository: ghcr.io/izzywdev/fuzefront-backend
    tag: aaaaaaaaaaaa
applicationsService:
  enabled: true   # serves /api/apps
  image:
    repository: ghcr.io/izzywdev/fuzefront-applications-service
    tag: d153b573bbcd
  replicas: 2
security:
  image:
    tag: "cccccccccccc"
`

test('reads the tag of the requested service, not the first tag in the file', () => {
  assert.equal(extractImageTag(VALUES, 'applicationsService'), 'd153b573bbcd')
  assert.equal(extractImageTag(VALUES, 'backend'), 'aaaaaaaaaaaa')
})

test('strips quotes', () => {
  assert.equal(extractImageTag(VALUES, 'security'), 'cccccccccccc')
})

test('an unknown service is null, never a neighbouring service’s tag', () => {
  assert.equal(extractImageTag(VALUES, 'noSuchService'), null)
})

// The failure this guards is silent: a service block whose `image:` has no
// `tag:` must not fall through and pick up the NEXT top-level service's tag.
// That would report a plausible-looking twelve-hex string that belongs to a
// different image, and the drift check would compare the wrong two things and
// go green.
test('a service with no tag under its image block is null, not the next block’s tag', () => {
  const noTag = `
applicationsService:
  image:
    repository: ghcr.io/izzywdev/fuzefront-applications-service
security:
  image:
    tag: cccccccccccc
`
  assert.equal(extractImageTag(noTag, 'applicationsService'), null)
})

test('a service with no image block at all is null', () => {
  assert.equal(extractImageTag('applicationsService:\n  enabled: true\nbackend:\n  image:\n    tag: zz\n', 'applicationsService'), null)
})

test('comments and blank lines inside the block do not terminate the scan', () => {
  const commented = `
applicationsService:

  # a comment at service level
  image:
    # a comment at image level

    tag: d153b573bbcd
`
  assert.equal(extractImageTag(commented, 'applicationsService'), 'd153b573bbcd')
})

test('a trailing comment on the tag line is not part of the tag', () => {
  assert.equal(
    extractImageTag('applicationsService:\n  image:\n    tag: abc123  # bumped by release.yml\n', 'applicationsService'),
    'abc123'
  )
})
