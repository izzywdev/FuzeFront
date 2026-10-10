import { describe, expect, it } from 'vitest'
import {
  deterministicRepositoryFlows,
  LiteLlmRepositoryFlowAnalyzer,
  REPOSITORY_FLOW_PROMPT_VERSION,
  REPOSITORY_FLOW_SCHEMA_VERSION,
  REPOSITORY_FLOW_SOURCE_BUDGET_BYTES,
} from './repository-flow-intelligence'

const repository = { id: 'repo-1', tenantId: 'tenant-1', owner: 'fuze', name: 'front', canonicalUrl: 'https://example.test/front', defaultBranch: 'main', kind: 'application' as const, includeGlobs: [], excludeGlobs: [], jiraProjects: [], jiraBindings: [], enabled: true, lastScanStatus: 'complete' as const }
const artifacts = [{ id: 'route-1', repositoryId: 'repo-1', kind: 'route' as const, title: 'Checkout', sourcePath: 'apps/web/Checkout.tsx', summary: 'Open checkout', evidence: [] }]

describe('repository flow wireframes', () => {
  it('attaches source-derived wireframes to deterministic and LiteLLM proposals', async () => {
    expect(deterministicRepositoryFlows(repository, 'abc', artifacts)[0].wireframe.nodes).toEqual([{ label: 'Open checkout', targetIds: ['route-1'] }])
    const fetchImpl = (async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ flows: [{ title: 'Buy', confidence: 0.8, evidenceArtifactIds: ['route-1'], steps: [{ actor: 'buyer', action: 'opens checkout', expectedOutcome: 'checkout appears', targetIds: ['route-1'] }] }] }) } }] }))) as typeof fetch
    const analyzer = new LiteLlmRepositoryFlowAnalyzer('http://litellm/v1', 'quality-analysis', undefined, fetchImpl)
    await expect(analyzer.analyze(repository, 'abc', artifacts)).resolves.toEqual([expect.objectContaining({
      wireframe: { kind: 'sequence', nodes: [{ label: 'opens checkout', targetIds: ['route-1'] }] },
      analysis: {
        provider: 'fuzeinfra-litellm',
        model: 'quality-analysis',
        promptVersion: REPOSITORY_FLOW_PROMPT_VERSION,
        schemaVersion: REPOSITORY_FLOW_SCHEMA_VERSION,
      },
    })])
  })

  it('omits proposals whose evidence and step targets are entirely hallucinated', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      flows: [{
        title: 'Invented flow', confidence: 0.99, evidenceArtifactIds: ['invented-evidence'],
        steps: [{ actor: 'buyer', action: 'uses invented route', expectedOutcome: 'something happens', targetIds: ['invented-target'] }],
      }],
    }) } }] }))) as typeof fetch
    const analyzer = new LiteLlmRepositoryFlowAnalyzer('http://litellm/v1', 'quality-analysis', undefined, fetchImpl)

    await expect(analyzer.analyze(repository, 'abc', artifacts)).resolves.toEqual([])
  })

  it('persists validated step targets as reviewable flow evidence', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      flows: [{
        title: 'Buy', confidence: 0.8, evidenceArtifactIds: [],
        steps: [{ actor: 'buyer', action: 'opens checkout', expectedOutcome: 'checkout appears', targetIds: ['route-1', 'invented-target'] }],
      }],
    }) } }] }))) as typeof fetch
    const analyzer = new LiteLlmRepositoryFlowAnalyzer('http://litellm/v1', 'quality-analysis', undefined, fetchImpl)

    await expect(analyzer.analyze(repository, 'abc', artifacts)).resolves.toEqual([
      expect.objectContaining({
        evidence: ['route-1'],
        steps: [expect.objectContaining({ targetIds: ['route-1'] })],
      }),
    ])
  })

  it('keeps every repository evidence class represented in bounded LiteLLM input', async () => {
    const manyRoutes = Array.from({ length: 110 }, (_, index) => ({
      ...artifacts[0],
      id: `route-${index}`,
      title: `Route ${index}`,
    }))
    const additional = [
      { ...artifacts[0], id: 'story-1', kind: 'story' as const, title: 'Checkout story' },
      { ...artifacts[0], id: 'test-1', kind: 'test-plan' as const, title: 'Checkout test' },
      { ...artifacts[0], id: 'docs-1', kind: 'documentation' as const, title: 'Checkout docs' },
    ]
    let requestKinds: string[] = []
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      const prompt = JSON.parse(body.messages[1].content)
      requestKinds = prompt.artifacts.map((artifact: { kind: string }) => artifact.kind)
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"flows":[]}' } }] }))
    }) as typeof fetch
    const analyzer = new LiteLlmRepositoryFlowAnalyzer('http://litellm/v1', 'quality-analysis', undefined, fetchImpl)

    await analyzer.analyze(repository, 'abc', [...manyRoutes, ...additional])

    expect(requestKinds).toHaveLength(100)
    expect(new Set(requestKinds)).toEqual(new Set(['route', 'story', 'test-plan', 'documentation']))
  })

  it('bounds repository-derived prompt text by UTF-8 bytes', async () => {
    const oversized = Array.from({ length: 40 }, (_, index) => ({
      ...artifacts[0],
      id: `docs-${index}`,
      kind: 'documentation' as const,
      title: `Documentation ${index} ${'é'.repeat(4_000)}`,
      sourcePath: `docs/${'é'.repeat(4_000)}.md`,
      summary: 'é'.repeat(20_000),
      evidence: Array.from({ length: 8 }, () => 'é'.repeat(20_000)),
    }))
    let sourceBytes = 0
    let promptVersion = ''
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      const prompt = JSON.parse(body.messages[1].content)
      promptVersion = prompt.promptVersion
      sourceBytes = prompt.artifacts.reduce((total: number, artifact: Record<string, unknown>) => total + Buffer.byteLength([
        artifact.title,
        artifact.sourcePath,
        artifact.summary,
        ...(artifact.evidence as string[]),
      ].join(''), 'utf8'), 0)
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"flows":[]}' } }] }))
    }) as typeof fetch
    const analyzer = new LiteLlmRepositoryFlowAnalyzer('http://litellm/v1', 'quality-analysis', undefined, fetchImpl)

    await analyzer.analyze(repository, 'abc', oversized)

    expect(sourceBytes).toBeLessThanOrEqual(REPOSITORY_FLOW_SOURCE_BUDGET_BYTES)
    expect(promptVersion).toBe('fuzequality-repository-flow-v2')
  })
})
