#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const projectRoot = resolve(process.argv[2] || 'android')
const manifestPath = join(projectRoot, 'app', 'src', 'main', 'AndroidManifest.xml')
const source = readFileSync(manifestPath, 'utf8')
const opening = source.match(/<manifest\b[^>]*>/)?.[0]

if (!opening) {
  throw new Error(`Bubblewrap Android manifest is missing its <manifest> element: ${manifestPath}`)
}

// Current Bubblewrap still emits the legacy package attribute while its Gradle
// template uses an Android Gradle Plugin that rejects namespace declarations in
// AndroidManifest.xml. The generated build.gradle already owns namespace and
// applicationId, so removing this duplicate is the supported AGP migration.
const normalizedOpening = opening.replace(/\s+package="[^"]*"/, '')
const normalized = source.replace(opening, normalizedOpening)

if (/\bpackage="[^"]*"/.test(normalizedOpening)) {
  throw new Error(`Unable to remove the legacy package attribute from ${manifestPath}`)
}

writeFileSync(manifestPath, normalized)
console.log(`bubblewrap-project: normalized ${manifestPath}`)
