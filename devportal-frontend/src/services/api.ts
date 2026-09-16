// api.ts — thin fetch wrapper against devportal-service, always same-origin
// (CLAUDE.md: "never hard-code an absolute API host" — nginx.conf proxies
// /api/ to devportal-service; this file never constructs a cross-origin URL).

const API_BASE = '/api'

export class ApiError extends Error {
  status: number
  code?: string
  /** Seconds until the caller may retry, from a `retry-after` response header (429s). */
  retryAfterSeconds?: number
  requestId?: string

  constructor(status: number, message: string, code?: string, retryAfterSeconds?: number, requestId?: string) {
    super(message)
    this.status = status
    this.code = code
    this.retryAfterSeconds = retryAfterSeconds
    this.requestId = requestId
  }
}

/** Success envelope that keeps the real HTTP status (`request()` below discards it on
 * success) — needed for /v1/me, where 200 vs 202 vs 204 (see useMyAccess) carries meaning. */
export interface RawResponse<T> {
  status: number
  body: T
}

interface ParsedErrorBody {
  message?: string
  code?: string
  requestId?: string
  [key: string]: unknown
}

async function requestRaw<T>(path: string, init?: RequestInit): Promise<RawResponse<T>> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  })

  let body: ParsedErrorBody | null = null
  try {
    body = res.status === 204 ? null : ((await res.json()) as ParsedErrorBody)
  } catch {
    // non-JSON body — fall through with whatever we have
  }

  if (!res.ok) {
    const retryAfterHeader = res.headers.get('retry-after')
    throw new ApiError(
      res.status,
      body?.message ?? `Request failed (${res.status})`,
      body?.code,
      retryAfterHeader ? Number(retryAfterHeader) : undefined,
      body?.requestId,
    )
  }

  return { status: res.status, body: body as T }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const { body } = await requestRaw<T>(path, init)
  return body
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
  /** Absent on a valid, successfully-harvested spec. `false` = invalid-spec fail-closed state (frame 06c). */
  valid?: boolean
  validationErrors?: string[]
}

export interface Quota {
  used: number
  limit: number
  windowHours: number
}

/** `membershipStatus` is optional on the wire: a 200 with no explicit value means 'active'
 * (the field only became load-bearing once frame 09's provisioning/denied states existed —
 * 'provisioning' arrives as HTTP 202, 'denied' as HTTP 403, so a 200 body is always 'active'
 * in practice, but we still read an explicit value when the service sends one). */
export type MembershipStatus = 'active' | 'provisioning' | 'denied'

export interface MyAccess {
  userId: string
  email: string | null
  developer: boolean
  rootOrgId: string
  quota: Quota
  membershipStatus?: MembershipStatus
}

/** A masked sandbox key row (My access → sandbox keys table). */
export interface SandboxKey {
  id: string
  label: string
  masked: string
  createdAt: string
  lastUsedAt: string | null
}

/** The reveal-once response from creating a sandbox key — `value` is shown exactly once. */
export interface CreatedSandboxKey {
  id: string
  label: string
  value: string
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
  /** Like `getMyAccess`, but keeps the raw status — 202 (provisioning) is a *success*
   * response with a minimal body, so the plain `request()` helper would hand back a
   * same-shaped MyAccess with no way to tell "active" from "provisioning" apart. */
  getMyAccessRaw: () => requestRaw<Partial<MyAccess> & { membershipStatus?: MembershipStatus }>('/v1/me'),
  getQuota: () => request<Quota>('/v1/playground/quota'),
  getHistory: () => request<{ items: PlaygroundCall[] }>('/v1/playground/history'),
  tryOperation: (specId: string, operationId: string) =>
    request<TryResponse>('/v1/playground/try', { method: 'POST', body: JSON.stringify({ specId, operationId }) }),
  logout: () => request<{ ok: boolean }>('/auth/logout', { method: 'POST' }),
  // NOTE — sandbox-key management has no endpoint in services/devportal-service/openapi.yaml
  // yet (out of this PR's scope to add). `createSandboxKey` calls the path the frozen RED
  // spec (my-access.red.spec.ts) mocks so the reveal-once flow is real end-to-end the moment
  // devportal-service implements it; `revokeSandboxKey` mirrors the same convention for
  // symmetry. Until that endpoint exists, MyAccessFlow keeps the key list in local state —
  // see its module comment.
  createSandboxKey: (label: string) =>
    request<CreatedSandboxKey>('/v1/me/sandbox-keys', { method: 'POST', body: JSON.stringify({ label }) }),
  revokeSandboxKey: (keyId: string) => request<void>(`/v1/me/sandbox-keys/${keyId}`, { method: 'DELETE' }),
}

export function signInUrl(): string {
  return `${API_BASE}/auth/oidc/login`
}
