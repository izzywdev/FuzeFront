import { HttpClient, type HttpClientOptions } from './http'
import { createTokensClient, type CreateTokenInput } from './tokens'
import type {
  ApiTokenSummary,
  CreatedApiToken,
  IdentityApiClient,
  Invitation,
  ListMembersOptions,
  Member,
  MembersPage,
  OrgRole,
  RolesCatalog,
} from '../types'

/** Backend bulk-invite per-email result row. */
interface BulkResultRow {
  email: string
  status: 'invited' | 'skipped' | 'error'
  error?: string
}

/**
 * Default implementation of {@link IdentityApiClient}, wrapping the existing
 * backend organization member / invitation routes and the api-token routes.
 * Members `GET` returns an array; invitations `GET` returns `{ invitations }`;
 * bulk invite returns `{ results }` which we summarize into `{ created, skipped, errors }`.
 */
export function createIdentityClient(opts: HttpClientOptions = {}): IdentityApiClient {
  const http = new HttpClient(opts)
  const tokens = createTokensClient(opts)
  const org = (id: string) => `/api/organizations/${encodeURIComponent(id)}`

  return {
    async listMembers(orgId: string, opts: ListMembersOptions = {}): Promise<MembersPage> {
      const params = new URLSearchParams()
      if (opts.page != null) params.set('page', String(opts.page))
      if (opts.pageSize != null) params.set('pageSize', String(opts.pageSize))
      if (opts.search) params.set('search', opts.search)
      const qs = params.toString()
      const res = await http.get<MembersPage | Member[]>(`${org(orgId)}/members${qs ? `?${qs}` : ''}`)
      // Tolerate a legacy bare-array response (pre-pagination backends).
      if (Array.isArray(res)) {
        return { members: res, pagination: { page: 1, pageSize: res.length, total: res.length } }
      }
      return res
    },
    listRoles(orgId: string): Promise<RolesCatalog> {
      return http.get<RolesCatalog>(`${org(orgId)}/roles`)
    },
    async updateMemberRole(orgId: string, memberId: string, role: OrgRole): Promise<void> {
      await http.put(`${org(orgId)}/members/${encodeURIComponent(memberId)}`, { role })
    },
    async removeMember(orgId: string, memberId: string): Promise<void> {
      await http.delete(`${org(orgId)}/members/${encodeURIComponent(memberId)}`)
    },

    async listInvitations(orgId: string, status: 'pending' | 'all' = 'pending'): Promise<Invitation[]> {
      const qs = status === 'all' ? '?status=all' : ''
      const res = await http.get<{ invitations: Invitation[] }>(`${org(orgId)}/invitations${qs}`)
      return res.invitations
    },
    async invite(orgId: string, email: string, role: OrgRole): Promise<void> {
      await http.post(`${org(orgId)}/invitations`, { email, role })
    },
    async bulkInvite(orgId: string, invitations: { email: string; role: OrgRole }[]) {
      // Backend bulk endpoint takes a single role for the whole batch + an emails array.
      const role = invitations[0]?.role ?? 'member'
      const emails = invitations.map((i) => i.email)
      const res = await http.post<{ results: BulkResultRow[] }>(`${org(orgId)}/invitations/bulk`, { emails, role })
      const rows = res.results ?? []
      const created = rows.filter((r) => r.status === 'invited').length
      const skipped = rows.filter((r) => r.status === 'skipped').length
      const errors = rows.filter((r) => r.error).map((r) => `${r.email}: ${r.error}`)
      return { created, skipped, errors }
    },
    async resendInvitation(orgId: string, invitationId: string): Promise<void> {
      await http.post(`${org(orgId)}/invitations/${encodeURIComponent(invitationId)}/resend`)
    },
    async revokeInvitation(orgId: string, invitationId: string): Promise<void> {
      await http.delete(`${org(orgId)}/invitations/${encodeURIComponent(invitationId)}`)
    },

    listTokens(): Promise<ApiTokenSummary[]> {
      return tokens.listTokens()
    },
    listOrgTokens(orgId: string): Promise<ApiTokenSummary[]> {
      return tokens.listOrgTokens(orgId)
    },
    createToken(input: CreateTokenInput): Promise<CreatedApiToken> {
      return tokens.createToken(input)
    },
    revokeToken(tokenId: string): Promise<void> {
      return tokens.revokeToken(tokenId)
    },
  }
}
