import { describe, expect, it, vi } from 'vitest'
import type { Portfolio } from '@fuzequality/contracts'
import { ChromaClient } from './chroma'
import { LiteLlmEmbeddingProvider, SemanticCandidateIndex, portfolioCandidates, repositoryScopeForRequirement } from './semantic-index'

const portfolio = {
  repositories: [{ id: 'repo-1', name: 'FuzeApi', jiraProjects: ['FQ'], jiraBindings: [], lastScanRevision: 'abc123' }],
  operations: [{ id: 'api:one', repositoryId: 'repo-1', method: 'post', path: '/orders', summary: 'Create order', tags: ['orders'], parameters: [], responses: ['201'], security: true }],
  surfaces: [{ id: 'ui:one', repositoryId: 'repo-1', packageName: 'web', kind: 'route', name: 'Checkout', sourcePath: 'Checkout.tsx', routePath: '/checkout', public: true, states: ['loading'], hasStory: false, stories: [] }],
  tests: [{ id: 'test:one', repositoryId: 'repo-1', framework: 'vitest', level: 'unit', title: 'creates order', sourcePath: 'order.test.ts', assertionCount: 1, targets: ['api:one'] }],
  requirements: [{ id: 'req-1', jiraKey: 'FQ-1', issueType: 'Story', summary: 'Checkout', description: 'Create an order', status: 'To Do', project: 'FQ', updatedAt: '2026-01-01T00:00:00Z' }],
  flows: [], expectations: [], findings: [], diagnostics: [], suggestions: [],
} as unknown as Portfolio

describe('semantic candidate index', () => {
  it('builds stable candidates with source revisions and Jira repository scope', () => {
    const first = portfolioCandidates(portfolio)
    const second = portfolioCandidates(portfolio)
    expect(first).toEqual(second)
    expect(first.map(item => item.type)).toEqual(['api-operation', 'test-case', 'frontend-surface'])
    expect(first.every(item => item.sourceRevision === 'abc123')).toBe(true)
    expect(repositoryScopeForRequirement(portfolio, portfolio.requirements[0])).toEqual(['repo-1'])
  })

  it('creates a revisioned collection and applies bounded filtered retrieval', async () => {
    const calls: Array<{ url: string; body?: Record<string, unknown> }> = []
    let completionId: string | undefined
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
      calls.push({ url, body })
      if (url.includes('/query')) return new Response(JSON.stringify({ ids: [['api:one']], documents: [['POST /orders']], metadatas: [[{}]], distances: [[0.1]] }), { status: 200 })
      if (url.includes('/get')) return new Response(JSON.stringify({ ids: completionId ? [completionId] : [], documents: [], metadatas: [] }), { status: 200 })
      if (url.endsWith('/collections?tenant=tenant&database=database')) return new Response(JSON.stringify({ id: 'collection-1', name: body?.name }), { status: 200 })
      if (url.includes('/upsert') && Array.isArray(body?.ids) && String(body.ids[0]).startsWith('index-complete:')) completionId = String(body.ids[0])
      return new Response('{}', { status: 200 })
    }) as typeof fetch
    const chroma = new ChromaClient({ url: 'http://chroma', token: 'token', tenant: 'tenant', database: 'database' }, fetchImpl)
    const embeddings = { embed: vi.fn(async (documents: string[]) => documents.map(() => [0.1, 0.2])) }
    const index = new SemanticCandidateIndex(chroma, embeddings)
    const progress = vi.fn(async () => undefined)
    const rebuilt = await index.rebuild(portfolio, progress)
    expect(completionId).toBe(`index-complete:${rebuilt.fingerprint}`)
    // A complete content-addressed retry does not recompute catalog vectors.
    await index.rebuild(portfolio, progress)
    expect(embeddings.embed).toHaveBeenCalledTimes(1)
    const matches = await index.retrieve(rebuilt.collection, 'order checkout', rebuilt.candidates, {
      topK: 500,
      repositoryIds: ['repo-1'],
      types: ['api-operation', 'frontend-surface'],
    })
    expect(rebuilt.collection.name).toMatch(/^fuzequality_candidates_v1_[0-9a-f]{16}$/)
    expect(progress).toHaveBeenCalledOnce()
    expect(calls.filter(call => call.url.includes('/upsert'))).toHaveLength(2)
    expect(matches.map(item => item.id)).toEqual(['api:one'])
    const query = calls.find(call => call.url.includes('/query'))?.body
    expect(query?.n_results).toBe(40)
    expect(query?.where).toEqual({ $and: [
      { repositoryId: { $in: ['repo-1'] } },
      { candidateType: { $in: ['api-operation', 'frontend-surface'] } },
    ] })
  })
})

describe('LiteLlmEmbeddingProvider', () => {
  it('orders vectors by response index and rejects incomplete responses', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: [
      { index: 1, embedding: [2] }, { index: 0, embedding: [1] },
    ] }), { status: 200 })) as typeof fetch
    await expect(new LiteLlmEmbeddingProvider('http://litellm/v1', 'embed', 'key', fetchImpl).embed(['a', 'b']))
      .resolves.toEqual([[1], [2]])
  })
})
