#!/usr/bin/env node
// Publish every publishable workspace package to GitHub Packages.
//
// WHY THIS EXISTS INSTEAD OF PLAIN `lerna publish`
//
// GitHub Packages requires the npm scope to match the account that OWNS the
// repository. This repo is owned by the personal account **izzywdev**, so the
// canonical `@fuzefront/*` names cannot publish there — no `fuzefront` account
// exists, and the `FuzeOne` org that does exist owns no repositories yet. The
// previous workflow was gated on an owner that never matched, so lerna no-opped
// on every run and not one package had ever been published.
//
// The fix is to publish under the owner's scope while keeping the canonical
// names in the source tree: `@fuzefront/x` is renamed to
// `@izzywdev/fuzefront-x` at publish time. That is the same mechanism the
// interim per-package publishers already used successfully; this generalises it
// to every package so they stop drifting apart.
//
// The part those one-offs got wrong, and this does not: **intra-family
// dependencies are rewritten too.** A published `@izzywdev/fuzefront-chat-ui`
// whose dependencies still say `@fuzefront/chat-client` cannot be installed by
// anyone — that name resolves to nothing on any registry. Every `@fuzefront/*`
// dependency is rewritten to its alias, and `file:`/`workspace:` specifiers
// (meaningless outside this tree) are replaced with the target's real version.
//
// Publishing is IDEMPOTENT: a version already in the registry is skipped, never
// overwritten. So a re-run after a partial failure is safe, and so is the
// overlap with any per-package publisher still in place.
//
// Usage:
//   node scripts/publish-packages.mjs --dry-run          # resolve + report, publish nothing
//   node scripts/publish-packages.mjs                    # publish every publishable package
//   node scripts/publish-packages.mjs --only <pkgName>   # publish (or dry-run) just one package
//   node scripts/publish-packages.mjs --list-json        # print `["@fuzefront/x", ...]` and exit
//   node scripts/publish-packages.mjs --list-dirs        # print one publishable workspace dir per line
//
// Requires NODE_AUTH_TOKEN for a real publish.
//
// --only / --list-json exist for packages-publish.yml's per-package matrix:
// one broken package's `lerna run build` used to abort the single shared job
// before it ever reached the publish step, so a green, tested, merged package
// like @fuzefront/service-auth could not ship because an unrelated service
// failed to compile. `--list-json` gives the workflow its matrix (one leg per
// publishable package); `--only` scopes that leg's build and publish to just
// that package + its own dependency closure, so an unrelated package's failure
// can no longer block it. `versionByName` is still computed from every
// publishable package regardless of `--only` — a local dependency's version is
// needed for the rewrite even when that dependency isn't the leg's target.

import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const root = process.cwd()
const REGISTRY = 'https://npm.pkg.github.com'
const OWNER_SCOPE = '@izzywdev'

/**
 * Canonical source-tree scope -> the prefix its packages take under the owner
 * scope at publish time.
 *
 * EVERY canonical scope in the tree needs an entry here. GitHub Packages
 * requires the published scope to equal the account that owns the repository
 * (`izzywdev`), so a name that is neither owner-scoped nor aliased by this map
 * is not publishable at all — `npm publish` answers
 * `403 permission_denied: The requested installation does not exist`.
 *
 * This map used to be a single `CANONICAL_SCOPE = '@fuzefront/'` constant, and
 * everything else fell through `aliasFor` unchanged. `@fuzeone/*` — a second,
 * deliberate canonical scope (EPIC-17 records the decision: the intended future
 * home is the `fuzeone` org) — therefore went out under its own name and 403'd
 * on every single run. 24 of 25 legs succeeded and the run's conclusion was
 * still `failure`, which destroys the only property this workflow is for: that
 * a green `packages-publish` is evidence the packages actually shipped. See
 * `assertAliasable` for why a future third scope now fails loudly instead.
 */
const SCOPE_ALIASES = {
  '@fuzefront/': 'fuzefront-',
  '@fuzeone/': 'fuzeone-',
}

const DEP_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies']
const LOCAL_PROTOCOL = /^(file:|link:|workspace:|portal:)/

