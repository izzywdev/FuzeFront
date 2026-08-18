#!/usr/bin/env node
// gate-toolchain (#646): enforces the Node 24 / React 19 toolchain floor
// documented in CLAUDE.md's "Toolchain baseline" table. Nothing enforced this
// before — the table "survived on review alone", and a sweep of sibling repos
// found Dockerfiles on node:18/20-alpine that no CI job had ever looked at.
//
// Checks, per CLAUDE.md's table:
//   - .nvmrc == 24
//   - engines.node >=24.0.0 / engines.npm >=10.0.0 in every package.json
//   - @types/node ^24.13.3 in every TypeScript package.json (has a
//     "typescript" devDependency or any other @types/* dependency)
//   - react/react-dom app `dependencies` >=19.2.0
//   - @types/react / @types/react-dom >=19.2.0 where declared
//   - peerDependencies react/react-dom >=19.0.0 (and does not admit 18) where
//     a package already declares a React peer
//   - Module-Federation `shared.react(-dom).requiredVersion` — every
//     federation config found must read '^19.0.0', AND the host
//     (frontend/vite.config.ts) must match every remote found in-repo. A
//     silent mismatch here is the dangerous half of this gate: the remote
//     loads its own React copy and dies on "Invalid hook call" at runtime,
//     in the browser, with nothing else in CI to catch it.
//   - FROM node: base image major in every Dockerfile
//   - node-version: in every GitHub Actions workflow
//
// Deliberately excluded (frozen historical records, not governance):
//   docs/superpowers/plans/**, sdd/**, docs/chats/**
//
// Dependency-free. Run from the repo root: `node scripts/gate-toolchain.mjs`.

import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname } from 'node:path'

const root = process.cwd()
const violations = []

const EXCLUDED_DIR_RE = /^(docs\/superpowers\/plans|sdd|docs\/chats)\//

