import { createHash } from 'node:crypto'
import type { ApiOperation, Flow, FrontendSurface, Portfolio, Requirement, TestCase } from '@fuzequality/contracts'
import { ChromaClient, type ChromaCollection } from './chroma'

export type SemanticCandidateType = 'api-operation' | 'frontend-surface' | 'test-case' | 'flow'

export type SemanticCandidate = {
  id: string
  type: SemanticCandidateType
  document: string
  repositoryId?: string
  project?: string
  sourceRevision: string
}

export interface EmbeddingProvider {
  embed(documents: string[]): Promise<number[][]>
}

export class LiteLlmEmbeddingProvider implements EmbeddingProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly apiKey?: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async embed(documents: string[]): Promise<number[][]> {
    if (!documents.length) return []
    const response = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, '')}/embeddings`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({ model: this.model, input: documents }),
    })
    if (!response.ok) throw new Error(`LiteLLM embeddings returned ${response.status}`)
    const body = await response.json() as { data?: Array<{ index: number; embedding: number[] }> }
    const ordered = [...(body.data ?? [])].sort((left, right) => left.index - right.index)
    if (ordered.length !== documents.length || ordered.some(item => !Array.isArray(item.embedding) || !item.embedding.length)) {
      throw new Error('LiteLLM embeddings response did not match the requested inputs')
    }
    return ordered.map(item => item.embedding)
  }
}

const operationDocument = (item: ApiOperation) =>
  `${item.method.toUpperCase()} ${item.path}\n${item.operationId ?? ''}\n${item.summary}\n${item.tags.join(' ')}`.trim()
const surfaceDocument = (item: FrontendSurface) =>
  `${item.kind} ${item.name}\n${item.packageName}\n${item.routePath ?? ''}\n${item.states.join(' ')}`.trim()
const testDocument = (item: TestCase) =>
  `${item.level} ${item.framework}\n${item.title}\n${item.sourcePath}\n${item.targets.join(' ')}`.trim()
const flowDocument = (item: Flow) =>
  `${item.title}\n${item.steps.map(step => `${step.actor}: ${step.action} -> ${step.expectedOutcome}`).join('\n')}`.trim()

export function portfolioCandidates(portfolio: Portfolio): SemanticCandidate[] {
  const revisions = new Map(portfolio.repositories.map(repository => [repository.id, repository.lastScanRevision ?? 'unknown']))
  const requirementSources = new Map(portfolio.requirements.map(requirement => [requirement.id, {
    project: requirement.project,
    revision: requirement.updatedAt,
  }]))
  return [
    ...portfolio.operations.map(item => ({ id: item.id, type: 'api-operation' as const, document: operationDocument(item), repositoryId: item.repositoryId, sourceRevision: revisions.get(item.repositoryId) ?? 'unknown' })),
    ...portfolio.surfaces.map(item => ({ id: item.id, type: 'frontend-surface' as const, document: surfaceDocument(item), repositoryId: item.repositoryId, sourceRevision: revisions.get(item.repositoryId) ?? 'unknown' })),
    ...portfolio.tests.map(item => ({ id: item.id, type: 'test-case' as const, document: testDocument(item), repositoryId: item.repositoryId, sourceRevision: revisions.get(item.repositoryId) ?? 'unknown' })),
    ...portfolio.flows.map(item => ({
      id: item.id,
      type: 'flow' as const,
      document: flowDocument(item),
      project: requirementSources.get(item.requirementId)?.project,
      sourceRevision: requirementSources.get(item.requirementId)?.revision ?? 'unknown',
    })),
  ].sort((left, right) => left.id.localeCompare(right.id))
}

function indexFingerprint(candidates: SemanticCandidate[], embeddingVersion: string) {
  const hash = createHash('sha256')
  hash.update(`embedding:${embeddingVersion}\0`)
  for (const candidate of candidates) hash.update(`${candidate.id}\0${candidate.sourceRevision}\0${candidate.document}\0`)
  return hash.digest('hex').slice(0, 16)
}

export type SemanticMatch = SemanticCandidate & { distance: number }

export class SemanticCandidateIndex {
  constructor(
    private readonly chroma: ChromaClient,
    private readonly embeddings: EmbeddingProvider,
    private readonly collectionPrefix = 'fuzequality_candidates_v1',
    private readonly embeddingVersion = 'v1',
  ) {}

  async rebuild(
    portfolio: Portfolio,
    onProgress?: () => Promise<void>,
  ): Promise<{ collection: ChromaCollection; candidates: SemanticCandidate[]; fingerprint: string }> {
    const candidates = portfolioCandidates(portfolio)
    const fingerprint = indexFingerprint(candidates, this.embeddingVersion)
    const collection = await this.chroma.createCollection(`${this.collectionPrefix}_${fingerprint}`, true)
    const completionId = `index-complete:${fingerprint}`
    const completion = await this.chroma.get(collection.id, completionId)
    if (completion.ids?.includes(completionId)) return { collection, candidates, fingerprint }
    let dimensions = 0
    for (let offset = 0; offset < candidates.length; offset += 32) {
      const batch = candidates.slice(offset, offset + 32)
      const vectors = await this.embeddings.embed(batch.map(item => item.document))
      dimensions = vectors[0]?.length ?? dimensions
      await this.chroma.upsertMany(collection.id, batch.map((item, index) => ({
        id: item.id,
        document: item.document,
        embedding: vectors[index],
        metadata: {
          candidateType: item.type,
          sourceRevision: item.sourceRevision,
          ...(item.repositoryId ? { repositoryId: item.repositoryId } : {}),
          ...(item.project ? { project: item.project } : {}),
        },
      })))
      await onProgress?.()
    }
    if (dimensions) {
      await this.chroma.upsert(collection.id, {
        id: completionId,
        document: `completed semantic candidate index ${fingerprint}`,
        embedding: Array.from({ length: dimensions }, () => 0),
        metadata: { candidateType: 'index-marker', sourceRevision: fingerprint },
      })
    }
    return { collection, candidates, fingerprint }
  }

  async retrieve(
    collection: ChromaCollection,
    query: string,
    candidates: SemanticCandidate[],
    options: { topK?: number; repositoryIds?: string[]; project?: string; types?: SemanticCandidateType[] } = {},
  ): Promise<SemanticMatch[]> {
    const topK = Math.min(40, Math.max(1, Math.trunc(options.topK ?? 20)))
    const clauses: Record<string, unknown>[] = []
    if (options.repositoryIds?.length) clauses.push({ repositoryId: { $in: [...new Set(options.repositoryIds)] } })
    if (options.project) clauses.push({ project: options.project })
    if (options.types?.length) clauses.push({ candidateType: { $in: [...new Set(options.types)] } })
    const where = clauses.length > 1 ? { $and: clauses } : clauses[0]
    const [embedding] = await this.embeddings.embed([query])
    const result = await this.chroma.query(collection.id, embedding, topK, where)
    const byId = new Map(candidates.map(candidate => [candidate.id, candidate]))
    return (result.ids[0] ?? []).flatMap((id, index) => {
      const candidate = byId.get(id)
      return candidate ? [{ ...candidate, distance: result.distances[0]?.[index] ?? Number.POSITIVE_INFINITY }] : []
    })
  }
}

export function repositoryScopeForRequirement(portfolio: Portfolio, requirement: Requirement): string[] {
  return portfolio.repositories
    .filter(repository => repository.jiraProjects.includes(requirement.project)
      || repository.jiraBindings.some(binding => binding.project === requirement.project))
    .map(repository => repository.id)
}
