#!/usr/bin/env node
// gate-toolchain (#646): enforces the Node 24 / React 19 toolchain floor
// documented in CLAUDE.md's "Toolchain baseline" table. Nothing enforced this
// before — the table "survived on review alone", and a sweep of sibling repos
// found Dockerfiles on node:18/20-alpine that no CI job had ever looked at.
//
// Checks, per CLAUDE.md's table:
//   - .nvmrc == 24
//   - no package.json declares the same top-level key twice (#755). JSON.parse
//     silently keeps the LAST occurrence of a duplicate key, which is exactly
//     why a duplicated `engines` block was invisible to this gate for months —
//     it parsed to one well-formed value and every check below passed. Other
//     parsers take the FIRST occurrence, or reject outright; npm normalises to
//     one, silently discarding the other. Checked at the raw-text level,
//     BEFORE any JSON.parse-based check, and for every top-level key, not just
//     `engines` — any duplicated top-level key is a latent version of this bug.
//   - engines.node >=24.0.0 / engines.npm >=10.0.0 in every package.json
//   - @types/node ^24.13.3 in every TypeScript package.json (has a
//     "typescript" devDependency or any other @types/* dependency)
//   - react/react-dom app `dependencies` >=19.2.0
//   - @types/react / @types/react-dom >=19.2.0 where declared
//   - peerDependencies react/react-dom >=19.0.0 (and does not admit 18) where
//     a package already declares a React peer
//   - Module-Federation `shared.react(-dom)` — every federation config found
//     must use the explicit object form (the bare-array shorthand is rejected:
//     it requests no singleton semantics), must carry `singleton: true`, must
//     read requiredVersion '^19.0.0', AND the host
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

// Tokenizes JSON text into an array of meaningful tokens (strings, structural
// punctuation, and literal/number tokens), dropping whitespace. Not a full
// JSON parser — it doesn't validate — but sufficient to walk brace/bracket
// nesting and recover object keys at any depth, including the raw text of
// duplicate keys that JSON.parse would silently collapse.
function tokenizeJson(text) {
  const tokenRe =
    /"(?:\\.|[^"\\])*"|[{}[\]:,]|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\s+/g
  const tokens = []
  let m
  while ((m = tokenRe.exec(text)) !== null) {
    if (!/^\s+$/.test(m[0])) tokens.push(m[0])
  }
  return tokens
}

// Finds top-level (root-object) keys declared more than once, at the raw-text
// level — independent of JSON.parse, which silently keeps only the last
// occurrence and so can never observe this. Returns [key, count][] for every
// duplicated key, in first-seen order.
function findDuplicateTopLevelKeys(text) {
  const tokens = tokenizeJson(text)
  const counts = new Map()
  const order = []
  const stack = [] // 'obj' | 'arr', one entry per open {/[ currently unclosed
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t === '{') {
      stack.push('obj')
      continue
    }
    if (t === '[') {
      stack.push('arr')
      continue
    }
    if (t === '}' || t === ']') {
      stack.pop()
      continue
    }
    // A string immediately followed by ':' is an object key (the only place
    // ':' occurs in JSON). Only keys of the ROOT object matter here — depth 1,
    // and that frame must be an object (an array can't have been what a
    // top-level string-then-colon is inside, but guard anyway for safety).
    if (t[0] === '"' && tokens[i + 1] === ':' && stack.length === 1 && stack[0] === 'obj') {
      let key
      try {
        key = JSON.parse(t)
      } catch {
        continue
      }
      if (!counts.has(key)) order.push(key)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  return order.filter((k) => counts.get(k) > 1).map((k) => [k, counts.get(k)])
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
  // Raw-text duplicate-key check FIRST, independent of JSON.parse — see #755.
  let rawText
  try {
    rawText = readText(f)
  } catch {
    rawText = null
  }
  if (rawText !== null) {
    for (const [key, count] of findDuplicateTopLevelKeys(rawText)) {
      violations.push(
        `${f}: top-level key "${key}" is declared ${count} times — JSON.parse silently keeps the last ` +
          `occurrence (other parsers take the first, or reject; npm normalises and discards one), so this is ` +
          `invisible to every check below it. Collapse to a single "${key}" block.`
      )
    }
  }

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

  // The BARE-ARRAY shorthand — `shared: ['react', 'react-dom']` — requests no
  // singleton semantics at all, so version agreement is not even the question:
  // the remote can load its own React copy regardless of what any version
  // string says. It has to be caught structurally, because it presents as an
  // ABSENCE (no requiredVersion to compare) rather than as a wrong value — the
  // requiredVersion scan below finds nothing and would otherwise skip the file
  // as "not part of this repo's MF contract". See #658 Group B, where four
  // sibling repos adopted this form after a real constraint (never list
  // `@fuzefront/*` in `shared`, it hits ENOTDIR on source-aliased paths) was
  // over-generalised into "shared must be a bare array". The object form is
  // compatible with that constraint; the host proves it.
  const bareArrayShared = text.match(/shared\s*:\s*\[([^\]]*)\]/)
  if (bareArrayShared && /['"]react(-dom)?['"]/.test(bareArrayShared[1])) {
    violations.push(
      `${f}: shared uses the bare-array shorthand (shared: [${bareArrayShared[1].trim()}]) — it never requests ` +
        `singleton semantics, so the remote may load its own React copy and die on "Invalid hook call" at runtime. ` +
        `Use the explicit object form: { react: { singleton: true, requiredVersion: '^19.0.0' }, ... }`
    )
    continue
  }

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

  // `singleton: true` is the half that actually forces one React instance —
  // a matching requiredVersion without it still permits a second copy. Checked
  // separately from the version so a config that drops ONLY the singleton flag
  // cannot pass: that exact regression reached master during #647, where a
  // remote's shared block briefly lost `singleton: true` alongside its version
  // revert, and only the version half was detectable at the time.
  for (const [label, pattern] of [
    ['react', /(['"]?)react\1\s*:\s*\{[^}]*singleton:\s*true/],
    ['react-dom', /(['"]?)react-dom\1\s*:\s*\{[^}]*singleton:\s*true/],
  ]) {
    const declared = label === 'react' ? reactMatch : reactDomMatch
    if (declared && !pattern.test(text)) {
      violations.push(
        `${f}: shared.${label} is missing "singleton: true" — requiredVersion alone does not force a single ` +
          `React instance across the federation boundary; the remote can still load its own copy`
      )
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
