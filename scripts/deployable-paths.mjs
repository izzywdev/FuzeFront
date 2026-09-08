#!/usr/bin/env node
// Library for the deployable-paths manifest -> release.yml `on.push.paths` mirror.
//
// THE PROBLEM THIS CLOSES.
// "What is deployable" lived in three hand-maintained places that drift apart:
//   1. root package.json `workspaces`  - the real source, read by publish-packages.mjs.
//   2. auto-merge.yml's regex mirror   - COLLAPSED: it now shells out to
//      `node scripts/publish-packages.mjs --list-dirs` at runtime.
//   3. release.yml's `on.push.paths`   - this one. Still a mirror, because it CANNOT
//      be collapsed the way (2) was: GitHub evaluates the trigger block before any
//      step of the workflow runs, so it must be static YAML in the file.
//
// So the mirror stays, but it stops being hand-maintained: deploy/deployable-paths.json
// is the source, this module renders the block, and check-deployable-paths.mjs fails CI
// when the committed block and the rendered block disagree.
//
// WHY THE GATE IS THE POINT.
// A missing path here does not produce a red run — it produces NO run. The change
// merges green and never ships, and the image silently keeps the old code. Five
// services (chat, notification, payment, selection-list, config) each shipped a
// `docker/build-push-action` step in release.yml whose own source dir was absent from
// the trigger. Without the gate, adding a manifest would just create a FOURTH copy of
// the same truth.
//
// WHY NO YAML PARSER (deliberate, same rule as check-required-check-triggers.mjs).
// `on` is one of YAML 1.1's boolean literals, so many parsers read the `on:` key as
// the boolean `true` — the well-known GitHub Actions footgun. A parser-based gate that
// hits it finds no `on` key, concludes "no deployable paths", and passes vacuously:
// it fails toward exactly the silent no-ship this file exists to prevent. A line-based
// indentation scan cannot make that mistake, and it also lets the block keep its
// explanatory comments (a parser would discard them, so they could rot unnoticed).
// Every failure mode below is an explicit throw, never a silent empty result.

import { readFileSync } from 'node:fs'

export const MANIFEST_PATH = 'deploy/deployable-paths.json'
export const WORKFLOW_PATH = '.github/workflows/release.yml'

/** Indentation the `paths:` list items sit at inside `on: / push: / paths:`. */
const ITEM_INDENT = '      '

export function readManifest(text) {
  const manifest = JSON.parse(text)
  const entries = manifest.paths
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error(
      `${MANIFEST_PATH} declares no \`paths\` — rendering it would empty release.yml's ` +
        `trigger and silently stop every deploy. Refusing.`
    )
  }
  const seen = new Set()
  for (const entry of entries) {
    if (!entry || typeof entry.path !== 'string' || !entry.path.trim()) {
      throw new Error(`${MANIFEST_PATH}: every \`paths\` entry needs a non-empty string \`path\``)
    }
    if (entry.path.includes("'")) {
      throw new Error(
        `${MANIFEST_PATH}: path ${entry.path} contains a single quote; the renderer emits ` +
          `single-quoted YAML scalars and cannot represent it`
      )
    }
    if (seen.has(entry.path)) {
      throw new Error(`${MANIFEST_PATH}: duplicate path ${entry.path}`)
    }
    seen.add(entry.path)
    if (entry.why !== undefined && !Array.isArray(entry.why)) {
      throw new Error(`${MANIFEST_PATH}: \`why\` for ${entry.path} must be an array of comment lines`)
    }
  }
  return manifest
}

/**
 * Render the manifest as the exact body of release.yml's `on.push.paths` list —
 * comment lines and entries, at the workflow's own indentation, no trailing newline.
 */
export function renderPathsBlock(manifest) {
  const out = []
  // `header` renders as the block's first comment lines. It is INSIDE the compared
  // region on purpose: a "do not hand-edit" notice that the gate does not enforce is a
  // notice that can be deleted by the same edit it was meant to stop.
  for (const line of manifest.header ?? []) {
    out.push(line === '' ? `${ITEM_INDENT}#` : `${ITEM_INDENT}# ${line}`)
  }
  for (const entry of manifest.paths) {
    for (const line of entry.why ?? []) {
      out.push(line === '' ? `${ITEM_INDENT}#` : `${ITEM_INDENT}# ${line}`)
    }
    out.push(`${ITEM_INDENT}- '${entry.path}'`)
  }
  return out.join('\n')
}

const indentOf = (line) => line.match(/^[ \t]*/)[0].length

/**
 * Locate `on: / push: / paths:` by indentation scan and return
 * `{ startLine, endLine, text, paths }` (line numbers 0-based, `endLine` exclusive).
 *
 * Throws — loudly and specifically — on every shape it does not recognise. An
 * "I could not find it" that returned an empty result would pass the gate while the
 * workflow was broken, which is the failure this whole mechanism is against.
 */
