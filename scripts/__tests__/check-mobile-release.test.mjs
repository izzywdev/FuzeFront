import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const script = path.join(repoRoot, 'scripts', 'check-mobile-release.mjs')
const fingerprint = 'CF:79:24:8E:4A:89:77:1E:C8:B6:69:83:4B:D4:AF:0C:8E:2C:B8:A4:5B:D6:FA:57:D0:06:9C:34:33:6F:68:AA'
const baseFiles = {
  '.fuze/manifest.json': {
    repo: 'example/mobile-app',
    mobile: { required: true, targets: ['android'] },
  },
  'android/twa-manifest.json': {
    packageId: 'com.example.mobile',
    host: 'mobile.fuzefront.com',
    startUrl: '/',
    fullScopeUrl: 'https://mobile.fuzefront.com/',
    webManifestUrl: 'https://mobile.fuzefront.com/manifest.webmanifest',
    name: 'Mobile App',
    signingKey: { alias: 'release' },
    fingerprints: [{ name: 'release', value: fingerprint }],
  },
  'frontend/public/manifest.webmanifest': {},
  'frontend/public/.well-known/assetlinks.json': [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: 'com.example.mobile',
        sha256_cert_fingerprints: [fingerprint],
      },
    },
  ],
  'registration/manifest.json': {
    modes: ['standalone'],
    routing: { host: 'mobile.fuzefront.com' },
  },
}

function runGate(overrides = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mobile-release-'))
  try {
    const files = structuredClone(baseFiles)
    for (const [pathName, value] of Object.entries(overrides)) {
      if (value === null) delete files[pathName]
      else files[pathName] = value
    }
    for (const [pathName, value] of Object.entries(files)) {
      const file = path.join(root, pathName)
      mkdirSync(path.dirname(file), { recursive: true })
      writeFileSync(file, JSON.stringify(value))
    }
    return spawnSync(process.execPath, [script, root], { encoding: 'utf8' })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('skips when Android packaging is not required', () => {
  const result = runGate({
    '.fuze/manifest.json': { mobile: { required: false, targets: [] } },
  })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Android packaging is not required; skipped/)
})

test('accepts a valid Android release contract', () => {
  const result = runGate()
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /is consistent/)
})

test('rejects malformed signing fingerprints', () => {
  const twa = structuredClone(baseFiles['android/twa-manifest.json'])
  const assets = structuredClone(baseFiles['frontend/public/.well-known/assetlinks.json'])
  twa.fingerprints[0].value = 'NOT-A-CERTIFICATE'
  assets[0].target.sha256_cert_fingerprints[0] = 'NOT-A-CERTIFICATE'
  const result = runGate({
    'android/twa-manifest.json': twa,
    'frontend/public/.well-known/assetlinks.json': assets,
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /invalid TWA signing fingerprint/)
})

test('rejects assetlinks without URL-handling delegation', () => {
  const assetlinks = structuredClone(baseFiles['frontend/public/.well-known/assetlinks.json'])
  assetlinks[0].relation = ['delegate_permission/common.get_login_creds']
  const result = runGate({ 'frontend/public/.well-known/assetlinks.json': assetlinks })
  assert.equal(result.status, 1)
})

test('rejects mismatched package IDs', () => {
  const assetlinks = structuredClone(baseFiles['frontend/public/.well-known/assetlinks.json'])
  assetlinks[0].target.package_name = 'com.example.other'
  const result = runGate({ 'frontend/public/.well-known/assetlinks.json': assetlinks })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /package_name does not match/)
})

test('rejects mismatched TWA and registration hosts', () => {
  const registration = structuredClone(baseFiles['registration/manifest.json'])
  registration.routing.host = 'other.fuzefront.com'
  const result = runGate({ 'registration/manifest.json': registration })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /routing.host does not match/)
})

test('rejects a missing registration manifest', () => {
  const result = runGate({ 'registration/manifest.json': null })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /requires registration\/manifest.json/)
})

test('rejects registration without standalone mode', () => {
  const registration = structuredClone(baseFiles['registration/manifest.json'])
  registration.modes = ['embedded']
  const result = runGate({ 'registration/manifest.json': registration })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /requires standalone/)
})
