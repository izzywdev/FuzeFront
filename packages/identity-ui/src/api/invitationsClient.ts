import { HttpClient, HttpError, type HttpClientOptions } from './http'
import type { components } from '@fuzefront/security-client'

/**
 * Contract types are consumed straight from the generated
 * `@fuzefront/security-client` (0.10.2, openapi "Org invitations v2") — never
 * hand-authored. Regenerating the client is the only way these shapes change.
 * Names carry an `Org` prefix to stay distinct from the v1 `Invitation` view
 * model in `../types`.
 */
type S = components['schemas']
export type OrgInvitation = S['Invitation']
export type OrgInvitationPage = S['InvitationPage']
export type OrgInvitationCreate = S['InvitationCreate']
export type InviteeRef = S['InviteeRef']
export type MemberType = S['MemberType']
export type InvitationChannel = S['InvitationChannel']
export type InvitationRole = S['InvitationRole']
export type InvitationStatus = S['InvitationStatus']
export type InvitationResolveResult = S['InvitationResolveResult']
export type InvitationAcceptResult = S['InvitationAcceptResult']
export type InvitationEnrollResponse = S['InvitationEnrollResponse']

/** `POST /invitations/{token}/accept`: `200` bound, or `202` enroll (sign up / sign in first). */
export type AcceptOutcome = InvitationAcceptResult | InvitationEnrollResponse

export interface ListInvitationsOptions {
  /** Max items per page; server-clamped. */
  limit?: number
  /** Opaque `page.nextCursor` from the previous page. Omit for the first page. */
  cursor?: string
  status?: InvitationStatus
}

export interface InvitationsApiClient {
  /** `GET /organizations/{id}/invitations` — cursor envelope (`page.nextCursor` / `hasMore`). */
  list(orgId: string, opts?: ListInvitationsOptions): Promise<OrgInvitationPage>
  /** `POST /organizations/{id}/invitations` — the service mints the id + token. */
  create(orgId: string, body: OrgInvitationCreate): Promise<OrgInvitation>
  /** `POST .../{invitationId}/resend` → `200` with the refreshed invitation. */
  resend(orgId: string, invitationId: string): Promise<OrgInvitation>
  /** `DELETE .../{invitationId}` → `204`. */
  revoke(orgId: string, invitationId: string): Promise<void>
  /** `GET /invitations/{token}` — public; the contact is masked server-side. */
  resolve(token: string): Promise<InvitationResolveResult>
  /** `POST /invitations/{token}/accept` — `200` bound, `202` enroll + `bindToken`. */
  accept(token: string): Promise<AcceptOutcome>
}

/** Narrow an accept outcome: true for the `202` enroll variant. */
export function isEnroll(outcome: AcceptOutcome): outcome is InvitationEnrollResponse {
  return outcome.action === 'enroll'
}

/**
 * Default implementation of {@link InvitationsApiClient}. Same-origin `/api`
 * base (the openapi `servers` entry), bearer token read lazily via `getToken`.
 */
export function createInvitationsClient(opts: HttpClientOptions = {}): InvitationsApiClient {
  const http = new HttpClient(opts)
  const org = (id: string) => `/api/organizations/${encodeURIComponent(id)}`
  const tok = (t: string) => `/api/invitations/${encodeURIComponent(t)}`

  return {
    list(orgId, listOpts = {}) {
      const params = new URLSearchParams()
      if (listOpts.limit != null) params.set('limit', String(listOpts.limit))
      if (listOpts.cursor) params.set('cursor', listOpts.cursor)
      if (listOpts.status) params.set('status', listOpts.status)
      const qs = params.toString()
      return http.get<OrgInvitationPage>(`${org(orgId)}/invitations${qs ? `?${qs}` : ''}`)
    },
    create(orgId, body) {
      return http.post<OrgInvitation>(`${org(orgId)}/invitations`, body)
    },
    resend(orgId, invitationId) {
      return http.post<OrgInvitation>(`${org(orgId)}/invitations/${encodeURIComponent(invitationId)}/resend`)
    },
    async revoke(orgId, invitationId) {
      await http.delete(`${org(orgId)}/invitations/${encodeURIComponent(invitationId)}`)
    },
    resolve(token) {
      return http.get<InvitationResolveResult>(tok(token))
    },
    accept(token) {
      return http.post<AcceptOutcome>(`${tok(token)}/accept`)
    },
  }
}

/** Why an invitation call failed, as the UI must render it (design/frames/org-invitations-v2/06-states.html). */
export type InviteFailure =
  | 'unauthenticated' // 401 — the only status that re-authenticates
  | 'expired' // 410 INVITATION_EXPIRED
  | 'mismatch' // 403 IDENTITY_MISMATCH (accept)
  | 'already-accepted' // 409 INVITATION_ALREADY_ACCEPTED (accept) — success-equivalent
  | 'not-found' // 404
  | 'last-owner' // 409 LAST_OWNER
  | 'forbidden' // 403 FORBIDDEN (admin ops) — rendered in place, never a sign-in redirect
  | 'duplicate' // 409 on create — a pending invitation already exists
  | 'invalid-phone' // 400 INVALID_PHONE
  | 'delivery-failed' // DELIVERY_FAILED — the invite is kept as a draft
  | 'rate-limited' // 429
  | 'unknown'

function bodyMentions(err: HttpError, needle: string): boolean {
  try {
    const text = typeof err.body === 'string' ? err.body : JSON.stringify(err.body ?? '')
    return text.toUpperCase().includes(needle)
  } catch {
    return false
  }
}

/**
 * Map a thrown error to a render state. `ctx` disambiguates the overloaded
 * statuses: on `accept`, 403 means identity mismatch and 409 means already
 * accepted; on admin operations 403 means forbidden and 409 means a duplicate
 * (or LAST_OWNER, recognised from the error body in either context).
 */
export function classifyInviteError(err: unknown, ctx: 'accept' | 'admin'): InviteFailure {
  if (!(err instanceof HttpError)) return 'unknown'
  switch (err.status) {
    case 401:
      return 'unauthenticated'
    case 404:
      return 'not-found'
    case 410:
      return 'expired'
    case 429:
      return 'rate-limited'
    case 403:
      return ctx === 'accept' ? 'mismatch' : 'forbidden'
    case 409:
      if (bodyMentions(err, 'LAST_OWNER')) return 'last-owner'
      return ctx === 'accept' ? 'already-accepted' : 'duplicate'
    case 400:
    case 422:
      return bodyMentions(err, 'INVALID_PHONE') ? 'invalid-phone' : 'unknown'
    default:
      return bodyMentions(err, 'DELIVERY_FAILED') ? 'delivery-failed' : 'unknown'
  }
}
