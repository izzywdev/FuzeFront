/**
 * Pre-auth resolution for `fuzefront.auth.experience` (release flag, default OFF).
 *
 * The verify-email and password-reset routes are PUBLIC (no session exists yet),
 * and the host's only flag delivery (`GET /api/flags`) requires a bearer token by
 * design, so it cannot gate them. This resolver follows the same pre-auth-safe
 * pattern as `isMultiTenantPortalsEnabled` in `@fuzefront/portal-branding-ui`:
 * a same-origin, no-network runtime override (`window.__FF_AUTH_EXPERIENCE__`,
 * for local dev / QA) over a build-time default that ships OFF unless a deploy sets
 * `VITE_FF_AUTH_EXPERIENCE=true`. Replace with a public Unleash evaluation path
 * when one exists (feature-flags-engineer dependency).
 */
export const AUTH_EXPERIENCE_FLAG = 'fuzefront.auth.experience'

export function isAuthExperienceEnabled(): boolean {
  if (typeof window !== 'undefined') {
    const w = window as unknown as { __FF_AUTH_EXPERIENCE__?: boolean }
    if (typeof w.__FF_AUTH_EXPERIENCE__ === 'boolean') return w.__FF_AUTH_EXPERIENCE__
  }
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env
  return env?.VITE_FF_AUTH_EXPERIENCE === 'true'
}
