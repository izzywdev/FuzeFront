import { describe, expect, it } from 'vitest'
import { linkExecutionArtifacts } from './policy-gate-analysis'

describe('execution-to-governance linking', () => {
  it('links a named workflow to matching gate and policy artifacts only', () => {
    const artifacts = [
      { id: 'policy-auth', repositoryId: 'repo', kind: 'policy' as const, title: 'Authentication policy', sourcePath: 'governance/auth.md', summary: 'Authentication required.', evidence: [] },
      { id: 'gate-auth', repositoryId: 'repo', kind: 'gate' as const, title: 'Authentication gate', sourcePath: '.github/auth.yml', summary: 'Authentication required check.', evidence: [] },
      { id: 'gate-lint', repositoryId: 'repo', kind: 'gate' as const, title: 'Lint gate', sourcePath: '.github/lint.yml', summary: 'Lint required check.', evidence: [] },
    ]
    expect(linkExecutionArtifacts('Authentication integration', artifacts)).toEqual({
      policyArtifactIds: ['policy-auth'],
      gateArtifactIds: ['gate-auth'],
      policyGatePairs: [{ policyArtifactId: 'policy-auth', gateArtifactId: 'gate-auth' }],
    })
  })

  it('prefers the exact checked-in workflow gate over ambiguous display-name matches', () => {
    const artifacts = [
      { id: 'policy-auth', repositoryId: 'repo', kind: 'policy' as const, title: 'Authentication policy', sourcePath: 'governance/auth.md', summary: 'Authentication required.', evidence: [] },
      { id: 'gate-auth', repositoryId: 'repo', kind: 'gate' as const, title: 'Authentication gate', sourcePath: '.github/workflows/authentication.yml', summary: 'Authentication integration required check.', evidence: [] },
      { id: 'gate-generic', repositoryId: 'repo', kind: 'gate' as const, title: 'Integration gate', sourcePath: '.github/workflows/integration.yml', summary: 'Authentication integration required check.', evidence: [] },
    ]

    expect(linkExecutionArtifacts(
      'Authentication integration',
      artifacts,
      '.github/workflows/authentication.yml',
    )).toEqual({
      policyArtifactIds: ['policy-auth'],
      gateArtifactIds: ['gate-auth'],
      policyGatePairs: [{ policyArtifactId: 'policy-auth', gateArtifactId: 'gate-auth' }],
    })
  })

  it('falls back to the reviewed name match without workflow-path provenance', () => {
    const artifacts = [
      { id: 'policy-auth', repositoryId: 'repo', kind: 'policy' as const, title: 'Authentication policy', sourcePath: 'governance/auth.md', summary: 'Authentication required.', evidence: [] },
      { id: 'gate-auth', repositoryId: 'repo', kind: 'gate' as const, title: 'Authentication gate', sourcePath: '.github/workflows/authentication.yml', summary: 'Authentication required check.', evidence: [] },
    ]

    expect(linkExecutionArtifacts('Authentication integration', artifacts)).toEqual({
      policyArtifactIds: ['policy-auth'],
      gateArtifactIds: ['gate-auth'],
      policyGatePairs: [{ policyArtifactId: 'policy-auth', gateArtifactId: 'gate-auth' }],
    })
  })

  it('does not name-match a different gate when workflow-path provenance is present', () => {
    const artifacts = [
      { id: 'policy-auth', repositoryId: 'repo', kind: 'policy' as const, title: 'Authentication policy', sourcePath: 'governance/auth.md', summary: 'Authentication required.', evidence: [] },
      { id: 'gate-auth', repositoryId: 'repo', kind: 'gate' as const, title: 'Authentication gate', sourcePath: '.github/workflows/authentication.yml', summary: 'Authentication required check.', evidence: [] },
    ]

    expect(linkExecutionArtifacts(
      'Authentication integration',
      artifacts,
      '.github/workflows/different.yml',
    )).toEqual({ policyArtifactIds: [], gateArtifactIds: [], policyGatePairs: [] })
  })

  it('links every matching policy to one gate proven by exact workflow provenance', () => {
    const artifacts = [
      { id: 'policy-auth', repositoryId: 'repo', kind: 'policy' as const, title: 'Authentication policy', sourcePath: 'governance/auth.md', summary: 'Authentication required.', evidence: [] },
      { id: 'policy-session', repositoryId: 'repo', kind: 'policy' as const, title: 'Session policy', sourcePath: 'governance/session.md', summary: 'Authentication sessions required.', evidence: [] },
      { id: 'gate-auth', repositoryId: 'repo', kind: 'gate' as const, title: 'Authentication gate', sourcePath: '.github/workflows/authentication.yml', summary: 'Authentication required check.', evidence: [] },
    ]

    expect(linkExecutionArtifacts(
      'Authentication integration',
      artifacts,
      '.github/workflows/authentication.yml',
    )).toEqual({
      policyArtifactIds: ['policy-auth', 'policy-session'],
      gateArtifactIds: ['gate-auth'],
      policyGatePairs: [
        { policyArtifactId: 'policy-auth', gateArtifactId: 'gate-auth' },
        { policyArtifactId: 'policy-session', gateArtifactId: 'gate-auth' },
      ],
    })
  })

  it('does not create a Cartesian product for ambiguous name-only gate matches', () => {
    const artifacts = [
      { id: 'policy-auth', repositoryId: 'repo', kind: 'policy' as const, title: 'Authentication policy', sourcePath: 'governance/auth.md', summary: 'Authentication required.', evidence: [] },
      { id: 'gate-auth-one', repositoryId: 'repo', kind: 'gate' as const, title: 'Authentication primary', sourcePath: '.github/workflows/auth-one.yml', summary: 'Authentication required check.', evidence: [] },
      { id: 'gate-auth-two', repositoryId: 'repo', kind: 'gate' as const, title: 'Authentication secondary', sourcePath: '.github/workflows/auth-two.yml', summary: 'Authentication required check.', evidence: [] },
    ]

    expect(linkExecutionArtifacts('Authentication integration', artifacts)).toEqual({
      policyArtifactIds: ['policy-auth'],
      gateArtifactIds: ['gate-auth-one', 'gate-auth-two'],
      policyGatePairs: [],
    })
  })
})
