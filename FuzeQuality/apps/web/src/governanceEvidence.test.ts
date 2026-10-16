import { describe, expect, it } from 'vitest'
import type { PolicyGateEvaluation } from '@fuzequality/contracts'
import { governanceEvidenceSelection } from './governanceEvidence'

const evaluation = (
  id: string,
  revision: string,
  createdAt: string,
  policyArtifactIds = [`policy-${id}`],
): PolicyGateEvaluation => ({
  id,
  repositoryId: 'repo-1',
  tenantId: 'tenant-1',
  revision,
  kind: 'unguarded-policy',
  severity: 'high',
  title: id,
  detail: id,
  policyArtifactIds,
  gateArtifactIds: [`gate-${id}`],
  confidence: 1,
  scope: { sourcePaths: [], subjects: [] },
  evidencePassages: [{ artifactId: `passage-${id}`, sourcePath: 'policy.md', text: id, signal: 'obligation' }],
  remediationAction: 'build-gate',
  recommendation: id,
  reviewStatus: 'proposed',
  createdAt,
})

describe('governance evidence selection', () => {
  it('keeps exact current evidence and only the newest bounded historical revisions', () => {
    const result = governanceEvidenceSelection([
      evaluation('current', 'current', '2026-10-12T00:00:00.000Z'),
      evaluation('old-1', 'old-1', '2026-10-11T00:00:00.000Z'),
      evaluation('old-2', 'old-2', '2026-10-10T00:00:00.000Z'),
    ], [{ id: 'repo-1', lastScanRevision: 'current' }], 'all', 1)

    expect(result).toEqual({
      requests: [{
        repositoryId: 'repo-1',
        revision: 'current',
        artifactIds: [
          'gate-current',
          'passage-current',
          'policy-current',
        ],
      }, {
        repositoryId: 'repo-1',
        revision: 'old-1',
        artifactIds: [
          'gate-old-1',
          'passage-old-1',
          'policy-old-1',
        ],
      }],
      omittedHistoricalRevisions: 1,
    })
  })

  it('deduplicates referenced IDs for exact lookup batches', () => {
    const result = governanceEvidenceSelection([
      evaluation('current', 'current', '2026-10-12T00:00:00.000Z', ['shared', 'shared']),
    ], [{ id: 'repo-1', lastScanRevision: 'current' }], 'current')

    expect(result.requests[0].artifactIds.filter(id => id === 'shared')).toEqual(['shared'])
  })
})
