import type {
  AdminTenantContext,
  OrganizationQualitySummary,
  Portfolio,
  TestImplementationRequest,
} from '@fuzequality/contracts'

export type OrganizationRole = 'owner' | 'admin' | 'member' | 'viewer'
export type OrganizationMember = { id: string; email?: string; name?: string; displayName?: string; userId?: string; user_id?: string; role: OrganizationRole; status?: string }


// The standalone dashboard uses same-origin API calls. When mounted as a
// FuzeFront federated remote, the browser origin is app.fuzefront.com, so the
// API origin is injected at build time and remains independent of the host.
const API_BASE = (import.meta.env.VITE_FUZEQUALITY_API_URL ?? '').replace(/\/$/, '')

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  })
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? `Request failed: ${response.status}`)
  return response.json() as Promise<T>
}

export const api = {
  portfolio: () => request<Portfolio>('/api/v1/portfolio'),
  addRepository: (value: Record<string, unknown>) =>
    request('/api/v1/repositories', { method: 'POST', body: JSON.stringify(value) }),
  scanRepository: (id: string, localPath?: string) =>
    request(`/api/v1/repositories/${id}/scans`, {
      method: 'POST',
      body: JSON.stringify({ localPath }),
    }),
  decideSuggestion: (id: string, decision: 'confirm' | 'reject') =>
    request(`/api/v1/suggestions/${id}/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision }),
    }),
  verifyRepository: (value: Record<string, unknown>) =>
    request('/api/v1/repositories/verify', { method: 'POST', body: JSON.stringify(value) }),
  updateRepositoryAdministration: (id: string, value: Record<string, unknown>) =>
    request(`/api/v1/repositories/${id}/administration`, { method: 'PATCH', body: JSON.stringify(value) }),
  implementTests: (value: Record<string, unknown>) =>
    request<TestImplementationRequest>('/api/v1/test-implementations', { method: 'POST', body: JSON.stringify(value) }),
  testImplementation: (id: string) =>
    request<TestImplementationRequest>(`/api/v1/test-implementations/${id}`),
  organizationMembers: () => request<{ items?: OrganizationMember[]; members?: OrganizationMember[] } | OrganizationMember[]>('/api/v1/organization/members'),
  inviteOrganizationMember: (email: string, role: OrganizationRole) =>
    request('/api/v1/organization/invitations', { method: 'POST', body: JSON.stringify({ email, role }) }),
  updateOrganizationMember: (id: string, role: OrganizationRole) =>
    request(`/api/v1/organization/members/${id}`, { method: 'PUT', body: JSON.stringify({ role }) }),
  removeOrganizationMember: (id: string) =>
    request(`/api/v1/organization/members/${id}`, { method: 'DELETE' }),
  platformOrganizations: () => request<OrganizationQualitySummary[]>('/api/v1/admin/organizations'),
  enterOrganizationContext: (organizationId: string, reason: string) =>
    request<AdminTenantContext>(`/api/v1/admin/organizations/${encodeURIComponent(organizationId)}/context`, { method: 'POST', body: JSON.stringify({ reason }) }),
}
