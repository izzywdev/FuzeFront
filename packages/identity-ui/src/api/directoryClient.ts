import { HttpClient, HttpError, type HttpClientOptions } from './http'
import type { components } from '@fuzefront/security-client'

/**
 * Contract types are consumed straight from the generated
 * `@fuzefront/security-client` — never hand-authored. `openapi.yaml`
 * (`GET /organizations/{id}/directory`) is the source of truth; regenerating
 * the client is the only way these shapes change.
 */
export type DirectoryMember = components['schemas']['DirectoryMember']
export type DirectoryPage = components['schemas']['DirectoryPage']

export interface ListDirectoryOptions {
  /** Server-side search over name/email. The client never filters locally. */
  query?: string
  /** Max items per page; server-clamped. */
  limit?: number
  /** 0-based item offset (offset = (page - 1) * pageSize). */
  offset?: number
}

export interface DirectoryApiClient {
  listDirectory(orgId: string, opts?: ListDirectoryOptions): Promise<DirectoryPage>
}

/**
 * Default implementation of {@link DirectoryApiClient}, wrapping
 * `GET /api/organizations/{id}/directory` — the root/portal member
 * directory commissioned by design/frames/member-directory (FF-EPIC-17-S5).
 * Offset-paginated + server-side searchable (gate-pagination): callers must
 * never fetch the full set and filter client-side.
 */
export function createDirectoryClient(opts: HttpClientOptions = {}): DirectoryApiClient {
  const http = new HttpClient(opts)

  return {
    async listDirectory(orgId, listOpts = {}): Promise<DirectoryPage> {
      const params = new URLSearchParams()
      if (listOpts.query) params.set('query', listOpts.query)
      if (listOpts.limit != null) params.set('limit', String(listOpts.limit))
      if (listOpts.offset != null) params.set('offset', String(listOpts.offset))
      const qs = params.toString()
      return http.get<DirectoryPage>(
        `/api/organizations/${encodeURIComponent(orgId)}/directory${qs ? `?${qs}` : ''}`
      )
    },
  }
}

/** True when `err` is the fail-closed 403 the directory endpoint returns for a non-privileged caller. */
export function isDirectoryForbidden(err: unknown): boolean {
  return err instanceof HttpError && err.status === 403
}
