#!/usr/bin/env node
// Enforce reproducible, lockfile-honouring installs in every Dockerfile (FFRNT-254).
//
// Two rules, and the second is the one that keeps biting.
//
// R1 — no Dockerfile may BYPASS the lockfile (`rm package-lock.json`,
//      `--no-package-lock`, or a bare `npm install` in a root-context image).
//      Bypassing re-resolves every floating range against the live registry on
//      each build, so two builds of the SAME COMMIT can ship different
//      dependency trees, and a registry hiccup fails the build outright. That
//      is not hypothetical: it broke PR #524's scan when
//      @typescript-eslint/utils@8.66.0 was briefly unresolvable mid-propagation,
//      and release.yml builds these same files on master push — where master is
//      deploy-on-push.
//
// R2 — a root-context Dockerfile must COPY *every* workspace manifest named by
//      the root package.json "workspaces" array before installing. npm hoists
//      against the full manifest set; with a subset present it computes a
//      DIFFERENT tree than the lockfile describes and silently drops packages.
//      This repo has now been bitten twice by exactly that: express-rate-limit
//      vanished from the applications image (crash at boot: "Cannot find module
//      'express-rate-limit'"), and @izzywdev/fuzefront-identity was missing from
//      the same image the moment packages/identity became a workspace — nothing
//      noticed, because the install still exits 0. A missing manifest is not a
//      build error, it is a runtime crash days later.
//
// R3 — if a production stage COPYs a local `file:`-linked package's dist/, and
//      that package declares RUNTIME dependencies, it must COPY that package's
//      node_modules too. A `file:` dep is installed as a SYMLINK: the consuming
//      service's lockfile carries only a link entry
//      ({"resolved":"../../packages/x","link":true}) and NO entry for the
//      target's own dependencies, so `npm ci` installs none of them. The image
//      then builds clean, the symlink resolves, dist/ is present — and the pod
//      dies at module load. config-service shipped exactly this: packages/auth
//      requires `jose`, nothing copied packages/auth/node_modules, and the very
//      first prod rollout crash-looped on "Cannot find module 'jose'".
//      This is the static half of the gap image-reproducibility.yml names in its
//      own header: "static checks cannot prove an image runs". This particular
//      failure IS statically visible, so it should never reach a cluster again.
//
// Dependency-free. Run from the repo root: `node scripts/check-dockerfile-lockfile.mjs`.

import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const root = process.cwd()

/** Dockerfiles that legitimately do not install from the root lockfile. */
const EXEMPT = new Set([
  // Add a path here only with a reason, and prefer fixing the Dockerfile.
  //
  // billing-service: FFRNT-254 converted every other image to `npm ci`; this one
  // resisted four attempts across CI, each revealing a different npm hoisting
  // behaviour. `stripe` does not hoist to the root tree here — it is pinned
  // inside the member — and it lands in a different place depending on whether
  // devDependencies are installed and on which workspace source directories are
  // present in the image. `cd <member> && npm install` is what the working image
  // does today.
  //
  // Exempted rather than guessed at again: there is no Docker daemon in the dev
  // environment, so every attempt cost a full CI round and the third one passed
  // only on a stale layer cache — a false green that made the ordering theory
  // look correct when it was not. Converting this file needs someone who can
  // build it locally and inspect the resulting node_modules. Tracked as a
  // follow-up on FFRNT-254; the reproducibility risk is real but it is one
  // service, and shipping a broken payments image to fix it is not a trade.
  'services/billing-service/Dockerfile',
  //
  // backend, backend/security, frontend: converted to `npm ci`, and the e2e
  // stack — which builds exactly these three (docker-compose.e2e.yml) — went red
  // while it is green on master. The images build and start; the sign-in flow
  // fails downstream. The most likely mechanism is the same one billing-service
  // demonstrated: an unscoped root install changes which packages hoist and how
  // large the images get, and these three are the auth-critical path.
  //
  // Reverted rather than iterated. Same reasoning as billing-service above: no
  // Docker daemon here, a full CI round per attempt, and a stale layer cache has
  // already produced one false green in this PR. Converting these needs someone
  // who can bring the e2e stack up locally. Tracked as a follow-up on FFRNT-254.
  'backend/Dockerfile',
  'backend/security/Dockerfile',
  'frontend/Dockerfile',
])

