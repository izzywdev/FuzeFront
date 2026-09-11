import { randomUUID } from 'node:crypto'

export type ChromaCollection = { id: string; name: string }

export type ChromaQueryResult = {
  ids: string[][]
  documents: Array<Array<string | null>>
  metadatas: Array<Array<Record<string, string> | null>>
  distances: number[][]
}

export type ChromaConfig = {
  url: string
  token: string
  tenant: string
  database: string
  readyCollection?: string
}

export class ChromaClient {
  private readonly baseUrl: string

  constructor(private readonly config: ChromaConfig, private readonly fetchImpl: typeof fetch = fetch) {
    this.baseUrl = config.url.replace(/\/$/, '')
    if (!config.token.trim()) throw new Error('CHROMA_TOKEN is required')
    if (!config.tenant.trim()) throw new Error('CHROMA_TENANT is required')
    if (!config.database.trim()) throw new Error('CHROMA_DATABASE is required')
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env) {
    return new ChromaClient({
      url: env.CHROMA_URL ?? 'http://fuzeinfra-chromadb.fuzeinfra.svc.cluster.local:8000',
      token: env.CHROMA_TOKEN ?? '',
      tenant: env.CHROMA_TENANT ?? '',
      database: env.CHROMA_DATABASE ?? '',
      readyCollection: env.CHROMA_READY_COLLECTION ?? 'fuzequality_ready',
    })
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const separator = path.includes('?') ? '&' : '?'
    const scope = `tenant=${encodeURIComponent(this.config.tenant)}&database=${encodeURIComponent(this.config.database)}`
    const response = await this.fetchImpl(`${this.baseUrl}${path}${separator}${scope}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.config.token.trim()}`,
        'content-type': 'application/json',
        ...init?.headers,
      },
    })
    if (!response.ok) {
      const body = (await response.text()).slice(0, 300)
      throw new Error(`Chroma ${init?.method ?? 'GET'} ${path} returned ${response.status}: ${body}`)
    }
    if (response.status === 204) return undefined as T
    return response.json() as Promise<T>
  }

  listCollections() {
    return this.request<ChromaCollection[]>('/api/v1/collections')
  }

  async assertReady() {
    const expected = this.config.readyCollection ?? 'fuzequality_ready'
    const collections = await this.listCollections()
    if (!collections.some((collection) => collection.name === expected)) {
      throw new Error(`Chroma readiness collection ${expected} is unavailable in the assigned allocation`)
    }
  }

  createCollection(name: string, getOrCreate = false) {
    return this.request<ChromaCollection>('/api/v1/collections', {
      method: 'POST',
      body: JSON.stringify({ name, get_or_create: getOrCreate }),
    })
  }

  deleteCollection(name: string) {
    return this.request<void>(`/api/v1/collections/${encodeURIComponent(name)}`, { method: 'DELETE' })
  }

  upsert(collectionId: string, input: { id: string; document: string; embedding: number[]; metadata?: Record<string, string> }) {
    return this.upsertMany(collectionId, [input])
  }

  upsertMany(collectionId: string, inputs: Array<{ id: string; document: string; embedding: number[]; metadata?: Record<string, string> }>) {
    if (!inputs.length) return Promise.resolve()
    return this.request<void>(`/api/v1/collections/${encodeURIComponent(collectionId)}/upsert`, {
      method: 'POST',
      body: JSON.stringify({
        ids: inputs.map(input => input.id),
        documents: inputs.map(input => input.document),
        embeddings: inputs.map(input => input.embedding),
        metadatas: inputs.map(input => input.metadata ?? {}),
      }),
    })
  }

  query(collectionId: string, embedding: number[], topK: number, where?: Record<string, unknown>) {
    const boundedTopK = Math.min(40, Math.max(1, Math.trunc(topK)))
    return this.request<ChromaQueryResult>(`/api/v1/collections/${encodeURIComponent(collectionId)}/query`, {
      method: 'POST',
      body: JSON.stringify({
        query_embeddings: [embedding],
        n_results: boundedTopK,
        include: ['documents', 'metadatas', 'distances'],
        ...(where ? { where } : {}),
      }),
    })
  }

  get(collectionId: string, id: string) {
    return this.request<{ ids: string[]; documents: Array<string | null>; metadatas: Array<Record<string, string> | null> }>(
      `/api/v1/collections/${encodeURIComponent(collectionId)}/get`,
      { method: 'POST', body: JSON.stringify({ ids: [id], include: ['documents', 'metadatas'] }) }
    )
  }

  temporaryCollectionName(prefix = 'fuzequality_integration') {
    return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 16)}`
  }
}
