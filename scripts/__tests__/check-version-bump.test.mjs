/**
 * Tests for gate-version (scripts/check-version-bump.mjs).
 *
 * The two cases this file exists for:
 *  - `ownerOf` attributes a file to ONE package (the nearest). The inline gate it
 *    replaces charged every file to the root package.json and to every parent
 *    workspace, which is why it could never be switched to enforcing.
 *  - `specVersion` reads info.version by structure. The old grep took the first
 *    indented `version:` anywhere — in a real spec, often a schema property.
 *
 * Run with:  node --test scripts/__tests__/check-version-bump.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  checkBump,
  compareSemver,
  isIgnored,
  isSpec,
  ownerOf,
  parseSemver,
  specVersion,
} from '../check-version-bump.mjs'

test('ownerOf: nearest publishable dir wins; unowned files belong to nobody', () => {
  const dirs = ['packages/auth', 'packages/auth-ui', 'backend/core', 'sdk']
  assert.equal(ownerOf('packages/auth/src/x.ts', dirs), 'packages/auth')
  // prefix of a sibling's name is not ownership
  assert.equal(ownerOf('packages/auth-ui/src/x.tsx', dirs), 'packages/auth-ui')
  assert.equal(ownerOf('backend/core/src/a.ts', dirs), 'backend/core')
  // the private backend app is not published, so its files are nobody's
  assert.equal(ownerOf('backend/src/index.ts', dirs), null)
  assert.equal(ownerOf('package.json', dirs), null)
  assert.equal(ownerOf('sdk', dirs), null)
})

test('ownerOf: longest prefix when publishable dirs nest', () => {
  assert.equal(ownerOf('a/b/c.ts', ['a', 'a/b']), 'a/b')
  assert.equal(ownerOf('a/c.ts', ['a', 'a/b']), 'a')
})

test('isIgnored: tests, docs, lockfiles and tooling config do not require a bump', () => {
  for (const f of [
    'packages/auth/src/__tests__/a.ts',
    'packages/auth/tests/a.ts',
    'packages/auth/src/a.test.ts',
    'packages/chat-ui/src/Chat.spec.tsx',
    'packages/chat-ui/src/Chat.stories.tsx',
    'packages/auth/README.md',
    'packages/auth/package-lock.json',
    'sdk/.npmrc',
    'packages/auth/vitest.config.ts',
    'packages/auth/.eslintrc.json',
  ]) {
    assert.equal(isIgnored(f), true, f)
  }
  for (const f of [
    'packages/auth/src/index.ts',
    'packages/auth/package.json',
    'packages/auth/tsconfig.json',
    'design-system/src/tokens.css',
    'packages/auth/src/testing-utils.ts', // not a test dir, ships
  ]) {
    assert.equal(isIgnored(f), false, f)
  }
})

test('isSpec: live OpenAPI/Swagger files only', () => {
  assert.equal(isSpec('services/config-service/openapi.yaml'), true)
  assert.equal(isSpec('packages/security/openapi.yaml'), true)
  assert.equal(
    isSpec('deploy/helm/fuzefront/files/app-registry-openapi.yaml'),
    true
  )
  assert.equal(isSpec('x/swagger.json'), true)
  assert.equal(isSpec('docs/api/openapi.yaml'), false)
  assert.equal(isSpec('sdd/x/openapi.yaml'), false)
  assert.equal(isSpec('.github/workflows/gate-openapi-conformance.yml'), false)
  assert.equal(isSpec('services/x/src/openapi.ts'), false)
})

test('parseSemver / compareSemver', () => {
  assert.deepEqual(parseSemver('1.2.3'), [1, 2, 3, null])
  assert.deepEqual(parseSemver('1.2.3-rc.1+b5'), [1, 2, 3, 'rc.1'])
  assert.equal(parseSemver('1.2'), null)
  assert.equal(parseSemver('01.2.3'), null)
  assert.equal(parseSemver('latest'), null)
  assert.ok(compareSemver(parseSemver('1.0.1'), parseSemver('1.0.0')) > 0)
  assert.ok(compareSemver(parseSemver('0.10.0'), parseSemver('0.9.9')) > 0)
  assert.ok(compareSemver(parseSemver('1.0.0'), parseSemver('1.0.0-rc.1')) > 0)
  assert.equal(compareSemver(parseSemver('2.0.0'), parseSemver('2.0.0')), 0)
})

test('checkBump: unchanged, backwards and invalid versions fail; increases and new packages pass', () => {
  assert.equal(checkBump('p', '1.0.0', '1.0.0').length, 1)
  assert.match(checkBump('p', '1.0.0', '1.0.0')[0], /not bumped/)
  assert.match(checkBump('p', '1.2.0', '1.1.9')[0], /backwards/)
  assert.match(checkBump('p', '1.0.0', 'next')[0], /not valid SemVer/)
  assert.match(checkBump('p', '1.0.0', undefined)[0], /no version/)
  assert.deepEqual(checkBump('p', '1.0.0', '1.0.1'), [])
  assert.deepEqual(checkBump('p', '0.9.0', '0.10.0'), [])
  assert.deepEqual(checkBump('p', null, '0.1.0'), [])
})

test('specVersion: reads info.version, not a schema property named version', () => {
  const yaml = [
    'openapi: 3.0.3',
    'components:',
    '  schemas:',
    '    App:',
    '      properties:',
    '        version:',
    '          type: string',
    'info:',
    '  title: X',
    '  description: |',
    '    version: 9.9.9 is mentioned in prose',
    '  version: "1.4.0" # bumped',
    'paths: {}',
  ].join('\n')
  assert.equal(specVersion(yaml, 'openapi.yaml'), '1.4.0')
})

test('specVersion: info block without a version, and JSON specs', () => {
  assert.equal(specVersion('info:\n  title: X\npaths: {}\n', 'a.yaml'), null)
  assert.equal(specVersion('{"info":{"version":"2.0.0"}}', 'a.json'), '2.0.0')
  assert.equal(specVersion('{not json', 'a.json'), null)
  assert.equal(specVersion(null, 'a.yaml'), null)
})
