/** Shared connector transport. Provider implementations never receive user login tokens. */
import axios from 'axios'
import { credentialStoreOutcome } from './credential-outcome'
import { connectorResourceTenant } from './tenant'
import crypto from 'crypto'
import express, { Request, Response } from 'express'
import rateLimit from 'express-rate-limit'
import { createDelegationClient, createWorkloadAuthClient } from '@fuzefront/service-auth'
import { authenticateToken } from '../middleware/auth'
import { db } from '../config/database'
import { GOOGLE_CONNECTORS, googleAccountIdentity, requireGoogleBinding, requireGoogleScopes, refreshGoogleCredential, GoogleReauthorizationRequired } from './google-account'

interface ConnectorBase {
  id: string
  name: string
  description?: string
  /** Resolve a display identity using the new access token; never persist this response. */
  identity?(accessToken: string): Promise<string>
  actions?: Record<string, (context: ConnectorActionContext) => Promise<unknown>>
  initialConfiguration?: Record<string, unknown>
}

export interface OAuthConnectorDefinition extends ConnectorBase {
  authentication?: 'oauth'
  authorizationUrl: string
  tokenUrl: string
  scopes: string[]
  clientIdEnv: string
  clientSecretEnv: string
  redirectUriEnv: string
  tokenIdentity?(token: Record<string, any>): Promise<string>
  buildAuthorizationParameters?(base: URLSearchParams): URLSearchParams
  exchangeCode?(code: string, verifier: string): Promise<Record<string, any>>
  refreshToken?(credential: Record<string, any>): Promise<Record<string, any>>
  supportsPkce?: boolean
  authorizationParameters?: Record<string, string>
}

export interface ApiKeyConnectorDefinition extends ConnectorBase {
  authentication: 'api-key'
}

export type ConnectorDefinition = OAuthConnectorDefinition | ApiKeyConnectorDefinition

export interface ConnectorActionContext {
  accessToken: string
  query: Record<string, unknown>
  configuration: Record<string, unknown>
}

export interface ConnectorPlatformOptions {
  fuzekeysUrl?: string
  securityUrl?: string
  /** Explicit resource organization, matched to FuzeKeys authorization configuration. */
  resourceTenant?: string
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
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), data.subarray(0, 12), { authTagLength: 16 })
  decipher.setAuthTag(data.subarray(12, 28))
  const state = JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString()) as OAuthState
  if (!state.provider || !state.delegation || !state.verifier || !state.nonce ||
      !Number.isSafeInteger(state.exp) || state.exp < Date.now() / 1000) throw new Error('Expired OAuth state')
  return state
}

function bearer(req: Request): string {
  const header = req.headers.authorization || ''
  if (header.length > 8192 || header.slice(0, 7).toLowerCase() !== 'bearer ') throw new Error('Missing bearer token')
  const token = header.slice(7).trim()
  if (!token || /\s/.test(token)) throw new Error('Invalid bearer token')
  return token
}

