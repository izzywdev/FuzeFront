import axios from 'axios'
import type { ConnectorDefinition } from '../connector-platform'

/** API-key providers require a separate credential-onboarding path from OAuth providers. */
export interface ApiKeyProviderDefinition {
  id: string
  name: string
  description: string
  credentialKind: 'api_key'
  credentialLabel: string
  actions: Record<string, (apiKey: string, query: Record<string, unknown>) => Promise<unknown>>
}

function pageSize(value: unknown): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 100) : 20
}

function pageToken(value: unknown): string | undefined {
  return typeof value === 'string' && value.length <= 2048 ? value : undefined
}

/** Gemini REST models.list uses an API key, not a user OAuth grant. */
export const geminiApiKeyProvider: ConnectorDefinition = {
  id: 'gemini',
  name: 'Gemini API',
  description: 'List models available to your Gemini API key.',
  authentication: 'api-key',
  identity: async apiKey => {
    await axios.get('https://generativelanguage.googleapis.com/v1beta/models', {
      headers: { 'x-goog-api-key': apiKey }, params: { pageSize: 1 }, timeout: 10000,
    })
    return 'Gemini API key'
  },
  actions: {
    models: async ({ accessToken: apiKey, query }) => {
      const { data } = await axios.get('https://generativelanguage.googleapis.com/v1beta/models', {
        headers: { 'x-goog-api-key': apiKey },
        params: { pageSize: pageSize(query.limit), pageToken: pageToken(query.page_token) },
        timeout: 10000,
      })
      return { items: data.models || [], nextPageToken: data.nextPageToken || null }
    },
  },
}

export const aiBuilderProviders: ConnectorDefinition[] = [geminiApiKeyProvider]

/**
 * Base44 publishes workspace API keys and a List apps API. Its documented SDK and
 * API transport differ from the OAuth connector contract. Register this descriptor
 * only once a workspace-key adapter verifies the published endpoint and headers.
 */
export const base44ApiKeyProvider: Omit<ApiKeyProviderDefinition, 'actions'> = {
  id: 'base44',
  name: 'Base44',
  description: 'Read apps in your Base44 workspace.',
  credentialKind: 'api_key',
  credentialLabel: 'Base44 workspace API key',
}
