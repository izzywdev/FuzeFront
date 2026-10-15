import { describe, expect, it } from 'vitest'
import {
  deterministicRepositoryFlows,
  LiteLlmRepositoryFlowAnalyzer,
  REPOSITORY_FLOW_PROMPT_VERSION,
  REPOSITORY_FLOW_SCHEMA_VERSION,
  REPOSITORY_FLOW_SOURCE_BUDGET_BYTES,
  RepositoryFlowAnalysisTimeoutError,
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
        inputArtifactCount: 1,
        promptArtifactCount: 1,
        promptTruncated: false,
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

  it('rejects real repository IDs that were omitted from the bounded LiteLLM prompt', async () => {
    const inventory = Array.from({ length: 101 }, (_, index) => ({
      ...artifacts[0],
      id: `route-${String(index).padStart(3, '0')}`,
      title: `Route ${index}`,
      sourcePath: `apps/web/Route${index}.tsx`,
    }))
    let omittedId = ''
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      const prompt = JSON.parse(body.messages[1].content)
      const promptedIds = new Set(prompt.artifacts.map((item: { id: string }) => item.id))
      omittedId = inventory.find(item => !promptedIds.has(item.id))!.id
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
        flows: [{
          title: 'Unseen real route', confidence: 0.9, evidenceArtifactIds: [omittedId],
          steps: [{ actor: 'User', action: 'opens unseen route', expectedOutcome: 'route opens', targetIds: [omittedId] }],
        }],
      }) } }] }))
    }) as typeof fetch
    const analyzer = new LiteLlmRepositoryFlowAnalyzer('http://litellm/v1', 'quality-analysis', undefined, fetchImpl)

    await expect(analyzer.analyze(repository, 'abc', inventory)).resolves.toEqual([])
    expect(omittedId).not.toBe('')
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

  it('keeps same-title proposals with different grounded journeys independently reviewable', async () => {
    const inventory = [
      ...artifacts,
      { ...artifacts[0], id: 'route-2', title: 'Checkout confirmation', sourcePath: 'apps/web/Confirmation.tsx' },
    ]
    const fetchImpl = (async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      flows: [
        {
          title: 'Checkout', confidence: 0.8, evidenceArtifactIds: ['route-1'],
          steps: [{ actor: 'buyer', action: 'opens checkout', expectedOutcome: 'checkout appears', targetIds: ['route-1'] }],
        },
        {
          title: 'Checkout', confidence: 0.75, evidenceArtifactIds: ['route-2'],
          steps: [{ actor: 'buyer', action: 'reviews confirmation', expectedOutcome: 'confirmation appears', targetIds: ['route-2'] }],
        },
      ],
    }) } }] }))) as typeof fetch
    const analyzer = new LiteLlmRepositoryFlowAnalyzer('http://litellm/v1', 'quality-analysis', undefined, fetchImpl)

    const flows = await analyzer.analyze(repository, 'abc', inventory)

    expect(flows).toHaveLength(2)
    expect(flows[0].title).toBe(flows[1].title)
    expect(flows[0].id).not.toBe(flows[1].id)
  })

  it('keeps candidate identity stable when evidence set ordering changes', async () => {
    const inventory = [
      ...artifacts,
      { ...artifacts[0], id: 'route-2', title: 'Confirmation' },
    ]
    const response = (evidenceArtifactIds: string[], targetIds: string[]) =>
      new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ flows: [{
        title: 'Checkout', confidence: 0.8, evidenceArtifactIds,
        steps: [{ actor: 'buyer', action: 'checks out', expectedOutcome: 'confirmation appears', targetIds }],
      }] }) } }] }))
    const first = new LiteLlmRepositoryFlowAnalyzer('http://litellm/v1', 'quality-analysis', undefined, (async () => response(['route-1', 'route-2'], ['route-1', 'route-2'])) as typeof fetch)
    const second = new LiteLlmRepositoryFlowAnalyzer('http://litellm/v1', 'quality-analysis', undefined, (async () => response(['route-2', 'route-1'], ['route-2', 'route-1'])) as typeof fetch)

    const [firstFlow] = await first.analyze(repository, 'abc', inventory)
    const [secondFlow] = await second.analyze(repository, 'abc', inventory)

    expect(firstFlow.id).toBe(secondFlow.id)
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
      { ...artifacts[0], id: 'integration-1', kind: 'integration-test' as const, title: 'Integration workflow' },
      { ...artifacts[0], id: 'post-prod-1', kind: 'post-production-test' as const, title: 'Post-production journey' },
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
    expect(new Set(requestKinds)).toEqual(new Set(['route', 'story', 'test-plan', 'integration-test', 'post-production-test', 'documentation']))
  })

  it('selects the same bounded prompt artifacts regardless of store ordering', async () => {
    const kinds = ['route', 'story', 'documentation', 'test-plan'] as const
    const inventory = Array.from({ length: 120 }, (_, index) => ({
      ...artifacts[0],
      id: `artifact-${String(index).padStart(3, '0')}`,
      kind: kinds[index % kinds.length],
      title: `Artifact ${index}`,
      sourcePath: `src/${String(119 - index).padStart(3, '0')}.tsx`,
    }))
    const requests: string[][] = []
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      const prompt = JSON.parse(body.messages[1].content)
      requests.push(prompt.artifacts.map((artifact: { id: string }) => artifact.id))
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"flows":[]}' } }] }))
    }) as typeof fetch
    const analyzer = new LiteLlmRepositoryFlowAnalyzer('http://litellm/v1', 'quality-analysis', undefined, fetchImpl)

    await analyzer.analyze(repository, 'abc', inventory)
    await analyzer.analyze(repository, 'abc', [...inventory].reverse())

    expect(requests[0]).toHaveLength(100)
    expect(requests[1]).toEqual(requests[0])
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
    expect(promptVersion).toBe('fuzequality-repository-flow-v3')
  })

  it('aborts a stalled FuzeInfra LiteLLM analysis at its configured deadline', async () => {
    const fetchImpl = ((_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
      })) as typeof fetch
    const analyzer = new LiteLlmRepositoryFlowAnalyzer(
      'http://litellm/v1', 'quality-analysis', undefined, fetchImpl, 5,
    )

    await expect(analyzer.analyze(repository, 'abc', artifacts))
      .rejects.toBeInstanceOf(RepositoryFlowAnalysisTimeoutError)
  })
})
