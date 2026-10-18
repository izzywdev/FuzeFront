/**
 * Account-security API client — thin, contract-bound wrapper over the Security
 * API paths the hub reads. All shapes come from `@fuzefront/security-client`.
 */
import { HttpClient, type HttpClientOptions } from './http'
import type {
  AuthMethods,
  FullAccountSecurityClient,
  IdentityConnections,
  MfaChallengeAck,
  MfaEnrollResult,
  MfaFactor,
  MfaSession,
  SocialLinkStart,
  VerificationStatus,
} from '../types'

const BASE = '/api/v1/security'

/** Response envelope of GET /v1/security/sessions ({ items: SessionDevice[] }). */
interface SessionsResponse {
  items: { id: string; current: boolean }[]
}

export function createAccountSecurityClient(
  opts: HttpClientOptions = {}
): FullAccountSecurityClient {
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
    async linkProvider(provider) {
      // Contract: POST /v1/security/social/{provider}/link (packages/security/openapi.yaml).
      // Returns { redirectUrl } for the caller to navigate the browser to.
      // Fail-closed: rejects with HttpError(status 409) when already linked —
      // ConnectedAccountsPanel surfaces the already-linked state.
      return http.post<SocialLinkStart>(`${BASE}/social/${provider}/link`)
    },
    async setPassword(newPassword) {
      // Contract: POST /v1/security/password (packages/security/openapi.yaml).
      // Rejects with HttpError(status 409) if a password already exists.
      return http.post<IdentityConnections>(`${BASE}/password`, { newPassword })
    },

    // ── Password reset / change (FFRNT-140) ─────────────────────────────────
    async requestPasswordReset(email) {
      // Contract: POST /session/password/reset-request — ALWAYS 202 (no enumeration).
      await http.post(`${BASE}/session/password/reset-request`, { email })
    },
    async confirmPasswordReset(token, newPassword) {
      // Contract: POST /session/password/reset-confirm — 200 { reset: true } | 400.
      await http.post(`${BASE}/session/password/reset-confirm`, { token, newPassword })
    },
    async changePassword(currentPassword, newPassword) {
      // CONTRACT GAP: the frozen contract has no change-with-current-password
      // operation (only set-first via POST /password, and token-based reset).
      // This targets the PROPOSED `POST /v1/security/password/change`
      // { currentPassword, newPassword } → 200 | 400 INVALID_CREDENTIALS (wrong
      // current) | 400 MALFORMED (policy). Needs contract-designer + backend.
      await http.post(`${BASE}/password/change`, { currentPassword, newPassword })
    },

    // ── MFA factor management (FFRNT-141) ───────────────────────────────────
    async listFactors() {
      const res = await http.get<{ items: MfaFactor[] }>(`${BASE}/mfa/factors`)
      return Array.isArray(res?.items) ? res.items : []
    },
    enrollFactor(req) {
      return http.post<MfaEnrollResult>(`${BASE}/mfa/factors`, req)
    },
    activateFactor(factorId, code) {
      return http.post<MfaFactor>(`${BASE}/mfa/factors/${encodeURIComponent(factorId)}/activate`, { code })
    },
    async removeFactor(factorId) {
      await http.delete(`${BASE}/mfa/factors/${encodeURIComponent(factorId)}`)
    },
    async regenerateRecoveryCodes() {
      const res = await http.post<{ codes: string[] }>(`${BASE}/mfa/recovery-codes`)
      return Array.isArray(res?.codes) ? res.codes : []
    },

    // ── Login step-up (FFRNT-141 / FFRNT-362) ───────────────────────────────
    challengeMfa(challengeId, factorId) {
      return http.post<MfaChallengeAck>(`${BASE}/mfa/challenge`, { challengeId, factorId })
    },
    verifyMfa(challengeId, factorId, code) {
      return http.post<MfaSession>(`${BASE}/mfa/verify`, { challengeId, factorId, code })
    },

    // ── Contact verification (FFRNT-362) ────────────────────────────────────
    async startPhoneVerification(phone) {
      await http.post(`${BASE}/verify/phone/start`, { phone })
    },
    confirmPhoneVerification(phone, code) {
      return http.post<VerificationStatus>(`${BASE}/verify/phone/confirm`, { phone, code })
    },
    getVerificationStatus() {
      return http.get<VerificationStatus>(`${BASE}/verify/status`)
    },
  }
}
