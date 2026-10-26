/**
 * Minimal fetch helper for the account-security API client.
 *
 * - Base URL defaults to same-origin (`''`) so the host shell's nginx proxy
 *   handles `/api`. Never hard-code `http://…` (mixed-content under TLS).
 * - Auth token is read lazily via `getToken` so the host controls storage.
 * - `HttpError.status` is preserved so callers can branch on the fail-closed
 *   409 guards the Security contract returns.
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
  /** Provider-neutral error code from the Security contract's ErrorBody, when present. */
  code?: string
  /** `Retry-After` (whole seconds, > 0) from the response, when present and valid. */
  retryAfter?: number
  constructor(status: number, message: string, body: unknown, retryAfter?: number) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.body = body
    if (retryAfter !== undefined && Number.isInteger(retryAfter) && retryAfter > 0) this.retryAfter = retryAfter
    if (body && typeof body === 'object' && 'code' in (body as Record<string, unknown>)) {
      this.code = String((body as Record<string, unknown>).code)
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
    // Bound to globalThis: a bare `window.fetch` reference invoked as a method of
    // this instance (`this.fetchImpl(...)`) throws "Illegal invocation" in browsers.
    this.fetchImpl = opts.fetchImpl ?? ((input, init) => globalThis.fetch(input, init))
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

    const res = await this.fetchImpl(`${this.baseUrl}${path}`, { method, headers, body: payload })
    const text = await res.text()
    const data = text ? safeJson(text) : undefined

    if (!res.ok) {
      const message =
        (data && typeof data === 'object' && 'error' in (data as Record<string, unknown>)
          ? String((data as Record<string, unknown>).error)
          : res.statusText) || `Request failed with ${res.status}`
      throw new HttpError(res.status, message, data, parseRetryAfter(res.headers?.get?.('Retry-After')))
    }
    return data as T
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path)
  }
  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body)
  }
  delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path)
  }
}

/** `Retry-After` as delta-seconds: a positive integer, else undefined (HTTP-date / junk = unknown). */
export function parseRetryAfter(raw: string | null | undefined): number | undefined {
  if (!raw || !/^\d+$/.test(raw.trim())) return undefined
  const n = Number(raw.trim())
  return n > 0 ? n : undefined
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}
