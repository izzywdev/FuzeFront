import { describe, expect, it } from 'vitest'
import { linkExecutionArtifacts } from './policy-gate-analysis'

describe('execution-to-governance linking', () => {
  it('links a named workflow to matching gate and policy artifacts only', () => {
    const artifacts = [
      { id: 'policy-auth', repositoryId: 'repo', kind: 'policy' as const, title: 'Authentication policy', sourcePath: 'governance/auth.md', summary: 'Authentication required.', evidence: [] },
      { id: 'gate-auth', repositoryId: 'repo', kind: 'gate' as const, title: 'Authentication gate', sourcePath: '.github/auth.yml', summary: 'Authentication required check.', evidence: [] },
      { id: 'gate-lint', repositoryId: 'repo', kind: 'gate' as const, title: 'Lint gate', sourcePath: '.github/lint.yml', summary: 'Lint required check.', evidence: [] },
    ]
    expect(linkExecutionArtifacts('Authentication integration', artifacts)).toEqual({ policyArtifactIds: ['policy-auth'], gateArtifactIds: ['gate-auth'] })
  })
})