export function extractPathsBlock(source) {
  // EOL-agnostic: git stores this file with LF (gate-line-endings.yml enforces it) but a
  // Windows checkout with core.autocrlf materialises CRLF. Comparing raw bytes would then
  // report drift on every path, on a working tree that is byte-identical in git.
  const lines = source.split(/\r?\n/)

  const onLines = []
  for (let i = 0; i < lines.length; i++) {
    if (/^on:\s*(#.*)?$/.test(lines[i])) onLines.push(i)
  }
  if (onLines.length !== 1) {
    throw new Error(
      `${WORKFLOW_PATH}: expected exactly one top-level \`on:\` line, found ${onLines.length}. ` +
        `Cannot locate the deployable-paths block; refusing to pass.`
    )
  }

  // Walk the `on:` mapping. It ends at the first non-blank line at indent 0.
  const onEnd = (() => {
    for (let i = onLines[0] + 1; i < lines.length; i++) {
      const line = lines[i]
      if (!line.trim()) continue
      if (indentOf(line) === 0) return i
    }
    return lines.length
  })()

  const findKey = (from, to, indent, key) => {
    const re = new RegExp(`^ {${indent}}${key}:\\s*(#.*)?$`)
    for (let i = from; i < to; i++) {
      if (re.test(lines[i])) return i
    }
    return -1
  }

  const pushLine = findKey(onLines[0] + 1, onEnd, 2, 'push')
  if (pushLine === -1) {
    throw new Error(
      `${WORKFLOW_PATH}: no \`push:\` trigger under \`on:\`. Without it the release workflow ` +
        `never runs on a merge to master and nothing ships.`
    )
  }

  // The `push:` mapping ends at the first non-blank line indented <= 2.
  const pushEnd = (() => {
    for (let i = pushLine + 1; i < onEnd; i++) {
      const line = lines[i]
      if (!line.trim()) continue
      if (indentOf(line) <= 2) return i
    }
    return onEnd
  })()

  const pathsLine = findKey(pushLine + 1, pushEnd, 4, 'paths')
  if (pathsLine === -1) {
    throw new Error(
      `${WORKFLOW_PATH}: \`on.push\` has no \`paths:\` key. Either the block was deleted ` +
        `(every push to master would now build) or it was renamed; both need a human.`
    )
  }
  if (findKey(pushLine + 1, pushEnd, 4, 'paths-ignore') !== -1) {
    throw new Error(
      `${WORKFLOW_PATH}: \`on.push\` uses BOTH \`paths\` and \`paths-ignore\`. This gate only ` +
        `governs \`paths\`; remove \`paths-ignore\` or teach the gate about it.`
    )
  }

  let end = pathsLine + 1
  while (end < pushEnd && lines[end].startsWith(ITEM_INDENT) && lines[end].trim()) end++

  const body = lines.slice(pathsLine + 1, end)
  const paths = []
  for (const line of body) {
    const m = /^ {6}- '(.+)'\s*$/.exec(line)
    if (m) paths.push(m[1])
    else if (!/^ {6}#/.test(line)) {
      throw new Error(
        `${WORKFLOW_PATH}: unrecognised line inside \`on.push.paths\`:\n  ${line}\n` +
          `The gate renders entries as \`      - 'glob'\` and comments as \`      # ...\`. ` +
          `Run \`npm run deployable-paths:write\` instead of editing this block by hand.`
      )
    }
  }
  if (paths.length === 0) {
    throw new Error(
      `${WORKFLOW_PATH}: \`on.push.paths\` resolved to NO deployable paths. A release ` +
        `workflow with an empty paths list never triggers — every merge would merge green ` +
        `and ship nothing. This is the exact silent failure the gate exists to catch.`
    )
  }

  return { startLine: pathsLine + 1, endLine: end, text: body.join('\n'), paths }
}

/** True when the manifest glob `glob` covers the repo-relative file `file`. */
export function globCovers(glob, file) {
  if (glob.endsWith('/**')) return file.startsWith(glob.slice(0, -2))
  if (glob === file) return true
  return false
}

/**
 * Every image release.yml actually builds must have its build context covered.
 *
 * This is the half a round-trip comparison cannot see. Rendering only proves the
 * workflow matches the manifest; it does NOT notice a NEW `docker/build-push-action`
 * step whose source dir nobody added to either. That is precisely how chat-service
 * got a build step it could not trigger (#432), and how notification-service,
 * payment-service, selection-list-service and config-service followed it.
 */
export function uncoveredBuildInputs(source, manifest) {
  const globs = manifest.paths.map((p) => p.path)
  const dockerfiles = [...source.matchAll(/^\s*file:\s*(\S+Dockerfile\S*)\s*$/gm)].map((m) => m[1])
  if (dockerfiles.length === 0) {
    throw new Error(
      `${WORKFLOW_PATH}: found no \`file: …Dockerfile\` build steps. Either the workflow no ` +
        `longer builds images, or this gate's step-detection broke — a gate that silently ` +
        `checks nothing is worse than no gate.`
    )
  }
  const missing = []
  for (const df of [...new Set(dockerfiles)]) {
    const dir = df.includes('/') ? df.slice(0, df.lastIndexOf('/') + 1) : ''
    // A root Dockerfile has no owning dir to require; everything else must be covered.
    if (dir === '') continue
    if (!globs.some((g) => globCovers(g, df))) missing.push({ dockerfile: df, dir })
  }
  return missing
}

export function loadRepoState(root = process.cwd()) {
  const manifest = readManifest(readFileSync(`${root}/${MANIFEST_PATH}`, 'utf8'))
  const source = readFileSync(`${root}/${WORKFLOW_PATH}`, 'utf8')
  return { manifest, source }
}
