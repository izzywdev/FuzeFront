/**
 * Minimal fetch helper used by the identity API clients.
 *
 * - Base URL defaults to same-origin (`''`) so the host shell's nginx proxy
 *   handles `/api`. Never hard-code `http://…` (mixed-content under TLS).
 * - Auth token is read lazily via `getToken` so the host controls storage.
 */
export interface HttpClientOptions {
  /** Base URL prefix, e.g. '' (same-origin) or 'https://api.example.com'. Default ''. */
  baseUrl?: string
  /** Returns the bearer token to attach, or null/undefined to omit. */
  getToken?: () => string | null | undefined
  /** Injectable fetch (for tests). Defaults to global fetch. */
  fetchImpl?: typeof fetch
}

export class HttpError extends Error {
  status: number
  body: unknown
  constructor(status: number, message: string, body: unknown) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.body = body
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

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' }
    const token = this.getToken?.()
    if (token) headers.Authorization = `Bearer ${token}`
    let payload: string | undefined
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json'
      payload = JSON.stringify(body)
    }

    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: payload,
    })

    const text = await res.text()
    const data = text ? safeJson(text) : undefined

    if (!res.ok) {
      const message =
        (data && typeof data === 'object' && 'error' in (data as Record<string, unknown>)
          ? String((data as Record<string, unknown>).error)
          : res.statusText) || `Request failed with ${res.status}`
      throw new HttpError(res.status, message, data)
    }

    return data as T
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path)
  }
  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body)
  }
  put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PUT', path, body)
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
