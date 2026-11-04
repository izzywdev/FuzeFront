/**
 * Pre-auth resolution for release flags on surfaces that render BEFORE a session
 * exists (`/reset`, the `/login` MFA step-up).
 *
 * The host's only flag delivery (`GET /api/flags`, `featureFlags.tsx`) requires an
 * authenticated bearer token by design, so `useFlag()` always returns its OFF
 * default on these paths. Until a public / pre-auth Unleash evaluation path exists
 * (a feature-flags-engineer + backend-engineer dependency — the same gap the
 * portal-branding `isMultiTenantPortalsEnabled()` documents), these flags resolve
 * from:
 *   1. a same-origin runtime override `window.__FF_FLAGS__[key]` (local dev / QA /
 *      Playwright — no network), then
 *   2. a build-time constant `VITE_FF_<KEY>=true`, which SHIPS OFF (matching the
 *      release-flag default-OFF rule) unless a deploy sets it explicitly.
 *
 * Authenticated surfaces must keep using `useFlag()`; this is only for pre-auth paths.
 */
declare global {
  interface Window {
    __FF_FLAGS__?: Record<string, boolean>
  }
}

/** `fuzefront.account-security.password-reset` → `VITE_FF_ACCOUNT_SECURITY_PASSWORD_RESET`. */
export function preAuthFlagEnvName(key: string): string {
  return 'VITE_FF_' + key.replace(/^fuzefront\./, '').replace(/[^a-zA-Z0-9]+/g, '_').toUpperCase()
}

export function isPreAuthFlagEnabled(key: string): boolean {
  if (typeof window !== 'undefined') {
    const override = window.__FF_FLAGS__?.[key]
    if (typeof override === 'boolean') return override
  }
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env
  return env?.[preAuthFlagEnvName(key)] === 'true'
}
