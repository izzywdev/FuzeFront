/**
 * Authentik OIDC redirect-URI registration for custom domains
 * (FF-EPIC-16 / FFRNT-91 item 7).
 *
 * Authentik rejects unregistered redirect URIs, so a portal reached at
 * `https://app.corpabc.com` cannot complete an OIDC callback until that exact
 * URI is on the FuzeFront provider. This module adds it — and, critically,
 * only once the domain is `active`.
 *
 * **Why registration is gated on `active` and not on create.** A domain that is
 * still `pending_validation` does not resolve to us, so a callback to it fails
 * regardless. Registering early means the failure surfaces as a broken login
 * rather than as "your domain is still validating", which is the wrong error in
 * front of the wrong person. `CustomHostnameService` owns that gate; this
 * module is the mechanism.
 *
 * No ingress or egress change is needed: the redirect to the IdP is a browser
 * redirect, and the redirect back to the custom domain arrives over the same
 * path as any other request to it. FuzeInfra confirmed the path is clear.
 *
 * The provider is mutated through the Admin API rather than the blueprint,
 * because blueprints are a static ConfigMap rendered at deploy time and these
 * URIs are runtime data — the same reasoning FuzeInfra applies to the
 * per-domain Ingress it materializes.
 */

import axios from 'axios'
import {
  AUTHENTIK_TIMEOUT_MS,
  buildHeaders,
  findAcrossPages,
  getAuthentikAdminToken,
  getAuthentikBaseUrl,
} from '../authentik/authentik-admin'
import type { RedirectUriRegistrar } from './customHostnameService'

/** Matches `identifiers.name` in authentik/blueprints/provider-oidc.yaml. */
const PROVIDER_NAME = 'FuzeFront'

/** Matches the callback path the blueprint registers for every other host. */
const CALLBACK_PATH = '/api/auth/oidc/callback'

interface RedirectUriEntry {
  matching_mode: string
  url: string
}

interface OAuth2Provider {
  pk: number
  name: string
  redirect_uris?: RedirectUriEntry[]
}

/** The callback URI for a custom domain. Always https — the edge terminates TLS. */
export function callbackUri(domain: string): string {
  return `https://${domain}${CALLBACK_PATH}`
}

/**
 * Admin-API-backed registrar. Returns `null` when Authentik is not configured
 * (no admin token), so a deployment without it degrades to "custom domains
 * cannot register redirect URIs" instead of throwing on every status poll.
 */
export function createAuthentikRedirectRegistrar(): RedirectUriRegistrar | null {
  const token = getAuthentikAdminToken()
  if (!token) return null

  const baseUrl = getAuthentikBaseUrl()
  const headers = buildHeaders(token)

  async function loadProvider(): Promise<OAuth2Provider> {
    const found = await findAcrossPages<OAuth2Provider>(
      `${baseUrl}/api/v3/providers/oauth2/`,
      { name: PROVIDER_NAME },
      headers,
      (p) => p.name === PROVIDER_NAME
    )
    if (!found) {
      throw new Error(
        `[custom-domains] Authentik OAuth2 provider "${PROVIDER_NAME}" not found — ` +
          'cannot register a custom-domain redirect URI. Has provider-oidc.yaml been applied?'
      )
    }
    return found
  }

  /**
   * Read-modify-write of `redirect_uris`.
   *
   * PATCH replaces the whole list, so we must send the existing entries back or
   * we would silently drop the statically-blueprinted hosts — which would take
   * down login on app.fuzefront.com. Hence the read, and hence the dedupe.
   */
  async function mutate(
    change: (current: RedirectUriEntry[]) => RedirectUriEntry[]
  ): Promise<void> {
    const provider = await loadProvider()
    const current = provider.redirect_uris ?? []
    const next = change(current)
    if (sameUris(current, next)) return
    await axios.patch(
      `${baseUrl}/api/v3/providers/oauth2/${provider.pk}/`,
      { redirect_uris: next },
      { headers, timeout: AUTHENTIK_TIMEOUT_MS }
    )
  }

  return {
    async register(domain: string): Promise<void> {
      const url = callbackUri(domain)
      await mutate((current) =>
        current.some((e) => e.url === url)
          ? current
          : [...current, { matching_mode: 'strict', url }]
      )
    },

    async deregister(domain: string): Promise<void> {
      const url = callbackUri(domain)
      await mutate((current) => current.filter((e) => e.url !== url))
    },
  }
}

function sameUris(a: RedirectUriEntry[], b: RedirectUriEntry[]): boolean {
  if (a.length !== b.length) return false
  const key = (e: RedirectUriEntry) => `${e.matching_mode}|${e.url}`
  const left = a.map(key).sort()
  const right = b.map(key).sort()
  return left.every((v, i) => v === right[i])
}
