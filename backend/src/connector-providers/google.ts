import axios from 'axios'
import type { ConnectorDefinition } from '../connector-platform'

const authorizationUrl = 'https://accounts.google.com/o/oauth2/v2/auth'
const tokenUrl = 'https://oauth2.googleapis.com/token'
const identityScope = ['openid', 'email', 'profile']

function limit(input: unknown, fallback: number, maximum = 100): number {
  const parsed = Number(input)
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback
}

function pageToken(input: unknown): string | undefined {
  return typeof input === 'string' && input.length <= 2048 ? input : undefined
}

function isoDate(input: unknown): string | undefined {
  if (typeof input !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(input)) return undefined
  const timestamp = Date.parse(input)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined
}

async function getGoogleResource(url: string, accessToken: string, params: Record<string, unknown>) {
  const response = await axios.get(url, {
    headers: { Authorization: `Bearer ${accessToken}` }, params,
    timeout: 15000,
  })
  return response.data
}

async function googleIdentity(accessToken: string): Promise<string> {
  const response = await axios.get('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 10000,
  })
  const email = response.data?.email
  if (typeof email !== 'string' || !email || response.data?.email_verified !== true) {
    throw new Error('Google account identity is unavailable or unverified')
  }
  return email
}

const googleOAuth = {
  authorizationUrl,
  tokenUrl,
  clientIdEnv: 'GOOGLE_OAUTH_CLIENT_ID',
  clientSecretEnv: 'GOOGLE_OAUTH_CLIENT_SECRET',
  identity: googleIdentity,
  authorizationParameters: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },
}

/** Each provider has its own registered callback URL and an isolated FuzeKeys credential. */
export const googleProviders: ConnectorDefinition[] = [
  {
    ...googleOAuth,
    id: 'google-drive',
    name: 'Google Drive',
    description: 'Read files and metadata in your Google Drive',
    redirectUriEnv: 'GOOGLE_DRIVE_OAUTH_REDIRECT_URI',
    scopes: [...identityScope, 'https://www.googleapis.com/auth/drive.readonly'],
    initialConfiguration: { page_size: 20 },
    actions: {
      files: ({ accessToken, query, configuration }) => getGoogleResource(
        'https://www.googleapis.com/drive/v3/files', accessToken,
        { pageSize: limit(query.limit, limit(configuration.page_size, 20)), pageToken: pageToken(query.page_token),
          q: 'trashed = false', fields: 'nextPageToken,files(id,name,mimeType,description,modifiedTime,size,webViewLink,owners(displayName,emailAddress))',
          orderBy: 'modifiedTime desc' },
      ),
    },
  },
  {
    ...googleOAuth,
    id: 'google-calendar',
    name: 'Google Calendar',
    description: 'Read your calendars and events',
    redirectUriEnv: 'GOOGLE_CALENDAR_OAUTH_REDIRECT_URI',
    scopes: [...identityScope, 'https://www.googleapis.com/auth/calendar.readonly'],
    initialConfiguration: { max_results: 20 },
    actions: {
      events: ({ accessToken, query, configuration }) => getGoogleResource(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(typeof query.calendar_id === 'string' && query.calendar_id.length <= 256 ? query.calendar_id : 'primary')}/events`,
        accessToken,
        { maxResults: limit(query.limit, limit(configuration.max_results, 20)), pageToken: pageToken(query.page_token),
          timeMin: isoDate(query.time_min) || new Date().toISOString(),
          singleEvents: true, orderBy: 'startTime',
          fields: 'nextPageToken,items(id,summary,description,location,start,end,htmlLink,status,organizer)' },
      ),
    },
  },
  {
    ...googleOAuth,
    id: 'google-contacts',
    name: 'Google Contacts',
    description: 'Read your contacts',
    redirectUriEnv: 'GOOGLE_CONTACTS_OAUTH_REDIRECT_URI',
    scopes: [...identityScope, 'https://www.googleapis.com/auth/contacts.readonly'],
    initialConfiguration: { page_size: 20 },
    actions: {
      contacts: ({ accessToken, query, configuration }) => getGoogleResource(
        'https://people.googleapis.com/v1/people/me/connections', accessToken,
        { personFields: 'names,emailAddresses,phoneNumbers,organizations',
          pageSize: limit(query.limit, limit(configuration.page_size, 20)), pageToken: pageToken(query.page_token),
          sortOrder: 'LAST_MODIFIED_DESCENDING' },
      ),
    },
  },
]