function tracked(pattern) {
  try {
    return execFileSync('git', ['ls-files', pattern], { cwd: root, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
  } catch {
    return []
  }
}

function workspaces() {
  const pkg = JSON.parse(readFileSync(`${root}/package.json`, 'utf8'))
  return (pkg.workspaces ?? []).filter((w) => !w.includes('*'))
}

const dockerfiles = [...tracked('*Dockerfile'), ...tracked('**/Dockerfile*')]
  .filter((f) => !f.includes('node_modules'))
  .filter((f) => !EXEMPT.has(f))
  .filter((v, i, a) => a.indexOf(v) === i)
  .sort()

const violations = []

for (const file of dockerfiles) {
  const text = readFileSync(`${root}/${file}`, 'utf8')
  // Strip comments — they discuss the very patterns we grep for.
  const code = text
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n')

  // R1 — explicit lockfile bypasses.
  if (/rm\s+(-f\s+)?[^\n]*package-lock\.json/.test(code)) {
    violations.push(`${file} — deletes package-lock.json; install from the lockfile instead`)
  }
  if (/--no-package-lock/.test(code)) {
    violations.push(`${file} — uses --no-package-lock; install from the lockfile instead`)
  }

  const installsAtRoot = /COPY\s+package\.json\s+package-lock\.json/.test(code)
  const usesNpmInstall = /\bnpm\s+install\b/.test(code)
  const usesNpmCi = /\bnpm\s+ci\b/.test(code)

  // R1 — a root-context image must use `npm ci`, which installs the lockfile
  // exactly and fails loudly when lock and manifests drift.
  if (installsAtRoot && usesNpmInstall && !usesNpmCi) {
    violations.push(`${file} — uses 'npm install' against the root lockfile; use 'npm ci'`)
  }

  // R2 — full manifest set before a root install.
  if (installsAtRoot && usesNpmCi) {
    const missing = workspaces().filter(
      (ws) => existsSync(`${root}/${ws}/package.json`) && !code.includes(`COPY ${ws}/package.json`)
    )
    if (missing.length) {
      violations.push(
        `${file} — installs at the root but does not COPY ${missing.length} workspace ` +
          `manifest(s): ${missing.join(', ')}. npm hoists against the full set; with any ` +
          `missing it computes a different tree than the lockfile and drops packages silently.`
      )
    }
  }

  // R3 — a file:-linked package's runtime deps must reach the production image.
  const distCopies = [...code.matchAll(/COPY\s+--from=\S+\s+\S*packages\/([A-Za-z0-9._-]+)\/dist\b/g)]
  for (const m of distCopies) {
    const pkg = m[1]
    const manifestPath = `${root}/packages/${pkg}/package.json`
    if (!existsSync(manifestPath)) continue
    let deps
    try {
      deps = JSON.parse(readFileSync(manifestPath, 'utf8')).dependencies || {}
    } catch {
      continue
    }
    const names = Object.keys(deps)
    if (!names.length) continue
    const copiesModules = new RegExp(`COPY\\s+--from=\\S+\\s+\\S*packages/${pkg}/node_modules\\b`).test(code)
    if (!copiesModules) {
      violations.push(
        `${file} — COPYs packages/${pkg}/dist into the production stage but not ` +
          `packages/${pkg}/node_modules, and packages/${pkg} declares runtime ` +
          `dependencies (${names.join(', ')}). A file: dep is a symlink; the consuming ` +
          `lockfile has no entry for these, so npm ci installs none of them. The image ` +
          `builds clean and the pod dies at module load ("Cannot find module '${names[0]}'").`
      )
    }
  }
}

if (violations.length) {
  console.error(`\ncheck-dockerfile-lockfile: ${violations.length} violation(s)\n`)
  for (const v of violations) console.error(`  ✗ ${v}`)
  console.error('\nSee FFRNT-254. Every image must build the same tree from the same commit.\n')
  process.exit(1)
}

console.log(`check-dockerfile-lockfile: OK (${dockerfiles.length} Dockerfile(s))`)
