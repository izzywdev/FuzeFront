/** Shared connector transport. Provider implementations never receive user login tokens. */
import axios from 'axios'
import crypto from 'crypto'
import express, { Request, Response } from 'express'
import { createDelegationClient, createWorkloadAuthClient } from '@fuzefront/service-auth'
import { authenticateToken } from '../middleware/auth'
import { db } from '../config/database'

export interface ConnectorDefinition {
  id: string
  name: string
  description?: string
  authorizationUrl: string
  tokenUrl: string
  scopes: string[]
  clientIdEnv: string
  clientSecretEnv: string
  redirectUriEnv: string
  /** Resolve a display identity using the new access token; never persist this response. */
  identity?(accessToken: string): Promise<string>
  tokenIdentity?(token: Record<string, any>): Promise<string>
  buildAuthorizationParameters?(base: URLSearchParams): URLSearchParams
  exchangeCode?(code: string, verifier: string): Promise<Record<string, any>>
  refreshToken?(credential: Record<string, any>): Promise<Record<string, any>>
  supportsPkce?: boolean
  actions?: Record<string, (context: ConnectorActionContext) => Promise<unknown>>
  authorizationParameters?: Record<string, string>
  initialConfiguration?: Record<string, unknown>
}

export interface ConnectorActionContext {
  accessToken: string
  query: Record<string, unknown>
  configuration: Record<string, unknown>
}

export interface ConnectorPlatformOptions {
  fuzekeysUrl?: string
  securityUrl?: string
  frontendUrl?: string
  /** Required in multi-replica deployments: atomically consume a nonce across all replicas. */
  consumeNonce?: (nonce: string, expiresAt: number) => Promise<boolean>
}

/** The insert's unique constraint makes consumption atomic across API replicas. */
export async function consumeOAuthNonce(nonce: string, expiresAt: number): Promise<boolean> {
  if (!db) throw new Error('OAuth nonce database is unavailable')
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(nonce) || !Number.isSafeInteger(expiresAt) || expiresAt < Date.now() / 1000) return false
  const digest = crypto.createHash('sha256').update(nonce).digest('hex')
  // Expired entries remain until cleanup; never delete a duplicate before its original state expires.
  if (crypto.randomInt(128) === 0) await db('connector_oauth_nonces').where('expires_at', '<', new Date()).delete()
  const result = await db('connector_oauth_nonces').insert({ nonce_hash: digest, expires_at: new Date(expiresAt * 1000) })
    .onConflict('nonce_hash').ignore().returning('nonce_hash')
  return result.length === 1
}

