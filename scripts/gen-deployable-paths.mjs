#!/usr/bin/env node
// Render release.yml's `on.push.paths` block from deploy/deployable-paths.json.
//
//   node scripts/gen-deployable-paths.mjs            # print the rendered block
//   node scripts/gen-deployable-paths.mjs --write    # rewrite the block in release.yml
//
// `--write` is the ONLY supported way to change that block. Hand-editing it makes
// gate-deployable-paths.yml red. See scripts/deployable-paths.mjs for why this mirror
// cannot be collapsed at runtime the way auto-merge.yml's was.

import { readFileSync, writeFileSync } from 'node:fs'
import {
  MANIFEST_PATH,
  WORKFLOW_PATH,
  readManifest,
  renderPathsBlock,
  extractPathsBlock,
} from './deployable-paths.mjs'

const write = process.argv.includes('--write')
const root = process.cwd()

const manifest = readManifest(readFileSync(`${root}/${MANIFEST_PATH}`, 'utf8'))
const rendered = renderPathsBlock(manifest)

if (!write) {
  console.log(rendered)
  process.exit(0)
}

const source = readFileSync(`${root}/${WORKFLOW_PATH}`, 'utf8')
const block = extractPathsBlock(source)

// Preserve the file's own line ending rather than forcing LF — gate-line-endings.yml
// governs that, and this script must not fight it or silently reformat the whole file.
const eol = source.includes('\r\n') ? '\r\n' : '\n'
const lines = source.split(/\r?\n/)
const next = [
  ...lines.slice(0, block.startLine),
  ...rendered.split('\n'),
  ...lines.slice(block.endLine),
].join(eol)

if (next === source) {
  console.log(`${WORKFLOW_PATH}: already in sync with ${MANIFEST_PATH} (${block.paths.length} paths)`)
  process.exit(0)
}

writeFileSync(`${root}/${WORKFLOW_PATH}`, next)
console.log(
  `${WORKFLOW_PATH}: rewrote on.push.paths from ${MANIFEST_PATH} ` +
    `(${manifest.paths.length} path(s)). Commit the workflow with the manifest change.`
)
