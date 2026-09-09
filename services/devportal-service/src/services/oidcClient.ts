// oidcClient.ts — devportal-service's OWN Authentik OIDC exchange.
//
// docs/planning/developers-portal.md §5.1: developers.fuzefront.com reuses
// the SAME FuzeFront Authentik OIDC provider (no new IdP, no new user
// store) via its own registered redirect_uri
// (deploy/helm/fuzefront/authentik/blueprints/provider-oidc.yaml). This is a
// standard, self-contained authorization-code + PKCE flow via `openid-client`
// — deliberately NOT a re-implementation of backend/security's bespoke
// multi-tenant/home-portal OIDC machinery (backend/security/src/services/
// oidc.ts), which carries portal-binding/support-access concerns that do not
// apply to a devportal sign-in. After exchange, the raw `userinfo` claims are
// handed to security-service's `/internal/oidc-sync`
// (services/internalClient.ts) so account find-or-create stays
// single-sourced against the real `users` table.

import type { IncomingMessage } from 'http';
import { Issuer, generators, type Client } from 'openid-client';

let clientPromise: Promise<Client> | null = null;

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

async function getClient(): Promise<Client> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const issuerUrl = requiredEnv('AUTHENTIK_ISSUER_URL');
      const clientId = requiredEnv('AUTHENTIK_CLIENT_ID');
      const clientSecret = requiredEnv('AUTHENTIK_CLIENT_SECRET');
      const redirectUri = requiredEnv('DEVPORTAL_OIDC_REDIRECT_URI');

      const issuer = await Issuer.discover(issuerUrl);
      return new issuer.Client({
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uris: [redirectUri],
        response_types: ['code'],
      });
    })();
  }
  return clientPromise;
}

export interface AuthorizeUrlResult {
  url: string;
  state: string;
  codeVerifier: string;
}

/** Builds the Authentik authorize URL for the "Sign in" CTA. PKCE S256. */
export async function buildAuthorizeUrl(): Promise<AuthorizeUrlResult> {
  const client = await getClient();
  const state = generators.state();
  const codeVerifier = generators.codeVerifier();
  const codeChallenge = generators.codeChallenge(codeVerifier);

  const url = client.authorizationUrl({
    scope: 'openid email profile',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  return { url, state, codeVerifier };
}

/**
 * Completes the code exchange for the callback route. Returns the raw OIDC
 * userinfo claims — NOT a FuzeFront user; the caller resolves that via
 * `services/internalClient.ts`'s `syncOidcUser`.
 */
export async function completeCallback(
  req: IncomingMessage,
  state: string,
  codeVerifier: string
): Promise<Record<string, unknown>> {
  const client = await getClient();
  const redirectUri = requiredEnv('DEVPORTAL_OIDC_REDIRECT_URI');

  const params = client.callbackParams(req);
  const tokenSet = await client.callback(redirectUri, params, { state, code_verifier: codeVerifier });

  if (!tokenSet.access_token) {
    throw new Error('OIDC callback did not return an access_token');
  }
  return client.userinfo(tokenSet.access_token);
}