const dryRun = process.argv.includes('--dry-run')
const listJson = process.argv.includes('--list-json')
const listDirs = process.argv.includes('--list-dirs')
const onlyIdx = process.argv.indexOf('--only')
const only = onlyIdx === -1 ? null : process.argv[onlyIdx + 1]
if (onlyIdx !== -1 && !only) {
  console.error('--only requires a package name argument')
  process.exit(1)
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/**
 * `@fuzefront/chat-ui` -> `@izzywdev/fuzefront-chat-ui`.
 * `@fuzeone/selection-lists-ui` -> `@izzywdev/fuzeone-selection-lists-ui`.
 *
 * Already-owner-scoped names pass through, and so does everything else —
 * `aliasFor` is also applied to every DEPENDENCY name, where `react` and
 * `@types/node` must survive untouched. That pass-through is why it cannot be
 * the thing that rejects an unknown scope; `assertAliasable` does that, against
 * publish TARGETS only.
 */
export function aliasFor(name) {
  if (name.startsWith(`${OWNER_SCOPE}/`)) return name
  for (const [scope, prefix] of Object.entries(SCOPE_ALIASES)) {
    if (name.startsWith(scope)) {
      return `${OWNER_SCOPE}/${prefix}${name.slice(scope.length)}`
    }
  }
  return name
}

/** True when `name` publishes to an owner-scoped name the registry will accept. */
export function isPublishableName(name) {
  return aliasFor(name).startsWith(`${OWNER_SCOPE}/`)
}

/**
 * Fail the whole run if any publish target's name does not resolve into the
 * owner scope — i.e. would 403 at `npm publish`.
 *
 * This is the generalisation of the `@fuzeone` bug rather than a patch for it.
 * A scope with no alias rule is not a package-specific problem; it is a class
 * of problem that reappears the next time someone introduces a scope, and its
 * symptom (one red matrix leg among two dozen green ones) reads as flakiness.
 *
 * It deliberately throws EARLY — `publishable()` runs before `--list-json`
 * resolves the matrix — so the failure is one loud error naming the offending
 * package and the one-line fix (add the scope to SCOPE_ALIASES), raised before
 * a single package has been uploaded. Nothing ships half-way: an aborted
 * matrix resolution publishes nothing, and publishing is idempotent, so the
 * re-run after the fix is a clean full release.
 */
export function assertAliasable(targets) {
  const bad = targets.filter(({ pkg }) => !isPublishableName(pkg.name))
  if (bad.length) {
    const known = Object.keys(SCOPE_ALIASES).join(', ')
    throw new Error(
      `Not publishable — these workspace names resolve to no ${OWNER_SCOPE} name and would ` +
        `fail with "403 permission_denied" at npm publish:\n` +
        bad.map(({ dir, pkg }) => `  - ${pkg.name} (${dir})`).join('\n') +
        `\nGitHub Packages requires the published scope to equal the repository owner ` +
        `(${OWNER_SCOPE}). Add the scope to SCOPE_ALIASES in scripts/publish-packages.mjs ` +
        `(currently: ${known}), or mark the workspace "private": true if it is not meant to publish.`
    )
  }
  return targets
}

function workspaces() {
  return (readJson(`${root}/package.json`).workspaces ?? []).filter((w) => !w.includes('*'))
}

/** Publishable = a workspace that is not marked private. One source of truth. */
function publishable() {
  return assertAliasable(
    workspaces()
      .filter((dir) => existsSync(`${root}/${dir}/package.json`))
      .map((dir) => ({ dir, pkg: readJson(`${root}/${dir}/package.json`) }))
      .filter(({ pkg }) => !pkg.private && pkg.name)
  )
}

/**
 * Narrow the full publishable set down to `--only <name>`. Exported so the
 * test can assert the filter without touching the filesystem or npm.
 *
 * Throws rather than silently publishing everything if the name is wrong —
 * a typo'd `--only` in the matrix must fail loudly, not fall back to
 * publishing every package from what was meant to be one isolated leg.
 */
export function filterTargets(targets, only) {
  if (!only) return targets
  const matched = targets.filter(({ pkg }) => pkg.name === only)
  if (matched.length === 0) {
    throw new Error(`--only ${only}: no publishable workspace has that name`)
  }
  return matched
}

/**
 * Rewrite a manifest for publication: alias its own name, alias every in-family
 * dependency, and turn local specifiers into real version ranges.
 *
 * Exported so the tests can assert the transform without publishing anything.
 */
export function rewriteForPublish(pkg, versionByName) {
  const out = { ...pkg, name: aliasFor(pkg.name) }
  for (const field of DEP_FIELDS) {
    const deps = pkg[field]
    if (!deps) continue
    const rewritten = {}
    for (const [name, spec] of Object.entries(deps)) {
      const alias = aliasFor(name)
      if (alias === name && !LOCAL_PROTOCOL.test(spec)) {
        rewritten[name] = spec
        continue
      }
      if (LOCAL_PROTOCOL.test(spec)) {
        // `file:../../packages/identity` means nothing to a consumer. Pin the
        // target's actual version, or the published tarball is uninstallable.
        const version = versionByName[name]
        if (!version) {
          throw new Error(
            `${pkg.name}: ${field}.${name} uses a local specifier (${spec}) but ` +
              `${name} is not a publishable workspace — a consumer could never resolve it`
          )
        }
        rewritten[alias] = `^${version}`
      } else {
        rewritten[alias] = spec
      }
    }
    out[field] = rewritten
  }
  return out
}

function alreadyPublished(name, version) {
  try {
    execFileSync('npm', ['view', `${name}@${version}`, 'version', `--registry=${REGISTRY}`], {
      stdio: 'pipe',
    })
    return true
  } catch {
    return false
  }
}

// Only run the publish loop when invoked as a script. Importing this module
// (the tests do) must not publish anything.
const invokedDirectly = process.argv[1]?.endsWith('publish-packages.mjs') ?? false
if (!invokedDirectly) {
  // eslint-disable-next-line no-empty
} else {
main()
}

function main() {
const allTargets = publishable()

if (listJson) {
  // One name per publishable package, for packages-publish.yml's matrix.
  // Deliberately independent of --dry-run/--only: the matrix needs the full
  // list to build its legs, not a filtered view of one.
  console.log(JSON.stringify(allTargets.map(({ pkg }) => pkg.name)))
  return
}

if (listDirs) {
  // One workspace DIRECTORY per publishable package, newline-separated, for
  // auto-merge.yml's "did this merge touch anything publishable?" test.
  //
  // That test used to be a hand-maintained regex of publishable directories —
  // a second source of truth for a question this file already answers, and it
  // had already drifted twice (api-client/, sdk/ and config-client/ were all
  // missing, so their releases were invisible). It now builds its pattern from
  // this output, so adding a workspace can no longer silently fail to publish.
  for (const { dir } of allTargets) console.log(dir)
  return
}

// versionByName always comes from the FULL set, even under --only: a local
// dependency's version is needed for the rewrite whether or not that
// dependency is this leg's publish target (it may already be published).
const versionByName = Object.fromEntries(allTargets.map(({ pkg }) => [pkg.name, pkg.version]))
const targets = filterTargets(allTargets, only)

console.log(`publish-packages: ${targets.length} publishable package(s)${dryRun ? ' (dry run)' : ''}\n`)

const skipped = []
const published = []
const failed = []

for (const { dir, pkg } of targets) {
  const manifestPath = `${root}/${dir}/package.json`
  const original = readFileSync(manifestPath, 'utf8')
  let rewritten
  try {
    rewritten = rewriteForPublish(pkg, versionByName)
  } catch (err) {
    failed.push(`${pkg.name}: ${err.message}`)
    console.error(`  ✗ ${pkg.name} — ${err.message}`)
    continue
  }

  const target = `${rewritten.name}@${pkg.version}`

  if (dryRun) {
    const renamedDeps = DEP_FIELDS.flatMap((f) =>
      Object.keys(rewritten[f] ?? {}).filter((n) => !(pkg[f] ?? {})[n])
    )
    console.log(
      `  → ${pkg.name} -> ${target}` +
        (renamedDeps.length ? `  (deps rewritten: ${renamedDeps.join(', ')})` : '')
    )
    continue
  }

  if (alreadyPublished(rewritten.name, pkg.version)) {
    skipped.push(target)
    console.log(`  = ${target} already published — skipping`)
    continue
  }

  try {
    // Write the aliased manifest, publish, then ALWAYS restore. Leaving a
    // renamed manifest behind would break every workspace link in the job.
    writeFileSync(manifestPath, JSON.stringify(rewritten, null, 2) + '\n')
    execFileSync('npm', ['publish', `--registry=${REGISTRY}`], {
      cwd: `${root}/${dir}`,
      stdio: 'inherit',
    })
    published.push(target)
    console.log(`  ✓ ${target}`)
  } catch (err) {
    // The interim per-package publishers still run on the same push, so two
    // jobs can pass the existence check and then both publish. The loser gets a
    // 409. That is a race, not a fault — if the version is in the registry now,
    // the release succeeded and whose upload won does not matter.
    if (alreadyPublished(rewritten.name, pkg.version)) {
      skipped.push(target)
      console.log(`  = ${target} published concurrently by another job — treating as done`)
    } else {
      failed.push(`${target}: ${err.message}`)
      console.error(`  ✗ ${target} — ${err.message}`)
    }
  } finally {
    writeFileSync(manifestPath, original)
  }
}

if (!dryRun) {
  console.log(
    `\npublish-packages: ${published.length} published, ${skipped.length} skipped, ${failed.length} failed`
  )
}
if (failed.length) {
  console.error('\nFailures:')
  for (const f of failed) console.error(`  ✗ ${f}`)
  process.exit(1)
}
}
