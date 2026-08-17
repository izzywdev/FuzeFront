#!/usr/bin/env node
// Guards the FuzeQuality self-registration payload.
//
// Two independent failures this catches, both of which have already cost the
// fleet real downtime:
//
//   1. DRIFT between registration/ and the chart's files/registration/ copy.
//      Helm's .Files is scoped to the chart directory, so the chart cannot read
//      FuzeQuality/registration/ directly and the files must be vendored. A
//      vendored copy is a copy: edit one, forget the other, and the deployed
//      registration is silently the stale one. FuzeMarket ran for eight days and
//      1847 Init:Error restarts on exactly this shape of divergence.
//
//   2. SLUG DIVERGENCE between the manifest and anything else that names the app.
//      `slug` is IMMUTABLE once registered — correcting it costs a
//      register-then-delete migration that orphans Permit grants and
//      CASCADE-deletes app_installations rows. It is worth failing CI over.
//
// Exit 0 = consistent. Exit 1 = do not merge.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const SOURCE = join(ROOT, 'registration')
const VENDORED = join(ROOT, 'deploy/helm/fuzequality/files/registration')

const problems = []

function listFiles(dir) {
  try {
    return readdirSync(dir)
      .filter(f => statSync(join(dir, f)).isFile())
      .sort()
  } catch (err) {
    problems.push(`cannot read ${dir}: ${err.message}`)
    return []
  }
}

const sourceFiles = listFiles(SOURCE)
const vendoredFiles = listFiles(VENDORED)

// Compare the SETS first: a file added to registration/ and not vendored is the
// same defect as an edited one, and byte comparison alone would not see it.
for (const f of sourceFiles) {
  if (!vendoredFiles.includes(f)) {
    problems.push(
      `registration/${f} has no vendored copy — add it to deploy/helm/fuzequality/files/registration/`
    )
  }
}
for (const f of vendoredFiles) {
  if (!sourceFiles.includes(f)) {
    problems.push(
      `deploy/helm/fuzequality/files/registration/${f} has no source in registration/ — it is unreachable and stale`
    )
  }
}

for (const f of sourceFiles.filter(f => vendoredFiles.includes(f))) {
  const a = readFileSync(join(SOURCE, f))
  const b = readFileSync(join(VENDORED, f))
  if (!a.equals(b)) {
    problems.push(
      `registration/${f} differs from deploy/helm/fuzequality/files/registration/${f} — the chart would deploy the stale copy`
    )
  }
}

// The slug the platform will key this app under, forever.
let slug = null
try {
  slug = JSON.parse(readFileSync(join(SOURCE, 'manifest.json'), 'utf8')).slug
} catch (err) {
  problems.push(`registration/manifest.json is unreadable or invalid JSON: ${err.message}`)
}

if (slug) {
  if (/^fuze/i.test(slug)) {
    problems.push(
      `manifest slug "${slug}" carries the "fuze" prefix — fleet policy registers products without it (e.g. "quality", not "fuzequality")`
    )
  }
  // The chart's own view of the slug, read the way the init container will read
  // it: whatever ends up in the ConfigMap is what register.sh acts on.
  try {
    const vendoredSlug = JSON.parse(
      readFileSync(join(VENDORED, 'manifest.json'), 'utf8')
    ).slug
    if (vendoredSlug !== slug) {
      problems.push(
        `slug mismatch: registration/manifest.json says "${slug}", the chart copy says "${vendoredSlug}" — the deployed app would register under the wrong, immutable slug`
      )
    }
  } catch {
    /* already reported by the set/byte checks above */
  }
}

if (problems.length) {
  console.error('✘ FuzeQuality registration is inconsistent:\n')
  for (const p of problems) console.error(`  - ${p}`)
  console.error(
    '\nFix: re-copy registration/* into deploy/helm/fuzequality/files/registration/ and re-run.'
  )
  process.exit(1)
}

console.log(
  `✔ FuzeQuality registration consistent — slug "${slug}", ${sourceFiles.length} file(s) vendored in sync`
)
