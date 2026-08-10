// Tests for the publish rename/rewrite transform.
//
// The transform is the whole reason these packages can publish at all, and its
// failure mode is silent: a wrong rewrite produces a tarball that publishes
// happily and is uninstallable by anyone. That is not caught by the publish
// step exiting 0, so it has to be caught here.
//
// Run: node --test scripts/__tests__/publish-packages.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aliasFor, rewriteForPublish } from '../publish-packages.mjs'

test('aliasFor maps the canonical scope onto the owner scope', () => {
  assert.equal(aliasFor('@fuzefront/chat-ui'), '@izzywdev/fuzefront-chat-ui')
  assert.equal(aliasFor('@fuzefront/i18n'), '@izzywdev/fuzefront-i18n')
})

test('aliasFor leaves an already-owner-scoped name alone', () => {
  // packages/identity is already published under the owner scope; renaming it
  // again would produce @izzywdev/fuzefront-izzywdev-…
  assert.equal(aliasFor('@izzywdev/fuzefront-identity'), '@izzywdev/fuzefront-identity')
})

test('aliasFor leaves third-party names alone', () => {
  assert.equal(aliasFor('react'), 'react')
  assert.equal(aliasFor('@types/node'), '@types/node')
})

test('rewrites in-family dependencies, not just the package name', () => {
  // The bug this prevents: a published @izzywdev/fuzefront-chat-ui whose
  // dependencies still name @fuzefront/chat-client. That name resolves to
  // nothing on any registry, so the package installs for nobody.
  const out = rewriteForPublish(
    {
      name: '@fuzefront/chat-ui',
      version: '1.1.0',
      dependencies: { '@fuzefront/chat-client': '^1.1.0', react: '^19.2.0' },
    },
    { '@fuzefront/chat-client': '1.1.0' }
  )
  assert.equal(out.name, '@izzywdev/fuzefront-chat-ui')
  assert.deepEqual(out.dependencies, {
    '@izzywdev/fuzefront-chat-client': '^1.1.0',
    react: '^19.2.0',
  })
})

test('turns local specifiers into a real version range', () => {
  // `file:../../packages/identity` is meaningless outside this tree.
  const out = rewriteForPublish(
    {
      name: '@fuzefront/billing-ui',
      version: '1.0.0',
      dependencies: { '@izzywdev/fuzefront-identity': 'file:../../packages/identity' },
    },
    { '@izzywdev/fuzefront-identity': '1.0.0' }
  )
  assert.deepEqual(out.dependencies, { '@izzywdev/fuzefront-identity': '^1.0.0' })
})

test('rewrites peerDependencies too', () => {
  const out = rewriteForPublish(
    {
      name: '@fuzefront/auth-ui',
      version: '0.1.0',
      peerDependencies: { '@fuzefront/design-system': '^1.0.0', react: '^19.0.0' },
    },
    { '@fuzefront/design-system': '1.0.0' }
  )
  assert.deepEqual(out.peerDependencies, {
    '@izzywdev/fuzefront-design-system': '^1.0.0',
    react: '^19.0.0',
  })
})

test('fails loudly when a local dependency is not publishable', () => {
  // Silently publishing a package whose dependency can never be installed is
  // strictly worse than failing the release.
  assert.throws(
    () =>
      rewriteForPublish(
        {
          name: '@fuzefront/thing',
          version: '1.0.0',
          dependencies: { '@fuzefront/private-svc': 'file:../private-svc' },
        },
        {}
      ),
    /not a publishable workspace/
  )
})

test('does not mutate the input manifest', () => {
  const pkg = {
    name: '@fuzefront/i18n',
    version: '1.0.0',
    dependencies: { '@fuzefront/design-system': '^1.0.0' },
  }
  rewriteForPublish(pkg, { '@fuzefront/design-system': '1.0.0' })
  assert.equal(pkg.name, '@fuzefront/i18n')
  assert.deepEqual(pkg.dependencies, { '@fuzefront/design-system': '^1.0.0' })
})
