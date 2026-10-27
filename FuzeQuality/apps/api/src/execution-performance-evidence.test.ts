import { describe, expect, it, vi } from 'vitest'
import type { PolicyGatePerformance } from '@fuzequality/core'
import { enrichPerformanceEvidence } from './execution-performance-evidence'

const pair: PolicyGatePerformance = {
  repositoryId: 'repo-1',
  policyArtifactId: 'policy-auth',
  gateArtifactId: 'gate-auth',
  total: 1,
  passed: 0,
  failed: 1,
  cancelled: 0,
  running: 0,
  passRate: 0,
}

describe('execution performance evidence', () => {
  it('resolves filtered source revisions through their exact historical catalog', async () => {
    const dependencies = {
      catalogRevisionForSource: vi.fn().mockResolvedValue('catalog-historical'),
      qualityArtifactsByIds: vi.fn().mockResolvedValue([
        { id: 'policy-observation', logicalId: 'policy-auth', repositoryId: 'repo-1', kind: 'policy', title: 'Historical auth policy', sourcePath: 'policies/auth-v1.md', summary: '', evidence: [] },
        { id: 'gate-observation', logicalId: 'gate-auth', repositoryId: 'repo-1', kind: 'gate', title: 'Historical auth gate', sourcePath: '.github/workflows/auth-v1.yml', summary: '', evidence: [] },
      ]),
    }

    await expect(enrichPerformanceEvidence(
      'repo-1',
      'tenant-1',
      [pair],
      { sourceRevision: 'a'.repeat(40), currentCatalogRevision: 'catalog-current' },
      dependencies,
    )).resolves.toEqual([{
      ...pair,
      policyTitle: 'Historical auth policy',
      policySourcePath: 'policies/auth-v1.md',
      gateTitle: 'Historical auth gate',
      gateSourcePath: '.github/workflows/auth-v1.yml',
    }])
    expect(dependencies.catalogRevisionForSource).toHaveBeenCalledWith('repo-1', 'tenant-1', 'a'.repeat(40))
    expect(dependencies.qualityArtifactsByIds).toHaveBeenCalledWith(
      'repo-1', 'tenant-1', ['policy-auth', 'gate-auth'], 'catalog-historical',
    )
  })

  it('does not fall back to current labels when a filtered source revision has no catalog', async () => {
    const dependencies = {
      catalogRevisionForSource: vi.fn().mockResolvedValue(undefined),
      qualityArtifactsByIds: vi.fn(),
    }

    await expect(enrichPerformanceEvidence(
      'repo-1', 'tenant-1', [pair],
      { sourceRevision: 'b'.repeat(40), currentCatalogRevision: 'catalog-current' },
      dependencies,
    )).resolves.toEqual([pair])
    expect(dependencies.qualityArtifactsByIds).not.toHaveBeenCalled()
  })

  it('pins unfiltered labels to the portfolio catalog revision', async () => {
    const dependencies = {
      catalogRevisionForSource: vi.fn(),
      qualityArtifactsByIds: vi.fn().mockResolvedValue([]),
    }

    await enrichPerformanceEvidence(
      'repo-1', 'tenant-1', [pair],
      { currentCatalogRevision: 'catalog-current' },
      dependencies,
    )
    expect(dependencies.catalogRevisionForSource).not.toHaveBeenCalled()
    expect(dependencies.qualityArtifactsByIds).toHaveBeenCalledWith(
      'repo-1', 'tenant-1', ['policy-auth', 'gate-auth'], 'catalog-current',
    )
  })
})
