#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(process.argv[2] || '.')
const readJson = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'))
const fail = (message) => { console.error(`mobile-release: ${message}`); process.exitCode = 1 }

const repoManifest = readJson('.fuze/manifest.json')
const mobile = repoManifest.mobile
if (!mobile?.required || !mobile.targets?.includes('android')) {
  console.log('mobile-release: Android packaging is not required; skipped')
  process.exit(0)
}

for (const path of ['android/twa-manifest.json', 'frontend/public/manifest.webmanifest',
  'frontend/public/.well-known/assetlinks.json']) {
  if (!existsSync(join(root, path))) fail(`required file is missing: ${path}`)
}
if (process.exitCode) process.exit()

const twa = readJson('android/twa-manifest.json')
const assetlinks = readJson('frontend/public/.well-known/assetlinks.json')
const androidTarget = assetlinks.find((entry) => entry?.target?.namespace === 'android_app')?.target

if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2,}$/.test(twa.packageId || '')) {
  fail(`invalid Android packageId: ${JSON.stringify(twa.packageId)}`)
}
const allowedHost = /^[a-z0-9-]+\.fuzefront\.com$/.test(twa.host || '') || twa.host === 'live.mendysrobotics.com'
if (!allowedHost) {
  fail(`host must be a direct public *.fuzefront.com hostname or live.mendysrobotics.com: ${JSON.stringify(twa.host)}`)
}
if (twa.startUrl !== '/') fail('TWA startUrl must be / so the APK launches the standalone UI')
if (twa.fullScopeUrl !== `https://${twa.host}/`) fail('TWA fullScopeUrl must match the standalone UI origin')
if (twa.webManifestUrl !== `https://${twa.host}/manifest.webmanifest`) fail('TWA webManifestUrl must match the standalone UI origin')
if (androidTarget?.package_name !== twa.packageId) fail('assetlinks package_name does not match TWA packageId')
const fingerprints = androidTarget?.sha256_cert_fingerprints || []
const twaFingerprints = twa.fingerprints?.map((item) => item.value) || []
if (!twa.signingKey?.alias) fail('TWA signing key alias is required')
if (twaFingerprints.length === 0) fail('at least one TWA signing fingerprint is required')
for (const fingerprint of twaFingerprints) {
  if (!fingerprints.includes(fingerprint)) fail('TWA signing fingerprint is absent from assetlinks.json')
}

const registrationPaths = ['registration/manifest.json']
if (existsSync(join(root, registrationPaths[0]))) {
  const registration = readJson(registrationPaths[0])
  if (!(registration.modes || [registration.mode]).includes('standalone')) {
    fail('mobile.required requires standalone in registration modes')
  }
  if (registration.routing?.host !== twa.host) {
    fail('registration routing.host does not match the TWA host')
  }
} else if (!repoManifest.repo?.endsWith('/FuzeFront') && repoManifest.repo !== 'FuzeFront') {
  fail('mobile.required requires registration/manifest.json')
}

if (!process.exitCode) console.log(`mobile-release: ${twa.name} -> https://${twa.host} (${twa.packageId}) is consistent`)
