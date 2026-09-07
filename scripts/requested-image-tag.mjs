#!/usr/bin/env node
/**
 * Prints the image tag that `values-prod.yaml` REQUESTS for a given service.
 *
 * This is the "asked for" half of the deploy-drift comparison in
 * check-portal-federation-health.mjs; the pod's own X-Fuze-Build header is the
 * "actually running" half. They are deliberately read from different places:
 * agreeing with itself is exactly what a stalled rollout does.
 *
 * A SCRIPT, not an inline step, for the reason the repo already extracts its
 * gates: logic in workflow YAML cannot be unit-tested, and a value-extractor
 * that silently returns empty is indistinguishable from one that returns the
 * right answer — the failure mode is a check that quietly stops checking.
 *
 * Prints nothing and exits 1 when the key cannot be found, so the caller can
 * tell "no tag" apart from "tag is the empty string" and say so.
 *
 * NOT a YAML parser, deliberately: PyYAML/js-yaml are not guaranteed on a
 * runner, and the one shape this needs is a two-level nested scalar. The
 * scanner is indentation-based and refuses anything it does not recognise
 * rather than guessing.
 *
 * usage: node scripts/requested-image-tag.mjs <values-file> <serviceKey>
 */
import { readFileSync } from 'node:fs'

export function extractImageTag(text, serviceKey) {
  const lines = text.split(/\r?\n/)
  const indentOf = l => l.length - l.replace(/^\s*/, '').length

  let i = lines.findIndex(l => new RegExp(`^${serviceKey}:\\s*(#.*)?$`).test(l))
  if (i === -1) return null
  const serviceIndent = indentOf(lines[i])

  // Walk the service block looking for its `image:` child, then that child's
  // `tag:`. Bail the moment indentation returns to the service's own level or
  // shallower — otherwise a `tag:` under a LATER top-level service would be
  // read as this one's, which is the sort of near-miss that makes a green
  // check meaningless.
  let imageIndent = null
  for (i += 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim() || /^\s*#/.test(line)) continue
    const indent = indentOf(line)
    if (indent <= serviceIndent) return null

    if (imageIndent === null) {
      if (/^\s*image:\s*(#.*)?$/.test(line)) imageIndent = indent
      continue
    }
    if (indent <= imageIndent) return null
    const m = line.match(/^\s*tag:\s*(?:"([^"]*)"|'([^']*)'|([^\s#]*))\s*(?:#.*)?$/)
    if (m) return m[1] ?? m[2] ?? m[3] ?? ''
  }
  return null
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ''))
if (isMain) {
  const [file, serviceKey] = process.argv.slice(2)
  if (!file || !serviceKey) {
    console.error('usage: requested-image-tag.mjs <values-file> <serviceKey>')
    process.exit(2)
  }
  const tag = extractImageTag(readFileSync(file, 'utf8'), serviceKey)
  if (tag === null || tag === '') {
    console.error(`no image tag found for '${serviceKey}' in ${file}`)
    process.exit(1)
  }
  console.log(tag)
}
