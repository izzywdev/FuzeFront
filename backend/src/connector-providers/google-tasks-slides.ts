import axios from 'axios'
import type { ConnectorDefinition } from '../connector-platform'

const identityScopes = ['openid', 'email', 'profile']

function size(value: unknown, fallback = 20): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 100) : fallback
}

function token(value: unknown): string | undefined {
  return typeof value === 'string' && value.length <= 2048 ? value : undefined
}

function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,256}$/.test(value)) {
    throw new Error('A valid resource ID is required')
  }
  return encodeURIComponent(value)
}

async function read(url: string, accessToken: string, params: Record<string, unknown> = {}) {
  const response = await axios.get(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    params,
    timeout: 15000,
  })
  return response.data
}

async function identity(accessToken: string): Promise<string> {
  const response = await read('https://openidconnect.googleapis.com/v1/userinfo', accessToken)
  if (typeof response?.email !== 'string' || !response.email || response.email_verified !== true) {
    throw new Error('Google account identity is unavailable or unverified')
  }
  return response.email
}

const oauth = {
  authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  clientIdEnv: 'GOOGLE_OAUTH_CLIENT_ID',
  clientSecretEnv: 'GOOGLE_OAUTH_CLIENT_SECRET',
  identity,
  authorizationParameters: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },
}

/** Google Slides has no presentations.list endpoint; Drive lists presentation metadata. */
export const googleTasksSlidesProviders: ConnectorDefinition[] = [
  {
    ...oauth,
    id: 'google-slides',
    name: 'Google Slides',
    description: 'Read presentations and slide text',
    redirectUriEnv: 'GOOGLE_SLIDES_OAUTH_REDIRECT_URI',
    scopes: [...identityScopes,
      'https://www.googleapis.com/auth/presentations.readonly',
      'https://www.googleapis.com/auth/drive.metadata.readonly'],
    initialConfiguration: { page_size: 20 },
    actions: {
      presentations: ({ accessToken, query, configuration }) => read(
        'https://www.googleapis.com/drive/v3/files', accessToken,
        { q: "mimeType = 'application/vnd.google-apps.presentation' and trashed = false",
          pageSize: size(query.limit, size(configuration.page_size)), pageToken: token(query.page_token),
          fields: 'nextPageToken,files(id,name,description,modifiedTime,webViewLink)',
          orderBy: 'modifiedTime desc' },
      ),
      presentation: ({ accessToken, query }) => read(
        `https://slides.googleapis.com/v1/presentations/${id(query.presentation_id)}`, accessToken,
        { fields: 'presentationId,title,slides(objectId,pageElements(objectId,shape(text(textElements(textRun(content)))))' },
      ),
    },
  },
  {
    ...oauth,
    id: 'google-tasks',
    name: 'Google Tasks',
    description: 'Read task lists and tasks',
    redirectUriEnv: 'GOOGLE_TASKS_OAUTH_REDIRECT_URI',
    scopes: [...identityScopes, 'https://www.googleapis.com/auth/tasks.readonly'],
    initialConfiguration: { page_size: 20 },
    actions: {
      lists: ({ accessToken, query, configuration }) => read(
        'https://tasks.googleapis.com/tasks/v1/users/@me/lists', accessToken,
        { maxResults: size(query.limit, size(configuration.page_size)), pageToken: token(query.page_token) },
      ),
      tasks: ({ accessToken, query, configuration }) => read(
        `https://tasks.googleapis.com/tasks/v1/lists/${id(query.list_id)}/tasks`, accessToken,
        { maxResults: size(query.limit, size(configuration.page_size)), pageToken: token(query.page_token),
          showCompleted: query.show_completed !== 'false', showHidden: query.show_completed === 'true',
          showDeleted: false },
      ),
    },
  },
]
