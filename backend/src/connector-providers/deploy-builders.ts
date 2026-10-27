import axios from 'axios'
import type { ConnectorDefinition } from '../connector-platform'

function boundedLimit(raw: unknown, maximum = 100): number {
  const value = raw === undefined ? 25 : Number(raw)
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error('Invalid limit')
  return value
}

function boundedString(raw: unknown, name: string, max = 512): string | undefined {
  if (raw === undefined) return undefined
  if (typeof raw !== 'string' || raw.length < 1 || raw.length > max) throw new Error(`Invalid ${name}`)
  return raw
}

function vercelHeaders(token: string) {
  return { Authorization: `Bearer ${token}`, Accept: 'application/json' }
}

function lovableHeaders(key: string) {
  return { 'Lovable-API-Key': key, 'Lovable-Version': '2026-09-11', Accept: 'application/json' }
}

/** Manual provider tokens are stored in FuzeKeys and never exposed to the frontend. */
export const deployBuilderProviders: ConnectorDefinition[] = [
  {
    id: 'vercel', name: 'Vercel', description: 'Read Vercel projects and deployments with a Vercel access token.',
    authentication: 'api-key',
    async identity(token) {
      const { data } = await axios.get<{ user?: { email?: string; username?: string } }>('https://api.vercel.com/v2/user', {
        headers: vercelHeaders(token), timeout: 10000, maxRedirects: 0,
      })
      const name = data.user?.email || data.user?.username
      if (!name || name.length > 320) throw new Error('Vercel user unavailable')
      return name
    },
    actions: {
      async projects({ accessToken, query }) {
        const teamId = boundedString(query.teamId, 'teamId', 128)
        const until = boundedString(query.until, 'until', 32)
        const { data } = await axios.get('https://api.vercel.com/v9/projects', {
          headers: vercelHeaders(accessToken), params: { limit: boundedLimit(query.limit), ...(teamId ? { teamId } : {}),
            ...(until ? { until } : {}) }, timeout: 10000, maxRedirects: 0,
        })
        return data
      },
      async deployments({ accessToken, query }) {
        const teamId = boundedString(query.teamId, 'teamId', 128)
        const projectId = boundedString(query.projectId, 'projectId', 128)
        const until = boundedString(query.until, 'until', 32)
        const { data } = await axios.get('https://api.vercel.com/v6/deployments', {
          headers: vercelHeaders(accessToken), params: { limit: boundedLimit(query.limit), ...(teamId ? { teamId } : {}),
            ...(projectId ? { projectId } : {}), ...(until ? { until } : {}) }, timeout: 10000, maxRedirects: 0,
        })
        return data
      },
    },
  },
  {
    id: 'lovable', name: 'Lovable', description: 'Read Lovable workspaces and projects with a workspace API key.',
    authentication: 'api-key',
    async identity(key) {
      if (!key.startsWith('lov_')) throw new Error('Invalid Lovable API key')
      const { data } = await axios.get<{ data?: Array<{ id?: string }> }>('https://api.lovable.dev/v1/workspaces', {
        headers: lovableHeaders(key), timeout: 10000, maxRedirects: 0,
      })
      const id = data.data?.[0]?.id
      if (!id || id.length > 256) throw new Error('Lovable workspace unavailable')
      return id
    },
    actions: {
      async workspaces({ accessToken }) {
        const { data } = await axios.get('https://api.lovable.dev/v1/workspaces', {
          headers: lovableHeaders(accessToken), timeout: 10000, maxRedirects: 0,
        })
        return data
      },
      async projects({ accessToken, query }) {
        const workspaceId = boundedString(query.workspaceId, 'workspaceId', 128)
        if (!workspaceId) throw new Error('workspaceId is required')
        const cursor = boundedString(query.cursor, 'cursor', 2048)
        const { data } = await axios.get('https://api.lovable.dev/v1/projects', {
          headers: lovableHeaders(accessToken), params: { workspace_id: workspaceId,
            ...(cursor ? { cursor } : {}), limit: boundedLimit(query.limit, 100) },
          timeout: 10000, maxRedirects: 0,
        })
        return data
      },
    },
  },
]
