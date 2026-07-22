/**
 * Account-security API client — thin, contract-bound wrapper over the Security
 * API paths the hub reads. All shapes come from `@fuzefront/security-client`.
 */
import { HttpClient, type HttpClientOptions } from './http'
import type { AccountSecurityClient, AuthMethods, IdentityConnections } from '../types'

const BASE = '/api/v1/security'

/** Response envelope of GET /v1/security/sessions ({ items: SessionDevice[] }). */
interface SessionsResponse {
  items: { id: string; current: boolean }[]
}

export function createAccountSecurityClient(
  opts: HttpClientOptions = {}
): AccountSecurityClient {
  const http = new HttpClient(opts)
  return {
    getConnections() {
      return http.get<IdentityConnections>(`${BASE}/identity/connections`)
    },
    getMethods() {
      return http.get<AuthMethods>(`${BASE}/methods`)
    },
    async getActiveSessionCount() {
      const res = await http.get<SessionsResponse>(`${BASE}/sessions`)
      return Array.isArray(res?.items) ? res.items.length : 0
    },
    async unlinkProvider(provider) {
      // Contract: DELETE /v1/security/social/{provider}/link (packages/security/openapi.yaml).
      // Fail-closed: rejects with HttpError(status 409) when this is the account's
      // last sign-in method — SignInMethodsList surfaces the last-method guard.
      await http.delete(`${BASE}/social/${provider}/link`)
    },
  }
}
