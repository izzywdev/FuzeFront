/**
 * Minimal fetch helper shared by this package's API clients.
 *
 * - Base URL defaults to same-origin (`''`) so the host shell's nginx/ingress
 *   proxy handles `/api` — never hard-code an absolute host (mixed-content
 *   under TLS, baseline §7.1 / CLAUDE.md "same-origin API base").
 * - Auth token is read lazily via `getToken` so the host controls storage
 *   (mirrors @fuzefront/account-security-ui's client convention).
 * - `HttpError.status` is preserved so callers can branch on 401/403/404/409
 *   without re-parsing the response.
 */
export interface HttpClientOptions {
  /** Base URL prefix, e.g. '' (same-origin) or an injected origin for tests. Default ''. */
  baseUrl?: string
  /** Returns the bearer token to attach, or null/undefined to omit. */
  getToken?: () => string | null | undefined
  /** Injectable fetch (for tests). Defaults to global fetch. */
  fetchImpl?: typeof fetch
}

export class HttpError extends Error {
  status: number
  body: unknown
  /** Stable machine-readable error code, when the response body carries one. */
  code?: string
  constructor(status: number, message: string, body: unknown) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.body = body
    if (body && typeof body === 'object') {
      const record = body as Record<string, unknown>
      const code = record.error ?? record.code
      if (typeof code === 'string') this.code = code
    }
  }
}

export class HttpClient {
  private baseUrl: string
  private getToken?: () => string | null | undefined
  private fetchImpl: typeof fetch

  constructor(opts: HttpClientOptions = {}) {
    this.baseUrl = opts.baseUrl ?? ''
    this.getToken = opts.getToken
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch
  }

  async request<T>(method: string, path: string, body?: unknown, params?: Record<string, string | number | undefined>): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' }
    const token = this.getToken?.()
    if (token) headers.Authorization = `Bearer ${token}`
    let payload: string | undefined
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json'
      payload = JSON.stringify(body)
    }

    let url = `${this.baseUrl}${path}`
    if (params) {
      const query = new URLSearchParams()
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') query.set(key, String(value))
      }
      const qs = query.toString()
      if (qs) url += `?${qs}`
    }

    const res = await this.fetchImpl(url, { method, headers, body: payload })
    const text = await res.text()
    const data = text ? safeJson(text) : undefined

    if (!res.ok) {
      const message =
        (data && typeof data === 'object' && 'message' in (data as Record<string, unknown>)
          ? String((data as Record<string, unknown>).message)
          : data && typeof data === 'object' && 'error' in (data as Record<string, unknown>)
            ? String((data as Record<string, unknown>).error)
            : res.statusText) || `Request failed with ${res.status}`
      throw new HttpError(res.status, message, data)
    }
    return data as T
  }

  get<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
    return this.request<T>('GET', path, undefined, params)
  }
  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body)
  }
  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PATCH', path, body)
  }
  delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path)
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}
