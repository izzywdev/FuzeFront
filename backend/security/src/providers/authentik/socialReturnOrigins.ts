/**
 * Return-origin allowlist for the brokered social sign-in flow
 * (FuzeFront#352 — MendysRobotics marketplace/live).
 *
 * By default, `startSocialLogin` / `brokerCallback` in
 * `AuthentikIdentityProvider` send the browser's single-use opaque `?code=`
 * back to `${appBaseUrl()}${redirectTo}` — the ambient identity tenant's
 * configured app origin (`providers/authentik/config.ts` /
 * `providers/authentik/tenants.ts`). That is correct for FuzeFront's own SPA,
 * but a consumer that proxies `/api/v1/security/*` SAME-ORIGIN from its own
 * domain (MendysRobotics' `marketplace`/`live` SPAs) needs the code returned
 * to ITS origin instead of `app.fuzefront.com`.
 *
 * ── Why this is NOT the multi-tenant identity registry ──────────────────────
 * `SECURITY_TENANTS` (tenants.ts) already resolves an inbound request's Host
 * to a whole separate identity tenant — its OWN Authentik instance, OIDC
 * client, admin token, etc. — and switches the service into a mode where any
 * UNDECLARED host is REJECTED with a hard 400 (tenants.ts's "FAIL CLOSED").
 * Turning that on would require enumerating EVERY host that legitimately
 * reaches security-service today — Traefik (`app.fuzefront.com`), and every
 * in-cluster caller's Service-DNS Host header (provisioning-service,
 * config-service, selection-list-service all call
 * `http://fuzefront-security:3002/api/v1/security/*`, which is also mounted
 * behind `tenantContext`) — or those callers start getting rejected the
 * moment `SECURITY_TENANTS` is set. That is a prod-wide identity-routing
 * change with a large, not-fully-enumerable-from-this-repo blast radius, for
 * a request that is only "let the social broker return to two more origins".
 * So this module is a separate, narrower, ADDITIVE-ONLY mechanism: it never
 * changes which identity backend serves a request, only which origin the
 * *finished* broker redirect targets — and it changes nothing when no host
 * matches (today's behaviour, byte-for-byte, for every existing deployment).
 *
 * ── Matching rule ────────────────────────────────────────────────────────
 * EXACT origin match only — no wildcard, no subdomain pattern, no
 * startsWith/substring match. The destination receives the caller's fresh
 * single-use sign-in code, so an over-broad allowlist here is a direct
 * open-redirect / auth-code-leak vector. Matched on the inbound request's raw
 * `Host` header, normalised the same way `tenants.ts` normalises it (see
 * `normaliseHost`'s doc comment there for why raw `Host` rather than
 * `X-Forwarded-Host` is the right signal here too) — captured once at
 * `/social/:provider/start` and carried in the broker's server-side state
 * (`AuthentikIdentityProvider.socialStates`) so the later callback — which
 * physically arrives back on FuzeFront's own host via Google's registered
 * `redirect_uri`, not on the origin that started the flow — knows where to
 * send the browser next.
 */
import { Request } from 'express'
import { normaliseHost } from './tenants'

/**
 * `SECURITY_SOCIAL_RETURN_ORIGINS` — comma-separated list of full origins
 * (`https://host`, scheme required, no path/query/fragment/trailing slash)
 * the social broker may redirect the browser back to, in addition to the
 * ambient tenant's own `appBaseUrl()`. Unset or empty = no additional
 * origins; every existing deployment is unaffected.
 *
 * Re-parsed on every call, deliberately: this is a plain env value (no
 * secret material — it is just a list of public web origins), cheap to
 * re-read, and tests set/clear `process.env.SECURITY_SOCIAL_RETURN_ORIGINS`
 * between cases without needing a reset hook.
 */
function parseAllowedReturnOrigins(): Map<string, string> {
  const raw = process.env.SECURITY_SOCIAL_RETURN_ORIGINS
  const byHost = new Map<string, string>()
  if (!raw) return byHost
  for (const entry of raw.split(',')) {
    const candidate = entry.trim().replace(/\/+$/, '')
    if (!candidate) continue
    let url: URL
    try {
      url = new URL(candidate)
    } catch {
      // Malformed entry — skip it rather than crash the process. This value
      // is not validated at deploy time the way SECURITY_TENANTS is.
      continue
    }
    // Require a bare origin. A path/query/fragment on an allowlist entry is
    // very likely a misconfiguration, and silently truncating it to just the
    // host would allowlist more than was actually written down.
    if ((url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) continue
    if (url.protocol !== 'https:' && url.protocol !== 'http:') continue
    const host = normaliseHost(url.host)
    if (!host) continue
    byHost.set(host, `${url.protocol}//${url.host}`)
  }
  return byHost
}

/**
 * Resolve the return origin for a `/social/:provider/start` request, or
 * `undefined` if its Host does not exactly match an allowlisted origin (the
 * overwhelmingly common case — callers then keep using `appBaseUrl()`).
 */
export function resolveAllowedReturnOrigin(req: Pick<Request, 'headers'>): string | undefined {
  const allowed = parseAllowedReturnOrigins()
  if (allowed.size === 0) return undefined
  const host = normaliseHost(req.headers.host)
  return host ? allowed.get(host) : undefined
}
