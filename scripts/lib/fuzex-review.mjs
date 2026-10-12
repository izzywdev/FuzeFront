import path from 'node:path'
import { computeStamp } from '../stamp-frames.mjs'

const STAMP = /^[a-f0-9]{64}$/

function repository(value) {
  return String(value ?? '').replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '').toLowerCase()
}

/** No credentials in URLs or redirect hops. Hosted review reads are public. */
function reviewUrl(value) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('FuzeX review baseUrl must be an HTTPS URL without credentials, query or fragment')
  }
  return url.href.replace(/\/$/, '')
}

/**
 * Explicit migration: only named features use hosted decisions. Once selected,
 * an unavailable service, missing import, stale stamp or rejection never falls
 * back to the Git manifest's approval flags.
 */
export async function hostedCoverage(coverage, { config, framesDir, fetcher = fetch, stamp = computeStamp }) {
  if (!config || config.mode === 'legacy') return coverage
  if (config.mode !== 'hosted') throw new Error('FuzeX review mode must be legacy or hosted')
  if (!config.features || Array.isArray(config.features) || typeof config.features !== 'object') {
    throw new Error('FuzeX hosted review requires a features map (local feature to hosted slug)')
  }
  const sourceRepo = repository(config.sourceRepo)
  if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(sourceRepo)) throw new Error('FuzeX sourceRepo must identify owner/repository')
  const baseUrl = reviewUrl(config.baseUrl)
  async function get(suffix) {
    const response = await fetcher(`${baseUrl}/api/v1/features/${suffix}`, {
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    })
    if (!response.ok) throw new Error(`FuzeX hosted review returned HTTP ${response.status}; no legacy fallback`)
    return response.json()
  }

  const results = coverage.map(entry => ({ ...entry }))
  for (const feature of new Set(coverage.map(entry => entry.feature))) {
    if (!Object.hasOwn(config.features, feature)) continue
    const hostedSlug = config.features[feature]
    if (typeof hostedSlug !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(hostedSlug)) {
      throw new Error(`Invalid hosted slug for ${feature}`)
    }
    const localStamp = await stamp(path.join(framesDir, feature))
    const current = await get(`${hostedSlug}/stamp`)
    if (!STAMP.test(current.stamp) || current.current !== true || current.manifestStamp !== current.stamp) {
      throw new Error(`FuzeX ${feature} has no current immutable revision`)
    }
    const revision = await get(`${hostedSlug}/revisions/${current.stamp}`)
    if (revision.stamp !== current.stamp || repository(revision.manifest?.sourceRepo) !== sourceRepo || revision.manifest?.sourceStamp !== localStamp) {
      throw new Error(`FuzeX ${feature} source provenance differs from this checkout; import and review this exact revision`)
    }
    for (const entry of results.filter(item => item.feature === feature)) {
      // Legacy feature-level flags cannot stand in for a hosted per-flow decision.
      if (entry.flow === '(feature-level)' || entry.flow === '(unnamed flow)') {
        throw new Error(`FuzeX ${feature} needs explicit flow IDs before hosted migration`)
      }
      const decisions = await get(`${hostedSlug}/flows/${encodeURIComponent(entry.flow)}/approvals?limit=1`)
      if (!Array.isArray(decisions.items)) throw new Error(`FuzeX ${feature} returned an invalid approval history`)
      const latest = decisions.items[0]
      entry.approved = latest?.decision === 'approve' && latest?.contentStamp === current.stamp && latest?.flowId === entry.flow && latest?.slug === hostedSlug
      entry.approvalSource = 'fuzex'
    }
    // A concurrent import must not let CI approve a different current revision.
    const after = await get(`${hostedSlug}/stamp`)
    if (after.stamp !== current.stamp || after.current !== true) {
      throw new Error(`FuzeX ${feature} changed during approval verification; retry the gate`)
    }
  }
  return results
}
