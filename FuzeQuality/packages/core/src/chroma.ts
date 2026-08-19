import { randomUUID } from 'node:crypto'

export type ChromaCollection = { id: string; name: string }

export type ChromaConfig = {
  url: string
  token: string
  tenant: string
  database: string
  readyCollection?: string
}

export class ChromaClient {
  private readonly baseUrl: string

  constructor(private readonly config: ChromaConfig) {
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
    const response = await fetch(`${this.baseUrl}${path}${separator}${scope}`, {
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

  createCollection(name: string) {
    return this.request<ChromaCollection>('/api/v1/collections', {
      method: 'POST',
      body: JSON.stringify({ name, get_or_create: false }),
    })
  }

  deleteCollection(name: string) {
    return this.request<void>(`/api/v1/collections/${encodeURIComponent(name)}`, { method: 'DELETE' })
  }

  upsert(collectionId: string, input: { id: string; document: string; embedding: number[]; metadata?: Record<string, string> }) {
    return this.request<void>(`/api/v1/collections/${encodeURIComponent(collectionId)}/upsert`, {
      method: 'POST',
      body: JSON.stringify({
        ids: [input.id],
        documents: [input.document],
        embeddings: [input.embedding],
        metadatas: [input.metadata ?? {}],
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