function env(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not configured`)
  return value
}

function key(): Buffer {
  const raw = process.env.CONNECTOR_STATE_ENCRYPTION_KEY || ''
  if (raw.length < 32) throw new Error('CONNECTOR_STATE_ENCRYPTION_KEY must contain at least 32 characters')
  return crypto.createHash('sha256').update(raw).digest()
}

interface OAuthState {
  provider: string
  delegation: string
  verifier: string
  nonce: string
  exp: number
}

function seal(state: OAuthState): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv)
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(state)), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url')
}

function unseal(encoded: string): OAuthState {
  if (!encoded || encoded.length > 8192) throw new Error('Invalid OAuth state')
  const data = Buffer.from(encoded, 'base64url')
  if (data.length < 29) throw new Error('Invalid OAuth state')
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), data.subarray(0, 12))
  decipher.setAuthTag(data.subarray(12, 28))
  const state = JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString()) as OAuthState
  if (!state.provider || !state.delegation || !state.verifier || !state.nonce ||
      !Number.isSafeInteger(state.exp) || state.exp < Date.now() / 1000) throw new Error('Expired OAuth state')
  return state
}

function bearer(req: Request): string {
  const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '')
  if (!match) throw new Error('Missing bearer token')
  return match[1]
}

/** Generic metadata, OAuth and credential leasing for independently registered providers. */
export function createConnectorPlatformRouter(definitions: ConnectorDefinition[], options: ConnectorPlatformOptions = {}) {
  const router = express.Router()
  const byId = new Map(definitions.map(provider => [provider.id, provider]))
  if (byId.size !== definitions.length || definitions.some(provider => !/^[a-z][a-z0-9-]{1,63}$/.test(provider.id))) {
    throw new Error('Connector IDs must be unique lowercase slugs')
  }
  const keysUrl = (options.fuzekeysUrl || process.env.FUZEKEYS_URL || 'http://fuzekeys-backend:8000').replace(/\/+$/, '')
  const securityUrl = (options.securityUrl || process.env.FUZEFRONT_SECURITY_URL || 'http://fuzefront-security:3002').replace(/\/+$/, '')
  const workload = createWorkloadAuthClient({ baseUrl: securityUrl })
  const delegation = createDelegationClient({ baseUrl: securityUrl, serviceAuth: workload })
  const consume = options.consumeNonce || consumeOAuthNonce

  async function headers(subject: string, scopes: string[]) {
    const [serviceToken, delegated] = await Promise.all([
      workload.getToken(), delegation.exchange({ subjectToken: subject, audience: 'service:fuzekeys', scopes }),
    ])
    return { Authorization: `Bearer ${serviceToken}`, 'X-Fuze-Delegation': `Bearer ${delegated.accessToken}` }
  }

  async function refresh(provider: ConnectorDefinition, credential: Record<string, any>) {
    if (!credential.refresh_token) throw new Error('Connector reauthorization required')
    const updated = provider.refreshToken ? await provider.refreshToken(credential) : (await axios.post(provider.tokenUrl,
      new URLSearchParams({ grant_type: 'refresh_token', refresh_token: credential.refresh_token,
        client_id: env(provider.clientIdEnv), client_secret: env(provider.clientSecretEnv) }),
      { headers: { 'content-type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, timeout: 10000 })).data
    if (typeof updated.access_token !== 'string') throw new Error('Invalid refresh response')
    return { ...credential, ...updated, refresh_token: updated.refresh_token || credential.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + Number(updated.expires_in || 3600) }
  }

  async function proxy(req: Request, res: Response, method: 'GET' | 'PATCH' | 'DELETE') {
    try {
      const upstream = await axios.request({
        method, url: `${keysUrl}/api/v1/connectors/${req.params.provider}`,
        data: method === 'PATCH' ? req.body : undefined,
        headers: await headers(bearer(req), ['connectors:metadata']),
        timeout: 10000, validateStatus: () => true,
      })
      res.status(upstream.status).json(upstream.data)
    } catch {
      res.status(502).json({ error: 'Connector service unavailable' })
    }
  }

  router.get('/:provider/oauth/callback', async (req, res, next) => {
    if (!byId.has(req.params.provider)) return next('router')
    try {
      const provider = byId.get(req.params.provider)
      const state = unseal(String(req.query.state || ''))
      if (!provider || state.provider !== provider.id || typeof req.query.code !== 'string' || !req.query.code || req.query.error) {
        return res.status(400).json({ error: 'Invalid authorization response' })
      }
      if (!await consume(state.nonce, state.exp)) return res.status(400).json({ error: 'Authorization already used' })
      const tokenResponse = provider.exchangeCode ? null : await axios.post(provider.tokenUrl, new URLSearchParams({
        grant_type: 'authorization_code', code: req.query.code, client_id: env(provider.clientIdEnv),
        client_secret: env(provider.clientSecretEnv), redirect_uri: env(provider.redirectUriEnv), code_verifier: state.verifier,
      }), { headers: { 'content-type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, timeout: 10000 })
      const token = provider.exchangeCode ? await provider.exchangeCode(req.query.code, state.verifier) : tokenResponse!.data
      if (typeof token.access_token !== 'string') throw new Error('Missing access token')
      const identityEmail = provider.tokenIdentity ? await provider.tokenIdentity(token) : await provider.identity!(token.access_token)
      const credential = { ...token, ...(Number(token.expires_in) > 0 ? { expires_at: Math.floor(Date.now() / 1000) + Number(token.expires_in) } : {}) }
      await axios.put(`${keysUrl}/api/v1/connectors/${provider.id}/credential`, {
        credential, identity_email: identityEmail,
        scopes: typeof token.scope === 'string' ? token.scope.split(/[\s,]+/).filter(Boolean) : provider.scopes,
        configuration: provider.initialConfiguration || {},
      }, { headers: { Authorization: `Bearer ${await workload.getToken()}`, 'X-Fuze-Delegation': `Bearer ${state.delegation}` }, timeout: 10000 })
      const returnTo = new URL('/connectors', options.frontendUrl || process.env.FRONTEND_URL || 'http://localhost:5173')
      returnTo.searchParams.set('connected', provider.id)
      res.redirect(returnTo.toString())
    } catch {
      res.status(400).json({ error: 'Unable to complete connector authorization' })
    }
  })

  router.use((req, _res, next) => {
    if (req.path === '/catalog' || byId.has(req.path.split('/')[1])) return next()
    return next('router')
  })
  router.use(authenticateToken)

  router.get('/catalog', (_req, res) => {
    res.json({ connectors: definitions.map(({ id, name, description, clientIdEnv, clientSecretEnv, redirectUriEnv }) =>
      ({ id, name, description, configured: Boolean(process.env.CONNECTOR_STATE_ENCRYPTION_KEY &&
        process.env[clientIdEnv] && process.env[clientSecretEnv] && process.env[redirectUriEnv]) })) })
  })

  router.post('/:provider/connect', async (req, res) => {
    const provider = byId.get(req.params.provider)
    if (!provider) return res.status(404).json({ error: 'Unknown connector' })
    try {
      const continuation = await delegation.exchange({ subjectToken: bearer(req), audience: 'service:fuzekeys', scopes: ['connectors:credentials:write'] })
      const verifier = crypto.randomBytes(32).toString('base64url')
      const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')
      const state = seal({ provider: provider.id, delegation: continuation.accessToken, verifier,
        nonce: crypto.randomBytes(24).toString('base64url'), exp: Math.floor(Date.now() / 1000) + 300 })
      let params = new URLSearchParams({ client_id: env(provider.clientIdEnv), redirect_uri: env(provider.redirectUriEnv),
        response_type: 'code', scope: provider.scopes.join(' '), state, code_challenge: challenge, code_challenge_method: 'S256',
        ...provider.authorizationParameters })
      if (provider.supportsPkce === false) {
        params.delete('code_challenge')
        params.delete('code_challenge_method')
      }
      if (provider.buildAuthorizationParameters) params = provider.buildAuthorizationParameters(params)
      res.json({ authorization_url: `${provider.authorizationUrl}?${params}` })
    } catch {
      res.status(503).json({ error: 'Connector authorization unavailable' })
    }
  })

  router.get('/:provider/actions/:action', async (req, res) => {
    const provider = byId.get(req.params.provider)
    const action = provider?.actions?.[req.params.action]
    if (!action) return res.status(404).json({ error: 'Unknown connector action' })
    try {
      const delegated = await headers(bearer(req), ['connectors:credentials:read', 'connectors:credentials:write'])
      const lease = await axios.get(`${keysUrl}/api/v1/connectors/${provider!.id}/credential`, { headers: delegated, timeout: 10000 })
      let credential = lease.data.credential as Record<string, any>
      if (!credential || typeof credential.access_token !== 'string') throw new Error('Invalid credential')
      if (credential.expires_at && Number(credential.expires_at) <= Date.now() / 1000 + 60) {
        credential = await refresh(provider!, credential)
        await axios.put(`${keysUrl}/api/v1/connectors/${provider!.id}/credential`, { credential }, { headers: delegated, timeout: 10000 })
      }
      const result = await action({ accessToken: credential.access_token,
        query: req.query as Record<string, unknown>, configuration: lease.data.configuration || {} })
      res.json(result)
    } catch (error) {
      const upstream = axios.isAxiosError(error) ? error.response?.status : undefined
      res.status(upstream === 404 ? 404 : upstream === 429 ? 429 : 502)
        .json({ error: upstream === 404 ? 'Connector is not connected' : 'Unable to read connector' })
    }
  })

  router.get('/:provider', (req, res) => proxy(req, res, 'GET'))
  router.patch('/:provider', (req, res) => proxy(req, res, 'PATCH'))
  router.delete('/:provider', (req, res) => proxy(req, res, 'DELETE'))

  return router
}
