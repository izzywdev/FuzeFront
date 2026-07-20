import type { SocialProvider } from '../types'

/**
 * Human display names for social providers. These are the SOCIAL provider names
 * shown to the user (e.g. Google) — explicitly present in the approved frames.
 * They are NOT identity-vendor names (Authentik/Permit), which never appear.
 */
const PROVIDER_NAMES: Record<SocialProvider, string> = {
  google: 'Google',
}

export function providerDisplayName(provider: SocialProvider): string {
  return PROVIDER_NAMES[provider] ?? provider
}
