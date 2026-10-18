import { useFlag } from '../platform/featureFlags'

/** Unleash release flag for Org invitations v2 (FFRNT-309). Default OFF. */
export const INVITE_V2_FLAG = 'fuzefront.identity.invite-v2'

/**
 * Pre-auth resolution for `fuzefront.identity.invite-v2`.
 *
 * KNOWN GAP — same shape as `@fuzefront/portal-branding-ui`'s
 * `isMultiTenantPortalsEnabled`: the host's only flag delivery
 * (`GET /api/flags`) requires an authenticated bearer token, so an ANONYMOUS
 * invitee (the primary persona of the accept page) can never read the flag.
 * Until a public/pre-auth evaluation path exists (a feature-flags-engineer +
 * backend-engineer dependency), the anonymous accept page resolves from a
 * build-time default that ships OFF (release-flag default-OFF rule) unless a
 * deploy sets `VITE_FF_INVITE_V2=true`, with a same-origin, no-network runtime
 * override (`window.__FF_INVITE_V2__`) for local dev / exploratory QA.
 */
export function isInviteV2PreAuthEnabled(): boolean {
  if (typeof window !== 'undefined') {
    const w = window as unknown as { __FF_INVITE_V2__?: boolean }
    if (typeof w.__FF_INVITE_V2__ === 'boolean') return w.__FF_INVITE_V2__
  }
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env
  return env?.VITE_FF_INVITE_V2 === 'true'
}

/**
 * Flag for surfaces that can be reached both signed-in and anonymously (the
 * accept page): ON when the authenticated flag is ON, or — for the anonymous
 * case where `/api/flags` cannot be read — when the pre-auth default is ON.
 * Default OFF either way.
 */
export function useInviteV2Enabled(): boolean {
  const authenticated = useFlag(INVITE_V2_FLAG, false)
  return authenticated || isInviteV2PreAuthEnabled()
}
