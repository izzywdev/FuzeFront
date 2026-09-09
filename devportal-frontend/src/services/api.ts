// api.ts — thin fetch wrapper against devportal-service, always same-origin
// (CLAUDE.md: "never hard-code an absolute API host" — nginx.conf proxies
// /api/ to devportal-service; this file never constructs a cross-origin URL).

const API_BASE = '/api'

export class ApiError extends Error {
  status: number
  code?: string

  constructor(status: number, message: string, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  })

  if (!res.ok) {
    let body: any = null
    try {
      body = await res.json()
    } catch {
      // non-JSON error body — fall through with a generic message
    }
    throw new ApiError(res.status, body?.message ?? `Request failed (${res.status})`, body?.code)
  }

  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export interface CatalogEntry {
  id: string
  repo: string
  service: string
  version: string
  title: string
  description: string
  tags: string[]
  fetchedAt: string
}

export interface SpecRecord {
  id: string
  repo: string
  service: string
  specPath: string
  version: string
  rawSpec: Record<string, unknown>
  fetchedAt: string
}

export interface Quota {
  used: number
  limit: number
  windowHours: number
}

export interface MyAccess {
  userId: string
  email: string | null
  developer: boolean
  rootOrgId: string
  quota: Quota
}

export interface PlaygroundCall {
  id: string
  operation_id: string
  method: string
  path: string
  response_status: number
  called_at: string
}

export interface TryResponse {
  status: number
  body: unknown
  source: 'example' | 'schema-synthesized' | 'no-example-available'
  sandboxed: boolean
  target: string
}

export const api = {
  listCatalog: () => request<{ items: CatalogEntry[] }>('/v1/catalog'),
  getSpec: (repo: string, service: string) => request<SpecRecord>(`/v1/catalog/${repo}/${service}`),
  getMyAccess: () => request<MyAccess>('/v1/me'),
  getQuota: () => request<Quota>('/v1/playground/quota'),
  getHistory: () => request<{ items: PlaygroundCall[] }>('/v1/playground/history'),
  tryOperation: (specId: string, operationId: string) =>
    request<TryResponse>('/v1/playground/try', { method: 'POST', body: JSON.stringify({ specId, operationId }) }),
  logout: () => request<{ ok: boolean }>('/auth/logout', { method: 'POST' }),
}

export function signInUrl(): string {
  return `${API_BASE}/auth/oidc/login`
}
