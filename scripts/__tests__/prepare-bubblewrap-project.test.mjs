import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const script = path.join(repoRoot, 'scripts', 'prepare-bubblewrap-project.mjs')

test('removes Bubblewrap legacy package ownership without changing the namespace declaration', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'bubblewrap-project-'))
  const manifest = path.join(root, 'app', 'src', 'main', 'AndroidManifest.xml')
  try {
    mkdirSync(path.dirname(manifest), { recursive: true })
    writeFileSync(manifest, '<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.fuzefront.app"><application /></manifest>')

    const result = spawnSync(process.execPath, [script, root], { encoding: 'utf8' })

    assert.equal(result.status, 0, result.stderr)
    assert.equal(
      readFileSync(manifest, 'utf8'),
      '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application /></manifest>'
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
