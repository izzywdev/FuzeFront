import axios from 'axios'
import type { ConnectorDefinition } from '../connector-platform'

const authorizationUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'
const tokenUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'

async function graphIdentity(accessToken: string): Promise<string> {
  const { data } = await axios.get('https://graph.microsoft.com/v1.0/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: { $select: 'id,displayName,mail,userPrincipalName' },
    timeout: 10000,
  })
  const identity = data.mail || data.userPrincipalName || data.id
  if (typeof identity !== 'string' || !identity) throw new Error('Microsoft Graph returned no identity')
  return identity
}

function limit(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(1, Math.min(20, Math.trunc(number))) : 10
}

async function graphList(accessToken: string, path: string, params: Record<string, unknown>): Promise<unknown> {
  const { data } = await axios.get(`https://graph.microsoft.com/v1.0${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` }, params, timeout: 10000,
  })
  return { items: data.value || [], nextLink: data['@odata.nextLink'] || null }
}

/** Separate grants let users connect just the Microsoft data source they need. */
export const microsoftProviders: ConnectorDefinition[] = [
  {
    id: 'microsoft-outlook',
    name: 'Outlook Mail',
    description: 'Read your Outlook inbox through Microsoft Graph.',
    authorizationUrl,
    tokenUrl,
    scopes: ['openid', 'profile', 'offline_access', 'User.Read', 'Mail.Read'],
    clientIdEnv: 'MICROSOFT_OAUTH_CLIENT_ID',
    clientSecretEnv: 'MICROSOFT_OAUTH_CLIENT_SECRET',
    redirectUriEnv: 'MICROSOFT_OUTLOOK_REDIRECT_URI',
    identity: graphIdentity,
    initialConfiguration: { folder: 'inbox' },
    actions: {
      recent: ({ accessToken, query }) => graphList(accessToken, '/me/mailFolders/inbox/messages', {
        $top: limit(query.limit), $select: 'id,conversationId,from,subject,receivedDateTime,bodyPreview,webLink',
        $orderby: 'receivedDateTime desc',
      }),
    },
  },
  {
    id: 'microsoft-onedrive',
    name: 'OneDrive',
    description: 'Read files in your OneDrive through Microsoft Graph.',
    authorizationUrl,
    tokenUrl,
    scopes: ['openid', 'profile', 'offline_access', 'User.Read', 'Files.Read'],
    clientIdEnv: 'MICROSOFT_OAUTH_CLIENT_ID',
    clientSecretEnv: 'MICROSOFT_OAUTH_CLIENT_SECRET',
    redirectUriEnv: 'MICROSOFT_ONEDRIVE_REDIRECT_URI',
    identity: graphIdentity,
    actions: {
      files: ({ accessToken, query }) => graphList(accessToken, '/me/drive/root/children', {
        $top: limit(query.limit), $select: 'id,name,size,webUrl,lastModifiedDateTime,file,folder',
      }),
    },
  },
  {
    id: 'microsoft-teams',
    name: 'Microsoft Teams',
    description: 'Read your Teams chats through Microsoft Graph.',
    authorizationUrl,
    tokenUrl,
    scopes: ['openid', 'profile', 'offline_access', 'User.Read', 'Chat.Read'],
    clientIdEnv: 'MICROSOFT_OAUTH_CLIENT_ID',
    clientSecretEnv: 'MICROSOFT_OAUTH_CLIENT_SECRET',
    redirectUriEnv: 'MICROSOFT_TEAMS_REDIRECT_URI',
    identity: graphIdentity,
    actions: {
      chats: ({ accessToken, query }) => graphList(accessToken, '/me/chats', {
        $top: limit(query.limit), $expand: 'lastMessagePreview',
      }),
    },
  },
]
