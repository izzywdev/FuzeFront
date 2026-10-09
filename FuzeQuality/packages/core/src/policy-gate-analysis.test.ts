import { describe, expect, it } from 'vitest'
import { evaluatePolicyGates } from './policy-gate-analysis'

const repository = { id: 'repo-1', tenantId: 'org-1', owner: 'fuze', name: 'front', canonicalUrl: 'https://example.test/front', defaultBranch: 'main', kind: 'application' as const, includeGlobs: [], excludeGlobs: [], jiraProjects: [], jiraBindings: [], enabled: true, lastScanStatus: 'complete' as const }

describe('policy gate evaluation', () => {
  it('finds unguarded policies and gates with no policy', () => {
    const results = evaluatePolicyGates(repository, 'abc', [
      { id: 'policy-auth', repositoryId: 'repo-1', kind: 'policy', title: 'Authentication policy', sourcePath: 'governance/auth.md', summary: 'Authentication must be verified.', evidence: ['Authentication is required.'] },
      { id: 'gate-lint', repositoryId: 'repo-1', kind: 'gate', title: 'Lint gate', sourcePath: '.github/lint.yml', summary: 'Lint required check.', evidence: ['required check lint'] },
    ], '2026-01-01T00:00:00.000Z')
    expect(results.map(item => item.kind)).toEqual(expect.arrayContaining(['unguarded-policy', 'guard-without-policy']))
    expect(results.every(item => item.tenantId === 'org-1')).toBe(true)
    expect(results.every(item => item.reviewStatus === 'proposed')).toBe(true)
  })

  it('does not call a gate ungoverned when it shares an enforceable subject', () => {
    const results = evaluatePolicyGates(repository, 'abc', [
      { id: 'policy-auth', repositoryId: 'repo-1', kind: 'policy', title: 'Authentication policy', sourcePath: 'governance/auth.md', summary: 'Authentication required.', evidence: ['authentication required'] },
      { id: 'gate-auth', repositoryId: 'repo-1', kind: 'gate', title: 'Authentication gate', sourcePath: '.github/auth.yml', summary: 'Authentication required check.', evidence: ['authentication check'] },
    ])
    expect(results).toEqual([])
  })

  it('flags discretionary policy wording as ambiguous rather than silently gateable', () => {
    const results = evaluatePolicyGates(repository, 'abc', [
      { id: 'policy-quality', repositoryId: 'repo-1', kind: 'policy', title: 'Quality policy', sourcePath: 'governance/quality.md', summary: 'Teams should use reasonable coverage.', evidence: [] },
    ])
    expect(results).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'ambiguous-policy', severity: 'medium', policyArtifactIds: ['policy-quality'] })]))
  })
})