function trackedFiles(pattern) {
  return execFileSync('git', ['ls-files', pattern], { encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((f) => !/(^|\/)node_modules\//.test(f) && !/(^|\/)dist\//.test(f))
    .filter((f) => !EXCLUDED_DIR_RE.test(f))
}

function readText(file) {
  return readFileSync(`${root}/${file}`, 'utf8')
}

function readJson(file) {
  try {
    return JSON.parse(readText(file))
  } catch {
    return null
  }
}

// Extracts the leading major version number from a semver-ish range string,
// e.g. "^24.13.3" -> 24, ">=24.0.0" -> 24, "^18.0.0 || ^19.0.0" -> 18 (the
// LOWEST admitted major — that's the one that matters for "does this still
// admit an old major").
function admittedMajors(range) {
  return [...String(range).matchAll(/(\d+)\.\d+\.\d+/g)].map((m) => Number(m[1]))
}

function minMajor(range) {
  const majors = admittedMajors(range)
  return majors.length ? Math.min(...majors) : null
}

// ── .nvmrc ───────────────────────────────────────────────────────────────────
{
  let nvmrc
  try {
    nvmrc = readText('.nvmrc').trim()
  } catch {
    violations.push('.nvmrc is missing at the repo root (expected "24")')
    nvmrc = null
  }
  if (nvmrc !== null && nvmrc !== '24') {
    violations.push(`.nvmrc is "${nvmrc}", expected "24"`)
  }
}

// ── package.json: engines, @types/node, react/react-dom, @types/react(-dom), peerDependencies ──
const pkgFiles = trackedFiles('*package.json')
for (const f of pkgFiles) {
  const p = readJson(f)
  if (!p) continue

  const engNode = p.engines?.node
  if (!engNode) {
    violations.push(`${f}: missing engines.node (expected ">=24.0.0")`)
  } else if ((minMajor(engNode) ?? 0) < 24) {
    violations.push(`${f}: engines.node "${engNode}" admits a Node major below 24`)
  }
  const engNpm = p.engines?.npm
  if (!engNpm) {
    violations.push(`${f}: missing engines.npm (expected ">=10.0.0")`)
  } else if ((minMajor(engNpm) ?? 0) < 10) {
    violations.push(`${f}: engines.npm "${engNpm}" admits an npm major below 10`)
  }

  const dev = p.devDependencies ?? {}
  const isTypeScriptPackage =
    'typescript' in dev || Object.keys(dev).some((k) => k.startsWith('@types/'))
  if (isTypeScriptPackage) {
    const typesNode = dev['@types/node']
    if (!typesNode) {
      violations.push(`${f}: TypeScript package missing devDependencies["@types/node"] (expected "^24.13.3")`)
    } else if ((minMajor(typesNode) ?? 0) < 24) {
      violations.push(`${f}: @types/node "${typesNode}" admits a major below 24`)
    }

    for (const typesPkg of ['@types/react', '@types/react-dom']) {
      const spec = dev[typesPkg]
      if (!spec) continue // not every TS package uses React types — only check when declared
      const major = minMajor(spec)
      if (major === null || major < 19 || (major === 19 && !/19\.[2-9]/.test(spec))) {
        violations.push(`${f}: ${typesPkg} "${spec}" is below the ^19.2.0 floor`)
      }
    }
  }

  const deps = p.dependencies ?? {}
  for (const reactPkg of ['react', 'react-dom']) {
    const spec = deps[reactPkg]
    if (!spec) continue
    const major = minMajor(spec)
    if (major === null || major < 19 || (major === 19 && !/19\.[2-9]/.test(spec))) {
      violations.push(`${f}: dependencies["${reactPkg}"] "${spec}" is below the ^19.2.0 floor`)
    }
  }

  const peer = p.peerDependencies ?? {}
  for (const reactPkg of ['react', 'react-dom']) {
    const spec = peer[reactPkg]
    if (!spec) continue // only packages that already declare a React peer are checked
    if ((minMajor(spec) ?? 99) < 19) {
      violations.push(
        `${f}: peerDependencies["${reactPkg}"] "${spec}" still admits a pre-19 React major — published @fuzefront/* packages must require ^19.0.0`
      )
    }
  }
}

// ── Dockerfiles ──────────────────────────────────────────────────────────────
const dockerFiles = trackedFiles('*Dockerfile*').filter((f) => !/\.dockerignore$/.test(f))
for (const f of dockerFiles) {
  let text
  try {
    text = readText(f)
  } catch {
    continue
  }
  for (const m of text.matchAll(/^FROM\s+node:(\S+)/gim)) {
    const tag = m[1]
    const majorMatch = tag.match(/^(\d+)/)
    const major = majorMatch ? Number(majorMatch[1]) : null
    if (major === null || major < 24) {
      violations.push(`${f}: FROM node:${tag} is below the node:24 floor`)
    }
  }
}

// ── GitHub Actions workflows: node-version ───────────────────────────────────
const workflowFiles = trackedFiles('.github/workflows/*.yml').concat(trackedFiles('.github/workflows/*.yaml'))
for (const f of workflowFiles) {
  let text
  try {
    text = readText(f)
  } catch {
    continue
  }
  for (const m of text.matchAll(/node-version:\s*['"]?(\d+)/g)) {
    const major = Number(m[1])
    if (major < 24) {
      violations.push(`${f}: node-version '${major}.x' is below the 24.x floor`)
    }
  }
}

// ── Module Federation shared.react(-dom).requiredVersion ────────────────────
const federationConfigs = trackedFiles('*vite.config.ts').concat(trackedFiles('*webpack.config.js'))
const foundRequiredVersions = [] // { file, react, reactDom }
for (const f of federationConfigs) {
  let text
  try {
    text = readText(f)
  } catch {
    continue
  }
  if (!/@originjs\/vite-plugin-federation|ModuleFederationPlugin/.test(text)) continue
  if (!/shared\s*:/.test(text)) continue

  // Find requiredVersion for the react and react-dom entries specifically —
  // scan each shared-block entry's local text window rather than a single
  // global regex, since react and react-dom are separate keys.
  const reactMatch = text.match(/(['"]?)react\1\s*:\s*\{[^}]*requiredVersion:\s*['"]([^'"]+)['"]/)
  const reactDomMatch = text.match(/(['"]?)react-dom\1\s*:\s*\{[^}]*requiredVersion:\s*['"]([^'"]+)['"]/)
  if (!reactMatch && !reactDomMatch) continue // shared block doesn't cover react — not this repo's MF contract

  const react = reactMatch?.[2] ?? null
  const reactDom = reactDomMatch?.[2] ?? null
  foundRequiredVersions.push({ file: f, react, reactDom })

  for (const [label, spec] of [['react', react], ['react-dom', reactDom]]) {
    if (spec === null) {
      violations.push(`${f}: shared.${label} declared but has no requiredVersion`)
    } else if (spec !== '^19.0.0') {
      violations.push(`${f}: shared.${label}.requiredVersion is "${spec}", expected "^19.0.0"`)
    }
  }
}
if (foundRequiredVersions.length > 1) {
  const first = foundRequiredVersions[0]
  for (const other of foundRequiredVersions.slice(1)) {
    if (other.react !== first.react || other.reactDom !== first.reactDom) {
      violations.push(
        `Module-Federation requiredVersion MISMATCH: ${first.file} (react=${first.react}, react-dom=${first.reactDom}) ` +
          `!= ${other.file} (react=${other.react}, react-dom=${other.reactDom}) — a remote whose requiredVersion ` +
          `differs from the host silently loads its own React copy and dies on "Invalid hook call" at runtime`
      )
    }
  }
}

// ── Report ────────────────────────────────────────────────────────────────────
if (violations.length) {
  console.error(`\n✗ gate-toolchain FAILED — ${violations.length} violation(s) of the Node 24 / React 19 floor:\n`)
  for (const v of violations) console.error('  - ' + v)
  console.error('\nSee CLAUDE.md "Toolchain baseline" for the mandated floor. Raising it is fine;')
  console.error('lowering it is a breaking change to the family and must move the host, both')
  console.error('in-repo remotes, every published peer range, and every consumer together.\n')
  process.exit(1)
}

console.log(
  `✓ gate-toolchain passed (${pkgFiles.length} package.json, ${dockerFiles.length} Dockerfile(s), ` +
    `${workflowFiles.length} workflow(s), ${federationConfigs.length} federation config(s) scanned).`
)
