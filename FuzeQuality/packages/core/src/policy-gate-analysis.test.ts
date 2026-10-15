import { describe, expect, it } from 'vitest'
import { evaluatePolicyGates, linkExecutionArtifacts } from './policy-gate-analysis'

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
    expect(results.every(item => item.confidence >= 0 && item.confidence <= 1)).toBe(true)
    expect(results).toEqual(expect.arrayContaining([
      expect.objectContaining({ remediationAction: 'build-gate', scope: expect.objectContaining({ sourcePaths: ['governance/auth.md'] }) }),
      expect.objectContaining({ remediationAction: 'build-policy', scope: expect.objectContaining({ sourcePaths: ['.github/lint.yml'] }) }),
    ]))
  })

  it('does not match unrelated artifacts through generated scanner boilerplate', () => {
    const results = evaluatePolicyGates(repository, 'abc', [
      { id: 'policy-auth', repositoryId: 'repo-1', kind: 'policy', title: 'authentication.md', sourcePath: 'governance/authentication.md', summary: 'policy evidence discovered during repository analysis', evidence: ['Authentication must be verified.'] },
      { id: 'gate-deploy', repositoryId: 'repo-1', kind: 'gate', title: 'deploy.yml', sourcePath: '.github/workflows/deploy.yml', summary: 'gate evidence discovered during repository analysis', evidence: ['Deploy the application image.'] },
    ])

    expect(results).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'unguarded-policy', policyArtifactIds: ['policy-auth'], gateArtifactIds: [] }),
      expect.objectContaining({ kind: 'guard-without-policy', policyArtifactIds: [], gateArtifactIds: ['gate-deploy'] }),
    ]))
  })

  it('never presents generated summaries or filenames as source passages', () => {
    const results = evaluatePolicyGates(repository, 'abc', [
      { id: 'policy-empty', repositoryId: 'repo-1', kind: 'policy', title: 'security-policy.md', sourcePath: 'governance/security-policy.md', summary: 'policy evidence discovered during repository analysis', evidence: [] },
    ])

    expect(results.find(item => item.kind === 'unguarded-policy')?.evidencePassages).toEqual([])
  })

  it('persists a reviewable guarded relationship when policy and gate share an enforceable subject', () => {
    const results = evaluatePolicyGates(repository, 'abc', [
      { id: 'policy-auth', repositoryId: 'repo-1', kind: 'policy', title: 'Authentication policy', sourcePath: 'governance/auth.md', summary: 'Authentication required.', evidence: ['authentication required'] },
      { id: 'gate-auth', repositoryId: 'repo-1', kind: 'gate', title: 'Authentication gate', sourcePath: '.github/auth.yml', summary: 'Authentication required check.', evidence: ['authentication check'] },
    ])
    expect(results).toEqual([
      expect.objectContaining({
        kind: 'guarded-policy',
        severity: 'low',
        policyArtifactIds: ['policy-auth'],
        gateArtifactIds: ['gate-auth'],
        scope: {
          sourcePaths: ['governance/auth.md', '.github/auth.yml'],
          subjects: ['authentication'],
        },
      }),
    ])
    expect(results[0].evidencePassages).toEqual([
      expect.objectContaining({ artifactId: 'policy-auth', sourcePath: 'governance/auth.md' }),
      expect.objectContaining({ artifactId: 'gate-auth', sourcePath: '.github/auth.yml', signal: 'gate' }),
    ])
  })

  it('flags discretionary policy wording as ambiguous rather than silently gateable', () => {
    const results = evaluatePolicyGates(repository, 'abc', [
      { id: 'policy-quality', repositoryId: 'repo-1', kind: 'policy', title: 'Quality policy', sourcePath: 'governance/quality.md', summary: 'Teams should use reasonable coverage.', evidence: [] },
    ])
    expect(results).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'ambiguous-policy', severity: 'medium', remediationAction: 'disambiguate-policy', policyArtifactIds: ['policy-quality'] })]))
  })

  it('requires opposing policy polarity and retains the decisive passages', () => {
    const results = evaluatePolicyGates(repository, 'abc', [
      { id: 'policy-require', repositoryId: 'repo-1', kind: 'policy', title: 'Production approval policy', sourcePath: 'governance/approval.md', summary: 'Production changes must require approval.', evidence: ['Every production change must require approval.'] },
      { id: 'policy-forbid', repositoryId: 'repo-1', kind: 'policy', title: 'Production approval exception', sourcePath: 'governance/exception.md', summary: 'Production changes must not require approval.', evidence: ['Emergency production changes must not require approval.'] },
    ])

    expect(results).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'contradictory-policy',
        remediationAction: 'disambiguate-policy',
        evidencePassages: [
          expect.objectContaining({ artifactId: 'policy-require', signal: 'obligation', text: 'Every production change must require approval.' }),
          expect.objectContaining({ artifactId: 'policy-forbid', signal: 'prohibition', text: 'Emergency production changes must not require approval.' }),
        ],
      }),
    ]))
  })

  it('determines contradiction polarity from passages about the shared subject', () => {
    const results = evaluatePolicyGates(repository, 'abc', [
      {
        id: 'policy-mixed', repositoryId: 'repo-1', kind: 'policy', title: 'Deployment and credential policy',
        sourcePath: 'governance/mixed.md', summary: 'Deployment approval and credential handling.',
        evidence: ['Deployments must require approval.', 'Credentials must not be logged.'],
      },
      {
        id: 'policy-deploy-exception', repositoryId: 'repo-1', kind: 'policy', title: 'Deployment approval exception',
        sourcePath: 'governance/deploy-exception.md', summary: 'Deployments must not require approval.',
        evidence: ['Emergency deployments must not require approval.'],
      },
    ])

    expect(results).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'contradictory-policy',
        evidencePassages: [
          expect.objectContaining({ artifactId: 'policy-mixed', signal: 'obligation', text: 'Deployments must require approval.' }),
          expect.objectContaining({ artifactId: 'policy-deploy-exception', signal: 'prohibition', text: 'Emergency deployments must not require approval.' }),
        ],
      }),
    ]))
  })

  it('bounds decisive passages to the ingestion contract limit', () => {
    const longRule = `Authentication must be verified. ${'evidence '.repeat(400)}`
    const results = evaluatePolicyGates(repository, 'abc', [
      { id: 'policy-long', repositoryId: 'repo-1', kind: 'policy', title: 'Authentication policy', sourcePath: 'governance/auth.md', summary: 'Authentication required.', evidence: [longRule] },
    ])
    const passage = results.find(item => item.kind === 'unguarded-policy')?.evidencePassages?.[0]

    expect(passage?.text).toHaveLength(2000)
    expect(passage?.text.endsWith('…')).toBe(true)
  })

  it('does not call two prohibitions contradictory merely because must not contains must', () => {
    const results = evaluatePolicyGates(repository, 'abc', [
      { id: 'policy-one', repositoryId: 'repo-1', kind: 'policy', title: 'Production secret policy', sourcePath: 'governance/secrets.md', summary: 'Production secrets must not be logged.', evidence: [] },
      { id: 'policy-two', repositoryId: 'repo-1', kind: 'policy', title: 'Production secret handling', sourcePath: 'governance/secret-handling.md', summary: 'Production secrets must not be exported.', evidence: [] },
    ])

    expect(results.some(item => item.kind === 'contradictory-policy')).toBe(false)
  })

  it('links a ref-qualified GitHub workflow path to its catalog gate', () => {
    const artifacts = [
      { id: 'policy-ci', repositoryId: 'repo-1', kind: 'policy' as const, title: 'CI policy', sourcePath: 'governance/ci.md', summary: 'Builds must pass CI.', evidence: ['build required'] },
      { id: 'gate-ci', repositoryId: 'repo-1', kind: 'gate' as const, title: 'CI', sourcePath: '.github/workflows/ci.yml', summary: 'Build required check.', evidence: ['build required'] },
    ]

    expect(linkExecutionArtifacts('Quality checks', artifacts, '.github/workflows/ci.yml@main')).toEqual({
      policyArtifactIds: ['policy-ci'],
      gateArtifactIds: ['gate-ci'],
      policyGatePairs: [{ policyArtifactId: 'policy-ci', gateArtifactId: 'gate-ci' }],
    })
  })
})
