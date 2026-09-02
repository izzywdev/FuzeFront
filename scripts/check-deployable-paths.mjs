#!/usr/bin/env node
// GATE: release.yml's `on.push.paths` must equal what deploy/deployable-paths.json renders,
// and every image the workflow builds must have its source dir covered by that manifest.
//
// Without this check the manifest would be a FOURTH copy of "what is deployable" rather
// than a replacement for the third. The mirror's failure mode is silent and inverted — a
// missing path produces NO release run at all, so the change merges green and never ships.
// There is nothing red to notice; that is why this has to be a required check and why it
// prints the drifted paths by name instead of just exiting non-zero.
//
// Dependency-free: runs on a bare `node`, no `npm ci`, no js-yaml. See
// scripts/deployable-paths.mjs for why a YAML parser is the wrong tool here (`on:` is a
// YAML 1.1 boolean, so parsers read the key as `true` and a parser-based gate passes
// vacuously — failing toward exactly the silent no-ship it was meant to catch).

import { readFileSync } from 'node:fs'
import {
  MANIFEST_PATH,
  WORKFLOW_PATH,
  readManifest,
  renderPathsBlock,
  extractPathsBlock,
  uncoveredBuildInputs,
} from './deployable-paths.mjs'

const root = process.cwd()
const fail = (msg) => {
  console.error(msg)
  process.exitCode = 1
}

let manifest
let source
try {
  manifest = readManifest(readFileSync(`${root}/${MANIFEST_PATH}`, 'utf8'))
  source = readFileSync(`${root}/${WORKFLOW_PATH}`, 'utf8')
} catch (err) {
  console.error(`✗ deployable-paths: ${err.message}`)
  process.exit(1)
}

let found
try {
  found = extractPathsBlock(source)
} catch (err) {
  console.error(`✗ deployable-paths: ${err.message}`)
  process.exit(1)
}

const rendered = renderPathsBlock(manifest)
const expected = manifest.paths.map((p) => p.path)
const actual = found.paths

if (rendered !== found.text) {
  const missing = expected.filter((p) => !actual.includes(p))
  const extra = actual.filter((p) => !expected.includes(p))

  console.error(
    `\n✗ deployable-paths: ${WORKFLOW_PATH} \`on.push.paths\` has DRIFTED from ${MANIFEST_PATH}.\n`
  )
  if (missing.length) {
    console.error(
      `  MISSING from the workflow (declared deployable, but a change confined to one of\n` +
        `  these would merge green and NEVER trigger a release — no run, no red, no ship):`
    )
    for (const p of missing) console.error(`    - ${p}`)
    console.error('')
  }
  if (extra.length) {
    console.error(
      `  PRESENT in the workflow but absent from the manifest (an undeclared deploy trigger —\n` +
        `  either add it to ${MANIFEST_PATH} with a \`why\`, or drop it from the workflow):`
    )
    for (const p of extra) console.error(`    - ${p}`)
    console.error('')
  }
  if (!missing.length && !extra.length) {
    // Same set, different bytes: order or the explanatory comments moved.
    const a = rendered.split('\n')
    const b = found.text.split('\n')
    console.error(
      `  The path SET matches but the rendered block does not (ordering or the explanatory\n` +
        `  comments differ). First differing lines:`
    )
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) {
        console.error(`    line ${found.startLine + i + 1}`)
        console.error(`      manifest renders: ${a[i] ?? '(end of block)'}`)
        console.error(`      workflow has:     ${b[i] ?? '(end of block)'}`)
        break
      }
    }
    console.error('')
  }
  console.error(
    `  FIX: edit ${MANIFEST_PATH} (the source of truth), then run\n` +
      `       npm run deployable-paths:write\n` +
      `  and commit the regenerated workflow. Do not hand-edit the block.\n`
  )
  process.exitCode = 1
}

let uncovered
try {
  uncovered = uncoveredBuildInputs(source, manifest)
} catch (err) {
  fail(`✗ deployable-paths: ${err.message}`)
  process.exit(1)
}

if (uncovered.length) {
  console.error(
    `\n✗ deployable-paths: ${WORKFLOW_PATH} builds images whose SOURCE DIRECTORY no declared\n` +
      `  path covers. A change confined to one of these dirs cannot trigger the very build\n` +
      `  step that consumes it — the step exists, but nothing can ever run it:\n`
  )
  for (const { dockerfile, dir } of uncovered) {
    console.error(`    ${dockerfile}  ->  add '${dir}**' to ${MANIFEST_PATH}`)
  }
  console.error(
    `\n  This is the #432 chat-service failure exactly: a build step landed without its\n` +
      `  trigger path, and every commit in between shipped nothing.\n`
  )
  process.exitCode = 1
}

if (process.exitCode) process.exit(process.exitCode)

console.log(
  `✓ deployable-paths: ${WORKFLOW_PATH} on.push.paths matches ${MANIFEST_PATH} ` +
    `(${actual.length} path(s)), and every Dockerfile it builds is covered.`
)
