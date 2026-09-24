// machineToken.ts — billing-service's S2S (client_credentials) token
// acquisition, following the SAME platform pattern documented in
// docs/runbooks/s2s-client-credentials.md and already proven by
// backend/security's `caller()` machine-token path
// (backend/security/src/routes/authz.ts, backend/security/src/services/
// machine-identity.ts): a service holding an Authentik `client_credentials`
// application performs the standard OAuth2 client_credentials grant against
// Authentik's token endpoint and presents the resulting access token as a
// Bearer credential.
//
// WHY billing needs this (and selection-list-service / config-service do
// not): both of those services only ever call the Security API from inside
// an authenticated HTTP request, so they simply re-forward the CALLER's own
// bearer token (see their `middleware/authz.ts`'s `bearer(req)`). billing's
// four `syncPlanToPermit` call sites (checkout-completed, subscription-
// updated, invoice-paid, invoice-failed) run from Stripe WEBHOOK handlers —
// there is no end-user request in flight, so there is no user token to
// forward. The platform's answer to "a background/service process needs to
// call another FuzeFront service" is the S2S client_credentials pattern, not
// a bespoke scheme — see docs/runbooks/s2s-client-credentials.md.
//
// The PATCH /authz/subjects/{type}/{key}/attributes route billing calls is
// gated identically to grant/revoke (`requireAuthzAdmin` in
// backend/security/src/routes/authz.ts): a machine caller must hold the
// `authz:admin` scope. Provisioning billing-service's S2S application with
// that scope (`register-s2s-cli.js billing-service authz:admin`) and sealing
// its client_id/client_secret into `billing-secrets` is an in-cluster,
// credentialed operation this change cannot perform — see the PR description
// for the exact follow-up command.

export interface MachineTokenConfig {
  /** Authentik's client_credentials token endpoint for billing-service's S2S
   *  application (slug `s2s-billing-service`) — AUTHENTIK_TOKEN_URL. */
  tokenUrl: string;
  /** billing-service's S2S client_id — safe to share, but sourced from the
   *  sealed billing-secrets alongside the secret for simplicity (mirrors how
   *  the s2s runbook hands both off to the consumer's namespace together). */
  clientId: string;
  clientSecret: string;
}

interface CachedToken {
  accessToken: string;
  /** epoch ms after which the cached token must be re-fetched. */
  expiresAtMs: number;
}

/** Refetch this many ms before the token's real expiry, so a request never
 *  races a token that is about to be rejected mid-flight. */
const EXPIRY_SKEW_MS = 30_000;

let cached: CachedToken | null = null;

/**
 * Test seam: force the next getMachineToken() to re-fetch rather than use a
 * cached value. Tests should call this in beforeEach/afterEach.
 */
export function _resetMachineTokenCacheForTesting(): void {
  cached = null;
}

/**
 * Fetches (and caches) a billing-service S2S access token via the standard
 * OAuth2 client_credentials grant.
 *
 * THROWS on any failure (missing config, network error, non-2xx, malformed
 * response) — this is a precondition for a WRITE (`setAttributes`), never a
 * value that silently resolves to "no token". The caller
 * (`PermitSyncService.syncPlanToPermit`) is responsible for catching this
 * and swallowing it into `false`, exactly as it already does for a thrown
 * `AuthzError` from `setAttributes` itself.
 */
export async function getMachineToken(
  config: MachineTokenConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const now = Date.now();
  if (cached && cached.expiresAtMs > now) {
    return cached.accessToken;
  }

  if (!config.tokenUrl || !config.clientId || !config.clientSecret) {
    throw new Error(
      '[machine-token] AUTHENTIK_TOKEN_URL / AUTHENTIK_CLIENT_ID / AUTHENTIK_CLIENT_SECRET ' +
        'are not fully configured — cannot obtain an S2S token for the Security API.',
    );
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });

  const res = await fetchImpl(config.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`[machine-token] token endpoint returned ${res.status}: ${text}`);
  }

  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) {
    throw new Error('[machine-token] token endpoint response had no access_token');
  }

  const ttlMs = (typeof json.expires_in === 'number' ? json.expires_in : 3600) * 1000;
  cached = {
    accessToken: json.access_token,
    expiresAtMs: now + Math.max(ttlMs - EXPIRY_SKEW_MS, 0),
  };
  return cached.accessToken;
}

/** Builds a MachineTokenConfig from environment variables. */
export function machineTokenConfigFromEnv(): MachineTokenConfig {
  return {
    tokenUrl: process.env.AUTHENTIK_TOKEN_URL ?? '',
    clientId: process.env.AUTHENTIK_CLIENT_ID ?? '',
    clientSecret: process.env.AUTHENTIK_CLIENT_SECRET ?? '',
  };
}
