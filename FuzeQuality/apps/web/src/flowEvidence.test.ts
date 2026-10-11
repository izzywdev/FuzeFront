import { describe, expect, it } from 'vitest'
import type { RepositoryFlowCandidate } from '@fuzequality/contracts'
import { historicalFlowEvidenceSelection } from './flowEvidence'

const candidate = (
  revision: string,
  createdAt: string,
  repositoryId = 'repo-1'
): RepositoryFlowCandidate => ({
  id: `${repositoryId}:${revision}`,
  repositoryId,
  tenantId: 'tenant-1',
  revision,
  title: revision,
  confidence: 1,
  evidence: [],
  steps: [],
  wireframe: { kind: 'sequence', nodes: [] },
  status: 'proposed',
  source: 'deterministic',
  createdAt,
})

describe('historical flow evidence selection', () => {
  it('keeps the newest distinct historical revisions within the request bound', () => {
    const candidates = [
      candidate('current', '2026-10-11T12:00:00.000Z'),
      candidate('old-1', '2026-10-10T12:00:00.000Z'),
      candidate('old-1', '2026-10-10T11:00:00.000Z'),
      candidate('old-2', '2026-10-09T12:00:00.000Z'),
      candidate('old-3', '2026-10-08T12:00:00.000Z'),
    ]

    expect(historicalFlowEvidenceSelection(
      candidates,
      [{ id: 'repo-1', lastScanRevision: 'current' }],
      2,
    )).toEqual({
      selected: [
        { repositoryId: 'repo-1', revision: 'old-1' },
        { repositoryId: 'repo-1', revision: 'old-2' },
      ],
      omitted: 1,
      total: 3,
    })
  })

  it('uses a stable repository/revision order when timestamps are absent', () => {
    expect(historicalFlowEvidenceSelection([
      candidate('b', 'invalid', 'repo-2'),
      candidate('a', 'invalid', 'repo-1'),
    ], [], 20).selected).toEqual([
      { repositoryId: 'repo-1', revision: 'a' },
      { repositoryId: 'repo-2', revision: 'b' },
    ])
  })
})
