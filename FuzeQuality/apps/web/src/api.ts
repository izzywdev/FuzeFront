import type {
  AdminTenantContext,
  OrganizationQualitySummary,
  Portfolio,
  TestImplementationRequest,
} from '@fuzequality/contracts'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = localStorage.getItem('authToken')
  const response = await fetch(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    const message = typeof body?.error === 'string'
      ? body.error
      : response.status === 401
        ? 'Sign in through FuzeFront before managing repositories.'
        : `Request failed: ${response.status}`
    throw new Error(message)
  }
  return response.json() as Promise<T>
}

export const api = {
  portfolio: () => request<Portfolio>('/api/v1/portfolio'),
  verifyRepository: (value: Record<string, unknown>) =>
    request('/api/v1/repositories/verify', { method: 'POST', body: JSON.stringify(value) }),
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
  implementTests: (value: { repositoryId: string; sourceRevision: string; expectationIds: string[] }) =>
    request<TestImplementationRequest>('/api/v1/test-implementations', {
      method: 'POST',
      body: JSON.stringify(value),
    }),
  testImplementation: (id: string) =>
    request<TestImplementationRequest>(`/api/v1/test-implementations/${id}`),
  platformOrganizations: () =>
    request<OrganizationQualitySummary[]>('/api/v1/admin/organizations'),
  enterOrganizationContext: (organizationId: string, reason: string) =>
    request<AdminTenantContext>(`/api/v1/admin/organizations/${encodeURIComponent(organizationId)}/context`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
}
