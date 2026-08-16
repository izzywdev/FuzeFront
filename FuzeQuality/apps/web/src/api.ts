import type { Portfolio } from '@fuzequality/contracts'

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
}
