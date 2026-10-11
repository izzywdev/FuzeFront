/** Workspace connectors. OAuth nuances stay here; state, vault and delegation live in the platform. */
import axios from 'axios'
import type { ConnectorDefinition } from '../connector-platform'

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not configured`)
  return value
}

function tokenValue(token: Record<string, any>, path: string[]): string {
  let value: any = token
  for (const part of path) value = value?.[part]
  if (typeof value !== 'string' || !value) throw new Error(`OAuth response missing ${path.join('.')}`)
  return value
}

const slack: ConnectorDefinition = {
  id: 'slack',
  name: 'Slack',
  description: 'Read channels and their messages in an authorized Slack workspace.',
  authorizationUrl: 'https://slack.com/oauth/v2/authorize',
  tokenUrl: 'https://slack.com/api/oauth.v2.access',
  scopes: ['channels:read', 'channels:history', 'groups:read', 'groups:history'],
  clientIdEnv: 'SLACK_CLIENT_ID',
  clientSecretEnv: 'SLACK_CLIENT_SECRET',
  redirectUriEnv: 'SLACK_REDIRECT_URI',
  supportsPkce: false,
  buildAuthorizationParameters(base) {
    base.set('scope', this.scopes.join(','))
    return base
  },
  async exchangeCode(code) {
    const response = await axios.post(this.tokenUrl, new URLSearchParams({
      code, client_id: required(this.clientIdEnv), client_secret: required(this.clientSecretEnv),
      redirect_uri: required(this.redirectUriEnv),
    }), { headers: { 'content-type': 'application/x-www-form-urlencoded' }, timeout: 10000 })
    if (response.data?.ok !== true) throw new Error('Slack authorization was rejected')
    return response.data
  },
  async tokenIdentity(token) {
    return tokenValue(token, ['team', 'id'])
  },
  initialConfiguration: { channel_types: ['public_channel', 'private_channel'] },
  actions: {
    async channels({ accessToken, query }) {
      const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100)
      const { data } = await axios.get('https://slack.com/api/conversations.list', {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { limit, types: 'public_channel,private_channel', cursor: typeof query.cursor === 'string' ? query.cursor : undefined },
        timeout: 10000,
      })
      if (!data.ok) throw new Error('Slack channel listing failed')
      return { channels: data.channels, next_cursor: data.response_metadata?.next_cursor || null }
    },
    async messages({ accessToken, query }) {
      if (typeof query.channel !== 'string' || !/^[A-Z0-9]{5,30}$/.test(query.channel)) throw new Error('Invalid Slack channel')
      const { data } = await axios.get('https://slack.com/api/conversations.history', {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { channel: query.channel, limit: Math.min(Math.max(Number(query.limit) || 15, 1), 15),
          cursor: typeof query.cursor === 'string' ? query.cursor : undefined },
        timeout: 10000,
      })
      if (!data.ok) throw new Error('Slack message listing failed')
      return { messages: data.messages, next_cursor: data.response_metadata?.next_cursor || null }
    },
  },
}

const notion: ConnectorDefinition = {
  id: 'notion',
  name: 'Notion',
  description: 'Read pages shared with a Notion connection.',
  authorizationUrl: 'https://api.notion.com/v1/oauth/authorize',
  tokenUrl: 'https://api.notion.com/v1/oauth/token',
  // Notion permissions are set on the integration itself; its OAuth URL has no scopes.
  scopes: [],
  clientIdEnv: 'NOTION_CLIENT_ID',
  clientSecretEnv: 'NOTION_CLIENT_SECRET',
  redirectUriEnv: 'NOTION_REDIRECT_URI',
  supportsPkce: false,
  buildAuthorizationParameters(base) {
    base.delete('scope')
    base.set('owner', 'user')
    return base
  },
  async exchangeCode(code) {
    const auth = Buffer.from(`${required(this.clientIdEnv)}:${required(this.clientSecretEnv)}`).toString('base64')
    const response = await axios.post(this.tokenUrl, {
      grant_type: 'authorization_code', code, redirect_uri: required(this.redirectUriEnv),
    }, {
      headers: { authorization: `Basic ${auth}`, 'content-type': 'application/json', 'Notion-Version': '2026-03-11' },
      timeout: 10000,
    })
    return response.data
  },
  async tokenIdentity(token) {
    return tokenValue(token, ['workspace_id'])
  },
  actions: {
    async pages({ accessToken, query }) {
      const { data } = await axios.post('https://api.notion.com/v1/search', {
        filter: { property: 'object', value: 'page' },
        page_size: Math.min(Math.max(Number(query.limit) || 20, 1), 100),
        ...(typeof query.cursor === 'string' && query.cursor.length < 2048 ? { start_cursor: query.cursor } : {}),
      }, {
        headers: { Authorization: `Bearer ${accessToken}`, 'Notion-Version': '2026-03-11' },
        timeout: 10000,
      })
      return { pages: data.results, next_cursor: data.next_cursor }
    },
  },
}

export const workspaceProviders: ConnectorDefinition[] = [slack, notion]
