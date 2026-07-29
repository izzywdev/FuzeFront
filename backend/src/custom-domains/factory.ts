/**
 * Builds the Custom Hostname client from environment, wired by
 * deploy/helm/fuzefront/templates/backend.yaml.
 *
 *   CUSTOM_HOSTNAME_API_URL      in-cluster service DNS (has a safe default)
 *   CUSTOM_HOSTNAME_API_PROFILE  our route profile ("fuzefront")
 *   CUSTOM_HOSTNAME_API_TOKEN    FuzeInfra-issued BEARER token, from the
 *                                fuzefront-secrets SealedSecret
 *
 * `CUSTOM_HOSTNAME_API_TOKEN` is NOT a Cloudflare credential. FuzeInfra holds
 * the Cloudflare token in its own namespace so consumers never do; do not add
 * one here.
 *
 * Returns `null` when the token is absent, so a cluster where the SealedSecret
 * has not synced yet degrades to "custom domains unavailable" rather than
 * crash-looping the backend. The feature is separately flag-gated, so in the
 * normal default-OFF case this returning null is expected and silent.
 */

import { CustomHostnameClient, DEFAULT_BASE_URL } from '@fuzefront/custom-hostname-client'

export function createCustomHostnameClient(): CustomHostnameClient | null {
  const token = process.env.CUSTOM_HOSTNAME_API_TOKEN
  if (!token) return null

  return new CustomHostnameClient({
    baseUrl: process.env.CUSTOM_HOSTNAME_API_URL || DEFAULT_BASE_URL,
    token,
    profile: process.env.CUSTOM_HOSTNAME_API_PROFILE || undefined,
  })
}