/** Generic metadata, OAuth and credential leasing for independently registered providers. */
export function createConnectorPlatformRouter(definitions: ConnectorDefinition[], options: ConnectorPlatformOptions = {}) {
  const router = express.Router()
  const byId = new Map(definitions.map(provider => [provider.id, provider]))
  if (byId.size !== definitions.length || definitions.some(provider => !/^[a-z][a-z0-9-]{1,63}$/.test(provider.id))) {
    throw new Error('Connector IDs must be unique lowercase slugs')
  }
  const keysUrl = (options.fuzekeysUrl || process.env.FUZEKEYS_URL || 'http://fuzekeys-backend:8000').replace(/\/+$/, '')
  const metadataUrls = new Map(definitions.map(provider => [
    provider.id, `${keysUrl}/api/v1/connectors/${provider.id}`,
  ]))
  const securityUrl = (options.securityUrl || process.env.FUZEFRONT_SECURITY_URL || 'http://fuzefront-security:3002').replace(/\/+$/, '')
  const workload = createWorkloadAuthClient({ baseUrl: securityUrl })
  const delegation = createDelegationClient({ baseUrl: securityUrl, serviceAuth: workload })
  const consume = options.consumeNonce || consumeOAuthNonce
  const callbackLimit = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false })
  const authenticatedLimit = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false })

  async function headers(subject: string, scopes: string[]) {
    const tenant = connectorResourceTenant(options.resourceTenant)
    const [serviceToken, delegated] = await Promise.all([
      workload.getToken(), delegation.exchange({ subjectToken: subject, audience: 'service:fuzekeys', scopes, tenant }),
    ])
    return { Authorization: `Bearer ${serviceToken}`, 'X-Fuze-Delegation': `Bearer ${delegated.accessToken}` }
  }

  async function refresh(provider: OAuthConnectorDefinition, credential: Record<string, any>) {
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
    const upstreamUrl = metadataUrls.get(req.params.provider)
    if (!upstreamUrl) return res.status(404).json({ error: 'Unknown connector' })
    try {
      const upstream = await axios.request({
        method, url: upstreamUrl,
        data: method === 'PATCH' ? req.body : undefined,
        headers: await headers(bearer(req), ['connectors:metadata']),
        timeout: 10000, validateStatus: () => true,
      })
      res.status(upstream.status).json(upstream.data)
    } catch {
      res.status(502).json({ error: 'Connector service unavailable' })
    }
  }

  router.get('/:provider/oauth/callback', callbackLimit, async (req, res, next) => {
    const selected = byId.get(req.params.provider)
    if (!selected) return next('router')
    if (selected.authentication === 'api-key') return res.status(404).json({ error: 'OAuth is unavailable for this connector' })
    try {
      const provider = selected
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
      const googleAccount = GOOGLE_CONNECTORS.has(provider.id) ? await googleAccountIdentity(token.access_token, env(provider.clientIdEnv)) : undefined
      if (googleAccount) requireGoogleScopes(token, provider.scopes)
      const identityEmail = googleAccount?.email || (provider.tokenIdentity ? await provider.tokenIdentity(token) : await provider.identity!(token.access_token))
      const credential = { ...token, ...(Number(token.expires_in) > 0 ? { expires_at: Math.floor(Date.now() / 1000) + Number(token.expires_in) } : {}) }
      const stored = await axios.put(`${keysUrl}/api/v1/connectors/${encodeURIComponent(provider.id)}/credential`, {
        credential, identity_email: identityEmail,
        ...(googleAccount ? { google_identity: googleAccount.identity } : {}),
        scopes: typeof token.scope === 'string' ? token.scope.split(/[\s,]+/).filter(Boolean) : provider.scopes,
        configuration: provider.initialConfiguration || {},
      }, { headers: { Authorization: `Bearer ${await workload.getToken()}`, 'X-Fuze-Delegation': `Bearer ${state.delegation}` }, timeout: 10000 })
      const returnTo = new URL('/connectors', options.frontendUrl || process.env.FRONTEND_URL || 'http://localhost:5173')
      returnTo.searchParams.set(credentialStoreOutcome(stored), provider.id)
      res.redirect(returnTo.toString())
    } catch (error) {
      if (error instanceof GoogleReauthorizationRequired || (GOOGLE_CONNECTORS.has(req.params.provider) && axios.isAxiosError(error) && error.response?.status === 409)) {
        return res.status(409).json({ error: 'Google account authorization cannot be combined. Disconnect existing Google connectors and authorize the same Google account again.', code: 'GOOGLE_REAUTHORIZATION_REQUIRED' })
      }
      res.status(400).json({ error: 'Unable to complete connector authorization' })
    }
  })

  router.use((req, _res, next) => {
    if (req.path === '/catalog' || byId.has(req.path.split('/')[1])) return next()
    return next('router')
  })
  router.use(authenticatedLimit, authenticateToken)

  router.get('/catalog', (_req, res) => {
    res.json({ connectors: definitions.map(provider => ({
      id: provider.id, name: provider.name, description: provider.description,
      authentication: provider.authentication || 'oauth',
      configured: provider.authentication === 'api-key' || Boolean(process.env.CONNECTOR_STATE_ENCRYPTION_KEY &&
        process.env[provider.clientIdEnv] && process.env[provider.clientSecretEnv] && process.env[provider.redirectUriEnv]),
    })) })
  })

  router.post('/:provider/credential', async (req, res) => {
    const provider = byId.get(req.params.provider)
    if (!provider || provider.authentication !== 'api-key') return res.status(404).json({ error: 'Unknown API-key connector' })
    const secret = req.body?.api_key
    if (typeof secret !== 'string' || !secret.trim() || secret.length > 4096 || /[\r\n\0]/.test(secret)) {
      return res.status(400).json({ error: 'A valid API key is required' })
    }
    try {
      const delegatedHeaders = await headers(bearer(req), ['connectors:credentials:write'])
      const identityEmail = provider.identity ? await provider.identity(secret) : undefined
      if (identityEmail !== undefined && (typeof identityEmail !== 'string' || identityEmail.length > 320)) {
        throw new Error('Invalid connector identity')
      }
      const stored = await axios.put(`${keysUrl}/api/v1/connectors/${encodeURIComponent(provider.id)}/credential`, {
        credential: { access_token: secret }, identity_email: identityEmail,
        configuration: provider.initialConfiguration || {},
      }, { headers: delegatedHeaders, timeout: 10000 })
      const outcome = credentialStoreOutcome(stored)
      return res.status(outcome === 'authorization_pending' ? 202 : 201).json({ status: outcome, provider: provider.id,
        ...(outcome === 'authorization_pending' ? { retry_after_authorization: true } : {}) })
    } catch {
      return res.status(502).json({ error: 'Unable to validate or store connector credential' })
    }
  })

  router.post('/:provider/connect', authenticatedLimit, async (req, res) => {
    const provider = byId.get(req.params.provider)
    if (!provider) return res.status(404).json({ error: 'Unknown connector' })
    if (provider.authentication === 'api-key') return res.status(404).json({ error: 'OAuth is unavailable for this connector' })
    try {
      const continuation = await delegation.exchange({ subjectToken: bearer(req), audience: 'service:fuzekeys', scopes: ['connectors:credentials:write'], tenant: connectorResourceTenant(options.resourceTenant) })
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

  router.get('/:provider/actions/:action', authenticatedLimit, async (req, res) => {
    const provider = byId.get(req.params.provider)
    const action = provider?.actions?.[req.params.action]
    if (!action) return res.status(404).json({ error: 'Unknown connector action' })
    try {
      const delegated = await headers(bearer(req), ['connectors:credentials:read', 'connectors:credentials:write'])
      const lease = await axios.get(`${keysUrl}/api/v1/connectors/${encodeURIComponent(provider!.id)}/credential`, { headers: delegated, timeout: 10000 })
      let credential = lease.data.credential as Record<string, any>
      const googleProvider = provider!.authentication !== 'api-key' && GOOGLE_CONNECTORS.has(provider!.id) ? provider! : undefined
      const googleIdentity = googleProvider ? requireGoogleBinding(lease.data.google_identity, env(googleProvider.clientIdEnv)) : undefined
      if (!credential || typeof credential.access_token !== 'string') throw new Error('Invalid credential')
      if (provider!.authentication !== 'api-key' && (googleProvider ? Number(credential.expires_at || 0) <= Date.now() / 1000 + 60 : credential.expires_at && Number(credential.expires_at) <= Date.now() / 1000 + 60)) {
        credential = googleProvider ? await refreshGoogleCredential(credential, googleIdentity, env(googleProvider.clientIdEnv), env(googleProvider.clientSecretEnv), googleProvider.scopes) : await refresh(provider!, credential)
        await axios.put(`${keysUrl}/api/v1/connectors/${encodeURIComponent(provider!.id)}/credential`, { credential, ...(googleIdentity ? { google_identity: googleIdentity } : {}) }, { headers: delegated, timeout: 10000 })
      }
      if (googleProvider) requireGoogleScopes(credential, googleProvider.scopes)
      const result = await action({ accessToken: credential.access_token,
        query: req.query as Record<string, unknown>, configuration: lease.data.configuration || {} })
      res.json(result)
    } catch (error) {
      const upstream = axios.isAxiosError(error) ? error.response?.status : undefined
      if (error instanceof GoogleReauthorizationRequired || (GOOGLE_CONNECTORS.has(provider!.id) && upstream === 409)) return res.status(409).json({ error: 'Reconnect this Google connector using the same Google account to grant the required access.', code: 'GOOGLE_REAUTHORIZATION_REQUIRED' })
      res.status(upstream === 404 ? 404 : upstream === 429 ? 429 : 502)
        .json({ error: upstream === 404 ? 'Connector is not connected' : 'Unable to read connector' })
    }
  })

  router.get('/:provider', (req, res) => proxy(req, res, 'GET'))
  router.patch('/:provider', (req, res) => proxy(req, res, 'PATCH'))
  router.delete('/:provider', (req, res) => proxy(req, res, 'DELETE'))

  return router
}
