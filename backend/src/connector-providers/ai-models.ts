import axios from 'axios'
import crypto from 'crypto'
import type { ConnectorDefinition, ConnectorActionContext } from '../connector-platform'

/** These providers use user-supplied API keys, never OAuth. */

function inputString(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new Error(`${name} must be a nonempty string of at most ${maxLength} characters`)
  }
  return value
}

function key(context: ConnectorActionContext): string {
  // ConnectorActionContext.accessToken is the leased secret for API-key connectors.
  return inputString(context.accessToken, 'api_key', 4096)
}

async function openaiModels(context: ConnectorActionContext): Promise<unknown> {
  const response = await axios.get('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${key(context)}` }, timeout: 15000, maxContentLength: 1024 * 1024,
  })
  return response.data
}

async function anthropicModels(context: ConnectorActionContext): Promise<unknown> {
  const response = await axios.get('https://api.anthropic.com/v1/models', {
    headers: { 'x-api-key': key(context), 'anthropic-version': '2023-06-01' },
    params: { limit: 100 }, timeout: 15000, maxContentLength: 1024 * 1024,
  })
  return response.data
}

export const aiModelProviders: ConnectorDefinition[] = [
  {
    id: 'openai', name: 'OpenAI', description: 'List models available to the supplied API key',
    authentication: 'api-key',
    identity: async accessToken => {
      await openaiModels({ accessToken, query: {}, configuration: {} })
      return `OpenAI key ${crypto.createHash('sha256').update(accessToken).digest('hex').slice(0, 12)}`
    },
    actions: { models: openaiModels },
  },
  {
    id: 'anthropic', name: 'Anthropic', description: 'List Claude models available to the supplied API key',
    authentication: 'api-key',
    identity: async accessToken => {
      await anthropicModels({ accessToken, query: {}, configuration: {} })
      return `Anthropic key ${crypto.createHash('sha256').update(accessToken).digest('hex').slice(0, 12)}`
    },
    actions: { models: anthropicModels },
  },
]
