import { describe, expect, it } from 'vitest'
import { deterministicRepositoryFlows, LiteLlmRepositoryFlowAnalyzer } from './repository-flow-intelligence'

const repository = { id: 'repo-1', tenantId: 'tenant-1', owner: 'fuze', name: 'front', canonicalUrl: 'https://example.test/front', defaultBranch: 'main', kind: 'application' as const, includeGlobs: [], excludeGlobs: [], jiraProjects: [], jiraBindings: [], enabled: true, lastScanStatus: 'complete' as const }
const artifacts = [{ id: 'route-1', repositoryId: 'repo-1', kind: 'route' as const, title: 'Checkout', sourcePath: 'apps/web/Checkout.tsx', summary: 'Open checkout', evidence: [] }]

describe('repository flow wireframes', () => {
  it('attaches source-derived wireframes to deterministic and LiteLLM proposals', async () => {
    expect(deterministicRepositoryFlows(repository, 'abc', artifacts)[0].wireframe.nodes).toEqual([{ label: 'Open checkout', targetIds: ['route-1'] }])
    const fetchImpl = (async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ flows: [{ title: 'Buy', confidence: 0.8, evidenceArtifactIds: ['route-1'], steps: [{ actor: 'buyer', action: 'opens checkout', expectedOutcome: 'checkout appears', targetIds: ['route-1'] }] }] }) } }] }))) as typeof fetch
    const analyzer = new LiteLlmRepositoryFlowAnalyzer('http://litellm/v1', 'quality-analysis', undefined, fetchImpl)
    await expect(analyzer.analyze(repository, 'abc', artifacts)).resolves.toEqual([expect.objectContaining({ wireframe: { kind: 'sequence', nodes: [{ label: 'opens checkout', targetIds: ['route-1'] }] } })])
  })
})
