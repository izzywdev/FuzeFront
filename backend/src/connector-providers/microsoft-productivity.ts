import axios from 'axios'
import type { ConnectorDefinition } from '../connector-platform'

const authorizationUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'
const tokenUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'

async function identity(accessToken: string): Promise<string> {
  const { data } = await axios.get('https://graph.microsoft.com/v1.0/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: { $select: 'id,mail,userPrincipalName' }, timeout: 10000,
  })
  const account = data.mail || data.userPrincipalName || data.id
  if (typeof account !== 'string' || !account) throw new Error('Microsoft Graph returned no identity')
  return account
}

function limit(input: unknown): number {
  const parsed = Number(input)
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 20) : 10
}

function resourceId(input: unknown): string {
  if (typeof input !== 'string' || !input || input.length > 512) throw new Error('A valid resource ID is required')
  return encodeURIComponent(input)
}

async function list(accessToken: string, path: string, params: Record<string, unknown> = {}): Promise<unknown> {
  const { data } = await axios.get(`https://graph.microsoft.com/v1.0${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` }, params, timeout: 10000,
  })
  return { items: data.value || [], nextLink: data['@odata.nextLink'] || null }
}

const microsoftOAuth = {
  authorizationUrl, tokenUrl, identity,
  clientIdEnv: 'MICROSOFT_OAUTH_CLIENT_ID',
  clientSecretEnv: 'MICROSOFT_OAUTH_CLIENT_SECRET',
}

/** Isolated grants and credentials for SharePoint and Microsoft To Do. */
export const microsoftProductivityProviders: ConnectorDefinition[] = [
  {
    ...microsoftOAuth,
    id: 'microsoft-sharepoint',
    name: 'SharePoint',
    description: 'Read followed SharePoint sites and their lists.',
    redirectUriEnv: 'MICROSOFT_SHAREPOINT_REDIRECT_URI',
    scopes: ['openid', 'profile', 'offline_access', 'User.Read', 'Sites.Read.All'],
    actions: {
      sites: ({ accessToken, query }) => list(accessToken, '/me/followedSites', { $top: limit(query.limit) }),
      lists: ({ accessToken, query }) => list(accessToken, `/sites/${resourceId(query.site_id)}/lists`, {
        $top: limit(query.limit), $select: 'id,name,displayName,description,webUrl,lastModifiedDateTime',
      }),
    },
  },
  {
    ...microsoftOAuth,
    id: 'microsoft-todo',
    name: 'Microsoft To Do',
    description: 'Read your task lists and tasks.',
    redirectUriEnv: 'MICROSOFT_TODO_REDIRECT_URI',
    scopes: ['openid', 'profile', 'offline_access', 'User.Read', 'Tasks.Read'],
    actions: {
      lists: ({ accessToken, query }) => list(accessToken, '/me/todo/lists', { $top: limit(query.limit) }),
      tasks: ({ accessToken, query }) => list(accessToken, `/me/todo/lists/${resourceId(query.list_id)}/tasks`, {
        $top: limit(query.limit), $select: 'id,title,status,importance,dueDateTime,completedDateTime,createdDateTime',
      }),
    },
  },
]
