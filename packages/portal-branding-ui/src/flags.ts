/**
 * Pre-auth resolution for `fuzefront.platform.multi-tenant-portals`
 * (release flag, default OFF; typed/administered by feature-flags-engineer).
 *
 * KNOWN GAP — tracked dependency, not a design choice: the host's only flag
 * delivery today (`GET /api/flags`, `frontend/src/platform/featureFlags.tsx`)
 * requires an authenticated bearer token, by design (the evaluation context
 * must come from the authenticated session so the cohort can't be spoofed —
 * see that file's header comment). PortalShell/PortalLoginFlow boot BEFORE
 * any session exists, so that path cannot gate them; the AUTHENTICATED shell
 * (TopBar/SidePanel/FederatedAppLoader, wired through Layout.tsx) already
 * uses the real `useFlag('fuzefront.platform.multi-tenant-portals', false)`
 * and needs no substitute.
 *
 * Until a public/pre-auth Unleash evaluation path exists for boot-time flags
 * (a feature-flags-engineer + backend-engineer dependency — same shape as the
 * `/api/v1/portal/context` mock-at-the-client-boundary note this feature
 * carries), this resolves from a build-time default that ships OFF (matching
 * the release-flag default-OFF rule) unless a deploy explicitly sets
 * `VITE_FF_MULTI_TENANT_PORTALS=true`, with a same-origin, no-network runtime
 * override for local dev / exploratory QA.
 */
export function isMultiTenantPortalsEnabled(): boolean {
  if (typeof window !== 'undefined') {
    const w = window as unknown as { __FF_MULTI_TENANT_PORTALS__?: boolean }
    if (typeof w.__FF_MULTI_TENANT_PORTALS__ === 'boolean') {
      return w.__FF_MULTI_TENANT_PORTALS__
    }
  }
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env
  return env?.VITE_FF_MULTI_TENANT_PORTALS === 'true'
}
