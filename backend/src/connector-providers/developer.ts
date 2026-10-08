import axios from 'axios'
import type { ConnectorDefinition } from '../connector-platform'

/** OAuth provider metadata and account identification for developer and file services. */
export const developerProviders: ConnectorDefinition[] = [
  {
    id: 'github',
    name: 'GitHub',
    description: 'Connect a GitHub account for developer workflows.',
    authorizationUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scopes: ['read:user', 'user:email'],
    clientIdEnv: 'GITHUB_CONNECTOR_CLIENT_ID',
    clientSecretEnv: 'GITHUB_CONNECTOR_CLIENT_SECRET',
    redirectUriEnv: 'GITHUB_CONNECTOR_REDIRECT_URI',
    async identity(accessToken) {
      const headers = {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      }
      const { data } = await axios.get<Array<{ email: string; primary: boolean; verified: boolean }>>(
        'https://api.github.com/user/emails', { headers, timeout: 10000 },
      )
      const email = data.find(item => item.primary && item.verified)?.email ||
        data.find(item => item.verified)?.email
      if (!email) throw new Error('GitHub account has no verified email')
      return email
    },
    actions: {
      async repositories({ accessToken, query }) {
        const page = boundedPage(query.page)
        const { data } = await axios.get('https://api.github.com/user/repos', {
          headers: githubHeaders(accessToken),
          params: { visibility: 'all', affiliation: 'owner,collaborator,organization_member', per_page: 50, page },
          timeout: 10000,
        })
        return data
      },
      async issues({ accessToken, query }) {
        const page = boundedPage(query.page)
        const { data } = await axios.get('https://api.github.com/user/issues', {
          headers: githubHeaders(accessToken), params: { per_page: 50, page, filter: 'assigned' }, timeout: 10000,
        })
        return data
      },
    },
  },
  {
    id: 'dropbox',
    name: 'Dropbox',
    description: 'Connect a Dropbox account for file workflows.',
    authorizationUrl: 'https://www.dropbox.com/oauth2/authorize',
    tokenUrl: 'https://api.dropboxapi.com/oauth2/token',
    scopes: ['account_info.read', 'files.metadata.read'],
    clientIdEnv: 'DROPBOX_CONNECTOR_CLIENT_ID',
    clientSecretEnv: 'DROPBOX_CONNECTOR_CLIENT_SECRET',
    redirectUriEnv: 'DROPBOX_CONNECTOR_REDIRECT_URI',
    authorizationParameters: { token_access_type: 'offline' },
    async identity(accessToken) {
      const { data } = await axios.post<{ email: string; email_verified: boolean }>(
        'https://api.dropboxapi.com/2/users/get_current_account', null,
        { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 10000 },
      )
      if (!data.email || !data.email_verified) throw new Error('Dropbox account has no verified email')
      return data.email
    },
    actions: {
      async files({ accessToken, query }) {
        const path = typeof query.path === 'string' ? query.path : ''
        if (path && (!path.startsWith('/') || path.length > 1024)) throw new Error('Invalid Dropbox path')
        const cursor = typeof query.cursor === 'string' ? query.cursor : ''
        if (cursor.length > 4096) throw new Error('Invalid Dropbox cursor')
        const endpoint = cursor ? 'list_folder/continue' : 'list_folder'
        const { data } = await axios.post(`https://api.dropboxapi.com/2/files/${endpoint}`,
          cursor ? { cursor } : { path, recursive: false, limit: 100 },
          { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, timeout: 10000 },
        )
        return data
      },
    },
  },
]

function githubHeaders(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
}

function boundedPage(value: unknown): number {
  const page = value === undefined ? 1 : Number(value)
  if (!Number.isSafeInteger(page) || page < 1 || page > 1000) throw new Error('Invalid page')
  return page
}
