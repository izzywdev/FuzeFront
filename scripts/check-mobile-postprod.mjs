#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const inventory = JSON.parse(readFileSync(new URL('../fuzeone/mobile-products.json', import.meta.url), 'utf8'))
const owner = 'izzywdev'
const timeoutMs = 12000

export async function inspectProduct(product, request = fetch, token = '') {
  const origin = new URL(product.frontendUrl)
  const checks = {}
  const headers = { 'User-Agent': 'FuzeOne-mobile-postprod', Accept: 'application/vnd.github+json' }
  if (token) headers.Authorization = `Bearer ${token}`

  async function get(url, github = false) {
    try {
      const response = await request(url, {
        redirect: 'manual',
        headers: github ? headers : { 'User-Agent': headers['User-Agent'] },
        signal: AbortSignal.timeout(timeoutMs),
      })
      const contentType = response.headers.get('content-type') || ''
      const location = response.headers.get('location') || ''
      let body = ''
      if (response.status !== 304 && response.status !== 204) body = await response.text()
      return { status: response.status, contentType, location, body }
    } catch (error) {
      return { status: 0, error: error.message, contentType: '', location: '', body: '' }
    }
  }

  const repoApi = `https://api.github.com/repos/${owner}/${product.repo}`
  const [repo, workflows, releases, ui, health, links, manifest] = await Promise.all([
    get(repoApi, true),
    get(`${repoApi}/actions/workflows?per_page=100`, true),
    get(`${repoApi}/releases?per_page=30`, true),
    get(origin.href),
    get(new URL(inventory.healthPath.slice(1), origin).href),
    get(new URL('.well-known/assetlinks.json', origin).href),
    get(new URL((product.manifestPath || '/manifest.webmanifest').slice(1), origin).href),
  ])
  const parse = (response) => { try { return JSON.parse(response.body) } catch { return null } }
  const info = parse(repo)
  const workflowList = parse(workflows)
  const releaseList = parse(releases)
  const assetlinks = parse(links)
  const pwa = parse(manifest)
  const apiHealth = parse(health)
  const uiHtml = ui.status === 200 && /^text\/html\b/i.test(ui.contentType) && /<html\b/i.test(ui.body)
  const accessRedirect = (response) => response.status >= 300 && response.status < 400 && /cloudflareaccess\.com/i.test(response.location)
  const failure = (response) => accessRedirect(response) ? 'Cloudflare Access redirect' :
    response.error || `HTTP ${response.status} ${response.contentType}`.trim()

  checks.repository = { ok: repo.status === 200 && !!info?.default_branch, detail: info?.default_branch || failure(repo) }
  const androidWorkflow = workflowList?.workflows?.find((w) => w.path === '.github/workflows/build-android-apk.yml' && w.state === 'active')
  checks.workflow = { ok: workflows.status === 200 && !!androidWorkflow, detail: androidWorkflow ? 'active' : workflows.status === 200 ? 'Android workflow absent or inactive' : failure(workflows) }
  const release = Array.isArray(releaseList) && releaseList.find((r) => !r.draft && r.target_commitish === info?.default_branch && r.assets?.some((a) => a.name.endsWith('.apk') && a.size > 0))
  const apk = release?.assets?.find((a) => a.name.endsWith('.apk') && a.size > 0)
  checks.apk = { ok: releases.status === 200 && !!apk, detail: apk ? `${release.tag_name}: ${apk.name} (${apk.size} bytes)` : releases.status === 200 ? 'no non-empty APK asset in the 30 latest releases targeting the default branch' : failure(releases) }
  checks.frontend = { ok: uiHtml, detail: uiHtml ? 'HTML at standalone root (app identity and login require browser test)' : failure(ui) }
  checks.api = { ok: health.status >= 200 && health.status < 300 && /json/i.test(health.contentType) && apiHealth !== null,
    detail: health.status >= 200 && health.status < 300 && /json/i.test(health.contentType) && apiHealth !== null ? 'JSON health response' : failure(health) }
  const dalTargets = Array.isArray(assetlinks) ? assetlinks.flatMap((entry) => entry?.relation?.includes('delegate_permission/common.handle_all_urls') ? [entry.target] : []) : []
  checks.assetlinks = { ok: links.status === 200 && dalTargets.some((target) => target?.namespace === 'android_app' && target.package_name && target.sha256_cert_fingerprints?.length),
    detail: dalTargets.length ? dalTargets.map((target) => target?.package_name).join(', ') : failure(links) }
  checks.manifest = { ok: manifest.status === 200 && !!pwa?.name && pwa?.display === 'standalone',
    detail: pwa?.name || failure(manifest) }
  return { product: product.repo, frontendUrl: product.frontendUrl, ok: Object.values(checks).every((check) => check.ok), checks }
}

export async function run(args = process.argv.slice(2), request = fetch) {
  const productArg = args.find((arg) => arg.startsWith('--product='))?.slice('--product='.length)
  const reportArg = args.find((arg) => arg.startsWith('--report='))?.slice('--report='.length)
  const selected = productArg ? inventory.products.filter((product) => product.repo === productArg) : inventory.products
  if (!selected.length || args.some((arg) => !arg.startsWith('--product=') && !arg.startsWith('--report='))) {
    throw new Error('Usage: node scripts/check-mobile-postprod.mjs [--product=FuzeFront] [--report=path.json]')
  }
  const results = await Promise.all(selected.map((product) => inspectProduct(product, request, process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '')))
  const report = { checkedAt: new Date().toISOString(), architecture: inventory.architecture, products: results }
  if (reportArg) writeFileSync(reportArg, `${JSON.stringify(report, null, 2)}\n`)
  for (const result of results) {
    const failed = Object.entries(result.checks).filter(([, check]) => !check.ok).map(([name, check]) => `${name}: ${check.detail}`)
    console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.product} ${result.frontendUrl}${failed.length ? ` — ${failed.join('; ')}` : ''}`)
  }
  console.log(`${results.filter((result) => result.ok).length}/${results.length} products pass HTTP and release checks; device install, certificate verification, UI identity and authenticated flows require separate tests.`)
  return results.every((result) => result.ok) ? 0 : 1
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  run().then((code) => { process.exitCode = code }).catch((error) => { console.error(error.message); process.exitCode = 2 })
}
