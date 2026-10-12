import axios from 'axios'

/** Non-secret binding to Google's stable account ID and the token's OAuth client. */
export interface GoogleAccountIdentity { subject: string; client_id: string }

export const GOOGLE_CONNECTORS = new Set([
  'google-gmail', 'google-drive', 'google-calendar', 'google-contacts',
  'google-sheets', 'google-docs', 'google-slides', 'google-tasks',
])

export class GoogleReauthorizationRequired extends Error {
  constructor() { super('Google authorization must be renewed') }
}

export async function googleAccountIdentity(accessToken: string, clientId: string): Promise<{ identity: GoogleAccountIdentity; email: string }> {
  const response = await axios.get('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` }, timeout: 10000,
  })
  const profile = response.data
  if (typeof profile?.sub !== 'string' || !profile.sub || profile.sub.length > 255 ||
      typeof profile.email !== 'string' || !profile.email || profile.email_verified !== true || !clientId) {
    throw new GoogleReauthorizationRequired()
  }
  return { identity: { subject: profile.sub, client_id: clientId }, email: profile.email }
}

export function requireGoogleBinding(value: unknown, clientId: string): GoogleAccountIdentity {
  const identity = value as GoogleAccountIdentity | undefined
  if (!identity || typeof identity.subject !== 'string' || !identity.subject ||
      identity.client_id !== clientId || !clientId) throw new GoogleReauthorizationRequired()
  return { subject: identity.subject, client_id: identity.client_id }
}

export function requireGoogleScopes(credential: Record<string, any>, required: string[]): void {
  const granted = new Set(typeof credential?.scope === 'string' ? credential.scope.split(/\s+/).filter(Boolean) : [])
  // Display/identity scopes can be returned as canonical URIs by Google.
  if (required.filter(scope => scope.startsWith('https://www.googleapis.com/auth/')).some(scope => !granted.has(scope))) {
    throw new GoogleReauthorizationRequired()
  }
}

export async function refreshGoogleCredential(credential: Record<string, any>, identity: unknown,
  clientId: string, clientSecret: string, requiredScopes: string[]): Promise<Record<string, any>> {
  const binding = requireGoogleBinding(identity, clientId)
  if (typeof credential.refresh_token !== 'string' || !credential.refresh_token || !clientSecret) {
    throw new GoogleReauthorizationRequired()
  }
  const response = await axios.post('https://oauth2.googleapis.com/token', new URLSearchParams({
    grant_type: 'refresh_token', refresh_token: credential.refresh_token,
    client_id: clientId, client_secret: clientSecret,
  }), { headers: { 'content-type': 'application/x-www-form-urlencoded' }, timeout: 10000 })
  const updated = response.data
  if (typeof updated?.access_token !== 'string' || !updated.access_token) throw new GoogleReauthorizationRequired()
  const verified = await googleAccountIdentity(updated.access_token, clientId)
  if (verified.identity.subject !== binding.subject) throw new GoogleReauthorizationRequired()
  const result = { ...credential, ...updated, refresh_token: updated.refresh_token || credential.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + Number(updated.expires_in || 3600) }
  requireGoogleScopes(result, requiredScopes)
  return result
}
