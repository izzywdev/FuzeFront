/** Read-only project management connectors. Credentials remain in the shared vault. */
import axios from 'axios'
import type { ConnectorDefinition } from '../connector-platform'

const linearGraphql = 'https://api.linear.app/graphql'
const trelloApi = 'https://api.trello.com/1'

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not configured`)
  return value
}

function boundedLimit(value: unknown, fallback = 25): number {
  const limit = value === undefined ? fallback : Number(value)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new Error('Invalid limit')
  return limit
}

function boundedCursor(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !value || value.length > 512) throw new Error('Invalid cursor')
  return value
}

async function linearQuery<T>(accessToken: string, query: string, variables?: Record<string, unknown>): Promise<T> {
  const { data } = await axios.post<{ data?: T; errors?: unknown[] }>(linearGraphql, { query, variables }, {
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    timeout: 10000,
  })
  if (data.errors?.length || !data.data) throw new Error('Linear request failed')
  return data.data
}

const linear: ConnectorDefinition = {
  id: 'linear',
  name: 'Linear',
  description: 'Read issues and teams visible to the connected Linear user.',
  authorizationUrl: 'https://linear.app/oauth/authorize',
  tokenUrl: 'https://api.linear.app/oauth/token',
  scopes: ['read'],
  clientIdEnv: 'LINEAR_CONNECTOR_CLIENT_ID',
  clientSecretEnv: 'LINEAR_CONNECTOR_CLIENT_SECRET',
  redirectUriEnv: 'LINEAR_CONNECTOR_REDIRECT_URI',
  supportsPkce: true,
  buildAuthorizationParameters(base) {
    base.set('scope', this.scopes.join(','))
    return base
  },
  async identity(accessToken) {
    const result = await linearQuery<{ viewer: { id: string } }>(accessToken, '{ viewer { id } }')
    if (!result.viewer?.id) throw new Error('Linear identity unavailable')
    return result.viewer.id
  },
  actions: {
    async issues({ accessToken, query }) {
      const data = await linearQuery<{ issues: unknown }>(accessToken,
        'query ConnectorIssues($first: Int!, $after: String) { issues(first: $first, after: $after) { nodes { id identifier title url updatedAt } pageInfo { hasNextPage endCursor } } }',
        { first: boundedLimit(query.limit), after: boundedCursor(query.cursor) })
      return data.issues
    },
    async teams({ accessToken, query }) {
      const data = await linearQuery<{ teams: unknown }>(accessToken,
        'query ConnectorTeams($first: Int!, $after: String) { teams(first: $first, after: $after) { nodes { id key name } pageInfo { hasNextPage endCursor } } }',
        { first: boundedLimit(query.limit), after: boundedCursor(query.cursor) })
      return data.teams
    },
  },
}

const trello: ConnectorDefinition = {
  id: 'trello',
  name: 'Trello',
  description: 'Read boards and cards available to the connected Trello user.',
  authorizationUrl: 'https://auth.atlassian.com/authorize',
  tokenUrl: 'https://auth.atlassian.com/oauth/token',
  scopes: ['read:member:trello', 'read:board:trello', 'offline_access'],
  clientIdEnv: 'TRELLO_CONNECTOR_CLIENT_ID',
  clientSecretEnv: 'TRELLO_CONNECTOR_CLIENT_SECRET',
  redirectUriEnv: 'TRELLO_CONNECTOR_REDIRECT_URI',
  supportsPkce: true,
  authorizationParameters: { prompt: 'consent' },
  async exchangeCode(code, verifier) {
    const { data } = await axios.post(this.tokenUrl, {
      grant_type: 'authorization_code', code, code_verifier: verifier,
      client_id: required(this.clientIdEnv), client_secret: required(this.clientSecretEnv),
      redirect_uri: required(this.redirectUriEnv),
    }, { headers: { 'Content-Type': 'application/json' }, timeout: 10000 })
    return data
  },
  async refreshToken(credential) {
    const { data } = await axios.post(this.tokenUrl, {
      grant_type: 'refresh_token', refresh_token: credential.refresh_token,
      client_id: required(this.clientIdEnv), client_secret: required(this.clientSecretEnv),
    }, { headers: { 'Content-Type': 'application/json' }, timeout: 10000 })
    return data
  },
  async identity(accessToken) {
    const { data } = await axios.get<{ id: string }>(`${trelloApi}/members/me`, {
      headers: { Authorization: `Bearer ${accessToken}` }, params: { fields: 'id' }, timeout: 10000,
    })
    if (!data.id) throw new Error('Trello identity unavailable')
    return data.id
  },
  actions: {
    async boards({ accessToken, query }) {
      const { data } = await axios.get<unknown[]>(`${trelloApi}/members/me/boards`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { fields: 'id,name,url,closed,dateLastActivity', filter: 'open' }, timeout: 10000,
      })
      const limit = boundedLimit(query.limit)
      const offset = query.offset === undefined ? 0 : Number(query.offset)
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10000) throw new Error('Invalid offset')
      return { boards: data.slice(offset, offset + limit), next_offset: offset + limit < data.length ? offset + limit : null }
    },
    async card({ accessToken, query }) {
      if (typeof query.id !== 'string' || !/^[a-fA-F0-9]{24}$/.test(query.id)) throw new Error('Invalid Trello card ID')
      const { data } = await axios.get(`${trelloApi}/cards/${query.id}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { fields: 'id,idBoard,name,desc,url,due,dateLastActivity,closed' }, timeout: 10000,
      })
      return data
    },
  },
}

export const projectToolProviders: ConnectorDefinition[] = [linear, trello]
