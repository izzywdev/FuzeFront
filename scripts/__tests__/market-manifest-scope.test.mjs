/**
 * Test to verify FuzeMarket and Market manifest registrations declare organization context only.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SEED_DIR = path.join(__dirname, '..', '..', 'services', 'app-registry-service', 'seed')
const MARKET_SEED = path.join(SEED_DIR, 'market.manifest.json')
const FUZEMARKET_SEED = path.join(SEED_DIR, 'fuzemarket.manifest.json')
const FUZEMARKET_ROOT_MANIFEST = path.join('D:', 'source', 'FuzeMarket', 'registration', 'manifest.json')

test('market.manifest.json in seed declares organization-only context and installation', () => {
  assert.ok(fs.existsSync(MARKET_SEED), `market.manifest.json must exist at ${MARKET_SEED}`)
  const manifest = JSON.parse(fs.readFileSync(MARKET_SEED, 'utf8'))
  assert.equal(manifest.visibility, 'organization', 'visibility must be organization')
  assert.equal(manifest.scopeLevel, 'organization', 'scopeLevel must be organization')
  assert.equal(manifest.requiresOrgContext, true, 'requiresOrgContext must be true')
})

test('fuzemarket.manifest.json in seed declares organization-only context and installation', () => {
  assert.ok(fs.existsSync(FUZEMARKET_SEED), `fuzemarket.manifest.json must exist at ${FUZEMARKET_SEED}`)
  const manifest = JSON.parse(fs.readFileSync(FUZEMARKET_SEED, 'utf8'))
  assert.equal(manifest.visibility, 'organization', 'visibility must be organization')
  assert.equal(manifest.scopeLevel, 'organization', 'scopeLevel must be organization')
  assert.equal(manifest.requiresOrgContext, true, 'requiresOrgContext must be true')
})

test('FuzeMarket repository registration manifest matches organization-only requirement', () => {
  if (fs.existsSync(FUZEMARKET_ROOT_MANIFEST)) {
    const manifest = JSON.parse(fs.readFileSync(FUZEMARKET_ROOT_MANIFEST, 'utf8'))
    assert.equal(manifest.visibility, 'organization', 'FuzeMarket visibility must be organization')
    assert.equal(manifest.scopeLevel, 'organization', 'FuzeMarket scopeLevel must be organization')
    assert.equal(manifest.requiresOrgContext, true, 'FuzeMarket requiresOrgContext must be true')
  }
})
