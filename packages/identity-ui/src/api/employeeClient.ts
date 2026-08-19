import { HttpClient, HttpError, type HttpClientOptions } from './http'
import type { components } from '@fuzefront/security-client'

/**
 * Contract types are consumed straight from the generated
 * `@fuzefront/security-client` 0.6.0 — never hand-authored. `openapi.yaml`
 * (`GET /v1/security/employee/status`, `GET /v1/security/employee/orgs`) is
 * the source of truth; regenerating the client is the only way these shapes
 * change (FF-EPIC-17-S9, PR #698).
 *
 * `EmployeeOrgListItem` is the server DTO (wire shape: `orgId`/`parentOrgId`,
 * `kind: 'root' | 'portal' | 'organization'`, `depth`) — deliberately NOT
 * named `EmployeeOrgNode` to avoid colliding with `../types`' UI-local row
 * model of that name (`id`/`parentId`, four-way `kind`). See `orgTree.ts`
 * for the mapping between the two.
 */
export type EmployeeStatus = components['schemas']['EmployeeStatus']
export type EmployeeOrgListItem = components['schemas']['EmployeeOrgNode']
export type EmployeeOrgPage = components['schemas']['EmployeeOrgPage']

export interface ListEmployeeOrgsOptions {
  /** Max items per page; server-clamped (default 50, max 200). */
  limit?: number
  /** Opaque, server-issued cursor for the next page. Omit for the first page. */
  cursor?: string
}

export interface EmployeeApiClient {
  /**
   * Server-authoritative Employee status for the caller
   * (`resolveEmployeeStatus`). `isEmployee` is derived ONLY from the ReBAC
   * `org-admin` grant on the platform root org — never membership rows —
   * and is the sole authority the console gate must trust. Any
   * authenticated caller may read their own status (200/401 only; the
   * endpoint reports status, it never 403s).
   */
  getStatus(): Promise<EmployeeStatus>
  /**
   * One page of the ReBAC-authoritative org/portal subtree an Employee can
   * reach (root + descendants). Deliberately flat — each item carries
   * `parentOrgId` — so the caller page-walks to `page.hasMore === false`
   * and assembles the tree (`assembleEmployeeOrgTree`). 403 FORBIDDEN,
   * fail-closed, for a non-Employee caller.
   */
  listOrgs(opts?: ListEmployeeOrgsOptions): Promise<EmployeeOrgPage>
}

/**
 * Default implementation of {@link EmployeeApiClient}, wrapping
 * `GET /api/v1/security/employee/status` and
 * `GET /api/v1/security/employee/orgs` — the two server-authoritative reads
 * FF-EPIC-17-S9 wires the cross-org staff console to (replacing the prior
 * client-side `isEmployeeUser()` derivation and the membership-scoped
 * `GET /api/organizations` fetch).
 */
export function createEmployeeClient(opts: HttpClientOptions = {}): EmployeeApiClient {
  const http = new HttpClient(opts)

  return {
    async getStatus(): Promise<EmployeeStatus> {
      return http.get<EmployeeStatus>('/api/v1/security/employee/status')
    },
    async listOrgs(listOpts: ListEmployeeOrgsOptions = {}): Promise<EmployeeOrgPage> {
      const params = new URLSearchParams()
      if (listOpts.limit != null) params.set('limit', String(listOpts.limit))
      if (listOpts.cursor) params.set('cursor', listOpts.cursor)
      const qs = params.toString()
      return http.get<EmployeeOrgPage>(`/api/v1/security/employee/orgs${qs ? `?${qs}` : ''}`)
    },
  }
}

/** True when `err` is the fail-closed 403 `listEmployeeOrgs` returns for a non-Employee caller. */
export function isEmployeeForbidden(err: unknown): boolean {
  return err instanceof HttpError && err.status === 403
}
