/**
 * Test to verify FuzeSocial manifest registration declares organization context only.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SEED_DIR = path.join(__dirname, '..', '..', 'services', 'app-registry-service', 'seed')
const FUZESOCIAL_SEED = path.join(SEED_DIR, 'fuzesocial.manifest.json')
const FUZESOCIAL_ROOT_MANIFEST = path.join('D:', 'source', 'FuzeSocial', 'registration', 'manifest.json')

test('fuzesocial.manifest.json in seed declares organization-only context and installation', () => {
  assert.ok(fs.existsSync(FUZESOCIAL_SEED), `fuzesocial.manifest.json must exist at ${FUZESOCIAL_SEED}`)
  const manifest = JSON.parse(fs.readFileSync(FUZESOCIAL_SEED, 'utf8'))
  assert.equal(manifest.visibility, 'organization', 'visibility must be organization')
  assert.equal(manifest.scopeLevel, 'organization', 'scopeLevel must be organization')
  assert.equal(manifest.requiresOrgContext, true, 'requiresOrgContext must be true')
  assert.equal(manifest.installMode, 'everyone', 'installMode must be everyone')
  assert.equal(manifest.orgLevelOnly, true, 'orgLevelOnly must be true')
})

test('FuzeSocial repository registration manifest matches organization-only requirement', () => {
  if (fs.existsSync(FUZESOCIAL_ROOT_MANIFEST)) {
    const manifest = JSON.parse(fs.readFileSync(FUZESOCIAL_ROOT_MANIFEST, 'utf8'))
    assert.equal(manifest.visibility, 'organization', 'FuzeSocial visibility must be organization')
    assert.equal(manifest.scopeLevel, 'organization', 'FuzeSocial scopeLevel must be organization')
    assert.equal(manifest.requiresOrgContext, true, 'FuzeSocial requiresOrgContext must be true')
    assert.equal(manifest.installMode, 'everyone', 'FuzeSocial installMode must be everyone')
    assert.equal(manifest.orgLevelOnly, true, 'FuzeSocial orgLevelOnly must be true')
  }
})
