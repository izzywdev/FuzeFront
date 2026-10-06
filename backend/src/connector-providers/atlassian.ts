import axios from 'axios'
import type { ConnectorDefinition, ConnectorActionContext } from '../connector-platform'

type Resource = { id: string; name?: string; scopes?: string[] }

const api = 'https://api.atlassian.com'

function headers(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
}

async function resources(accessToken: string, scope: string): Promise<Resource[]> {
  const { data } = await axios.get<Resource[]>(`${api}/oauth/token/accessible-resources`, {
    headers: headers(accessToken), timeout: 10000, maxRedirects: 0,
  })
  if (!Array.isArray(data)) throw new Error('Invalid Atlassian resources')
  return data.filter(item => item.scopes?.includes(scope) && /^[a-zA-Z0-9-]{1,128}$/.test(item.id))
}

async function resource(context: ConnectorActionContext, scope: string): Promise<string> {
  const available = await resources(context.accessToken, scope)
  const requested = context.query.cloudId
  if (requested !== undefined && (typeof requested !== 'string' || !/^[a-zA-Z0-9-]{1,128}$/.test(requested))) {
    throw new Error('Invalid cloudId')
  }
  const selected = requested ? available.find(item => item.id === requested) : available.length === 1 ? available[0] : undefined
  if (!selected) throw new Error('Specify an accessible cloudId')
  return selected.id
}

function limit(value: unknown): number {
  const n = value === undefined ? 25 : Number(value)
  if (!Number.isSafeInteger(n) || n < 1 || n > 100) throw new Error('Invalid limit')
  return n
}

function optionalString(value: unknown, name: string, length = 2048): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length > length) throw new Error(`Invalid ${name}`)
  return value
}

async function identity(accessToken: string): Promise<string> {
  const { data } = await axios.get<{ account_id?: string }>(`${api}/me`, {
    headers: headers(accessToken), timeout: 10000, maxRedirects: 0,
  })
  if (!data.account_id || data.account_id.length > 255) throw new Error('Atlassian account ID unavailable')
  return `atlassian:${data.account_id}`
}

function exchange(clientIdEnv: string, clientSecretEnv: string, redirectUriEnv: string) {
  return async (code: string): Promise<Record<string, any>> => {
    const { data } = await axios.post('https://auth.atlassian.com/oauth/token', {
      grant_type: 'authorization_code', client_id: process.env[clientIdEnv], client_secret: process.env[clientSecretEnv],
      redirect_uri: process.env[redirectUriEnv], code,
    }, { headers: { 'Content-Type': 'application/json' }, timeout: 10000, maxRedirects: 0 })
    return data
  }
}

function refresh(clientIdEnv: string, clientSecretEnv: string) {
  return async (credential: Record<string, any>): Promise<Record<string, any>> => {
    const { data } = await axios.post('https://auth.atlassian.com/oauth/token', {
      grant_type: 'refresh_token', client_id: process.env[clientIdEnv], client_secret: process.env[clientSecretEnv],
      refresh_token: credential.refresh_token,
    }, { headers: { 'Content-Type': 'application/json' }, timeout: 10000, maxRedirects: 0 })
    return data
  }
}

/** Atlassian OAuth 3LO uses JSON token requests and site-specific API paths. */
export const atlassianProviders: ConnectorDefinition[] = [
  {
    id: 'jira-cloud', name: 'Jira Cloud', description: 'Read issues from an authorized Jira Cloud site.',
    authorizationUrl: 'https://auth.atlassian.com/authorize', tokenUrl: 'https://auth.atlassian.com/oauth/token',
    scopes: ['read:jira-work', 'offline_access'],
    authorizationParameters: { audience: 'api.atlassian.com', prompt: 'consent' }, supportsPkce: false,
    clientIdEnv: 'JIRA_CONNECTOR_CLIENT_ID', clientSecretEnv: 'JIRA_CONNECTOR_CLIENT_SECRET',
    redirectUriEnv: 'JIRA_CONNECTOR_REDIRECT_URI', identity,
    exchangeCode: exchange('JIRA_CONNECTOR_CLIENT_ID', 'JIRA_CONNECTOR_CLIENT_SECRET', 'JIRA_CONNECTOR_REDIRECT_URI'),
    refreshToken: refresh('JIRA_CONNECTOR_CLIENT_ID', 'JIRA_CONNECTOR_CLIENT_SECRET'),
    actions: {
      async sites({ accessToken }) { return resources(accessToken, 'read:jira-work') },
      async issues(context) {
        const cloudId = await resource(context, 'read:jira-work')
        const jql = optionalString(context.query.jql, 'jql', 4096) || 'order by updated DESC'
        const nextPageToken = optionalString(context.query.nextPageToken, 'nextPageToken', 2048)
        const { data } = await axios.get(`${api}/ex/jira/${cloudId}/rest/api/3/search/jql`, {
          headers: headers(context.accessToken), params: { jql, maxResults: limit(context.query.limit),
            fields: 'summary,status,assignee,updated,project', ...(nextPageToken ? { nextPageToken } : {}) },
          timeout: 10000, maxRedirects: 0,
        })
        return data
      },
    },
  },
  {
    id: 'confluence-cloud', name: 'Confluence Cloud', description: 'Read pages from an authorized Confluence Cloud site.',
    authorizationUrl: 'https://auth.atlassian.com/authorize', tokenUrl: 'https://auth.atlassian.com/oauth/token',
    scopes: ['read:page:confluence', 'offline_access'],
    authorizationParameters: { audience: 'api.atlassian.com', prompt: 'consent' }, supportsPkce: false,
    clientIdEnv: 'CONFLUENCE_CONNECTOR_CLIENT_ID', clientSecretEnv: 'CONFLUENCE_CONNECTOR_CLIENT_SECRET',
    redirectUriEnv: 'CONFLUENCE_CONNECTOR_REDIRECT_URI', identity,
    exchangeCode: exchange('CONFLUENCE_CONNECTOR_CLIENT_ID', 'CONFLUENCE_CONNECTOR_CLIENT_SECRET', 'CONFLUENCE_CONNECTOR_REDIRECT_URI'),
    refreshToken: refresh('CONFLUENCE_CONNECTOR_CLIENT_ID', 'CONFLUENCE_CONNECTOR_CLIENT_SECRET'),
    actions: {
      async sites({ accessToken }) { return resources(accessToken, 'read:page:confluence') },
      async pages(context) {
        const cloudId = await resource(context, 'read:page:confluence')
        const cursor = optionalString(context.query.cursor, 'cursor', 2048)
        const { data } = await axios.get(`${api}/ex/confluence/${cloudId}/wiki/api/v2/pages`, {
          headers: headers(context.accessToken), params: { limit: limit(context.query.limit),
            ...(cursor ? { cursor } : {}) }, timeout: 10000, maxRedirects: 0,
        })
        return data
      },
    },
  },
]
