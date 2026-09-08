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
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  aliasFor,
  rewriteForPublish,
  filterTargets,
  isPublishableName,
  assertAliasable,
} from '../publish-packages.mjs'

test('aliasFor maps the canonical scope onto the owner scope', () => {
  assert.equal(aliasFor('@fuzefront/chat-ui'), '@izzywdev/fuzefront-chat-ui')
  assert.equal(aliasFor('@fuzefront/i18n'), '@izzywdev/fuzefront-i18n')
})

test('aliasFor leaves an already-owner-scoped name alone', () => {
  // packages/identity is already published under the owner scope; renaming it
  // again would produce @izzywdev/fuzefront-izzywdev-…
  assert.equal(aliasFor('@izzywdev/fuzefront-identity'), '@izzywdev/fuzefront-identity')
})

test('aliasFor maps every canonical scope, not just @fuzefront', () => {
  // The bug this prevents, measured: @fuzeone/selection-lists-ui fell through
  // aliasFor unchanged and was published under its own scope, which GitHub
  // Packages rejects because the scope is not the repo owner:
  //
  //   npm error 403 Forbidden - PUT https://npm.pkg.github.com/@fuzeone%2fselection-lists-ui
  //   Permission permission_denied: The requested installation does not exist.
  //
  // 24 of 25 matrix legs went green and the RUN still concluded `failure`, so a
  // green packages-publish stopped being evidence that anything shipped.
  assert.equal(aliasFor('@fuzeone/selection-lists-ui'), '@izzywdev/fuzeone-selection-lists-ui')
})

test('aliasFor leaves third-party names alone', () => {
  // aliasFor also runs over DEPENDENCY names, so pass-through has to stay.
  // That is why the unknown-scope rejection lives in assertAliasable, which
  // only ever sees publish targets.
  assert.equal(aliasFor('react'), 'react')
  assert.equal(aliasFor('@types/node'), '@types/node')
})

test('isPublishableName rejects a scope with no alias rule', () => {
  assert.equal(isPublishableName('@fuzefront/chat-ui'), true)
  assert.equal(isPublishableName('@fuzeone/selection-lists-ui'), true)
  assert.equal(isPublishableName('@izzywdev/fuzefront-identity'), true)
  // A scope nobody has taught the script about, and a bare unscoped name:
  // both would 403 exactly like @fuzeone did.
  assert.equal(isPublishableName('@fuzenext/thing'), false)
  assert.equal(isPublishableName('selection-list-service'), false)
})

test('assertAliasable fails the run before anything publishes', () => {
  // Loud and early beats one red leg among two dozen green ones — that reads
  // as flakiness and is exactly how the @fuzeone 403 survived every run.
  assert.throws(
    () => assertAliasable([{ dir: 'packages/thing', pkg: { name: '@fuzenext/thing' } }]),
    /403 permission_denied/
  )
  assert.throws(
    () => assertAliasable([{ dir: 'packages/thing', pkg: { name: '@fuzenext/thing' } }]),
    /SCOPE_ALIASES/
  )
})

test('assertAliasable passes the real workspace set', () => {
  // The regression guard with teeth: this reads the ACTUAL root package.json,
  // so adding a workspace under a brand-new scope fails here — in `verify`,
  // before any matrix leg uploads a byte — instead of 403-ing on merge to
  // master. A per-package unit assertion could not have caught @fuzeone;
  // nothing in the tree enumerated the scopes.
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const ws = JSON.parse(readFileSync(`${root}/package.json`, 'utf8')).workspaces ?? []
  const targets = ws
    .filter((dir) => !dir.includes('*') && existsSync(`${root}/${dir}/package.json`))
    .map((dir) => ({ dir, pkg: JSON.parse(readFileSync(`${root}/${dir}/package.json`, 'utf8')) }))
    .filter(({ pkg }) => !pkg.private && pkg.name)

  assert.ok(targets.length > 0, 'expected at least one publishable workspace')
  assert.doesNotThrow(() => assertAliasable(targets))
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

// --only backs packages-publish.yml's per-package matrix: a matrix leg's build
// scope and its publish scope must agree on exactly one package, or the leg
// either publishes nothing or (worse) silently falls back to publishing
// everything it can see.
test('filterTargets with no --only returns every target unchanged', () => {
  const targets = [{ dir: 'a', pkg: { name: '@fuzefront/a' } }, { dir: 'b', pkg: { name: '@fuzefront/b' } }]
  assert.equal(filterTargets(targets, null), targets)
})

test('filterTargets narrows to the exact package name', () => {
  const targets = [{ dir: 'a', pkg: { name: '@fuzefront/a' } }, { dir: 'b', pkg: { name: '@fuzefront/b' } }]
  const out = filterTargets(targets, '@fuzefront/b')
  assert.deepEqual(out.map((t) => t.pkg.name), ['@fuzefront/b'])
})

test('filterTargets throws on an unknown name instead of publishing everything', () => {
  const targets = [{ dir: 'a', pkg: { name: '@fuzefront/a' } }]
  assert.throws(() => filterTargets(targets, '@fuzefront/typo'), /no publishable workspace has that name/)
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
