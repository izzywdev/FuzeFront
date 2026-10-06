import express, { Request, Response } from 'express'
import { connectorResourceTenant } from '../connector-platform/tenant'
import axios, { AxiosError, Method } from 'axios'
import crypto from 'crypto'
import { googleAccountIdentity, requireGoogleBinding, requireGoogleScopes, refreshGoogleCredential, GoogleReauthorizationRequired } from '../connector-platform/google-account'
import { createDelegationClient, createMachineTokenVerifier, createWorkloadAuthClient, requireDelegatedAuth } from '@fuzefront/service-auth'
import { authenticateToken } from '../middleware/auth'

const router = express.Router()
const FUZEKEYS_URL = (process.env.FUZEKEYS_URL || 'http://fuzekeys-backend:8000').replace(/\/+$/, '')
const SECURITY_URL = (process.env.FUZEFRONT_SECURITY_URL || 'http://fuzefront-security:3002').replace(/\/+$/, '')
const workloadAuth = createWorkloadAuthClient({ baseUrl: SECURITY_URL })
const delegation = createDelegationClient({ baseUrl: SECURITY_URL, serviceAuth: workloadAuth })
const verifier = createMachineTokenVerifier({ baseUrl: SECURITY_URL })
const GOOGLE_SCOPES = ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/gmail.readonly']

const requireChatDelegation = requireDelegatedAuth({
  verifier,
  audience: 'service:fuzefront-backend',
  requiredScopes: ['connectors:gmail:read'],
})

function userBearer(req: Request): string {
  const value = req.headers.authorization || ''
  return value.toLowerCase().startsWith('bearer ') ? value.slice(7) : ''
}

async function delegatedHeaders(req: Request, scopes: string[], subjectToken = userBearer(req)) {
  return delegatedHeadersForSubject(subjectToken, scopes)
}

async function delegatedHeadersForSubject(subjectToken: string, scopes: string[]) {
  const tenant = connectorResourceTenant()
  const serviceToken = await workloadAuth.getToken()
  const delegated = await delegation.exchange({ subjectToken, audience: 'service:fuzekeys', scopes, tenant })
  return { Authorization: `Bearer ${serviceToken}`, 'X-Fuze-Delegation': `Bearer ${delegated.accessToken}` }
}

function delegationBearer(req: Request): string {
  const value = String(req.headers['x-fuze-delegation'] || '')
  return value.toLowerCase().startsWith('bearer ') ? value.slice(7) : ''
}

async function forward(req: Request, res: Response, method: Method, suffix: string, body?: unknown) {
  try {
    const upstream = await axios.request({
      method, url: `${FUZEKEYS_URL}/api/v1/connectors/google-gmail${suffix}`,
      data: body, params: method === 'GET' ? req.query : undefined,
      timeout: 30000, validateStatus: () => true,
      headers: await delegatedHeaders(req, ['connectors:metadata']),
    })
    res.status(upstream.status).json(upstream.data)
  } catch (error) {
    res.status(502).json({ error: 'FuzeKeys is unavailable', code: (error as AxiosError).code || 'EUPSTREAM' })
  }
}

async function googleForm(url: string, data: Record<string, string>) {
  return (await axios.post(url, new URLSearchParams(data), { headers: { 'content-type': 'application/x-www-form-urlencoded' } })).data
}

function header(headers: Array<{ name?: string; value?: string }>, name: string) {
  return headers.find(item => item.name?.toLowerCase() === name.toLowerCase())?.value || ''
}

function googleOAuthConfig() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID || ''
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET || ''
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI || ''
  if (!clientId || !clientSecret || !redirectUri) throw new Error('Google OAuth is not configured')
  return { clientId, clientSecret, redirectUri }
}

function stateKey(): Buffer {
  const raw = process.env.CONNECTOR_STATE_ENCRYPTION_KEY || process.env.JWT_SECRET || ''
  if (raw.length < 32) throw new Error('Connector state encryption key is not configured')
  return crypto.createHash('sha256').update(raw).digest()
}

function sealState(payload: Record<string, unknown>): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', stateKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload)), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url')
}

function openState(value: string): { subjectToken: string; returnTo: string; exp: number } {
  const packed = Buffer.from(value, 'base64url')
  if (packed.length < 29) throw new Error('Invalid OAuth state')
  const decipher = crypto.createDecipheriv('aes-256-gcm', stateKey(), packed.subarray(0, 12))
  decipher.setAuthTag(packed.subarray(12, 28))
  const payload = JSON.parse(Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString())
  if (!payload.subjectToken || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) throw new Error('Expired OAuth state')
  return payload
}

router.get('/google-gmail/oauth/callback', async (req, res) => {
  try {
    const code = String(req.query.code || '')
    const state = openState(String(req.query.state || ''))
    if (!code) return res.status(400).json({ error: 'Missing OAuth code' })
    const oauth = googleOAuthConfig()
    const token = await googleForm('https://oauth2.googleapis.com/token', {
      code, client_id: oauth.clientId, client_secret: oauth.clientSecret,
      redirect_uri: oauth.redirectUri, grant_type: 'authorization_code',
    })
    const account = await googleAccountIdentity(token.access_token, oauth.clientId)
    requireGoogleScopes(token, GOOGLE_SCOPES)
    const credential = { ...token, expires_at: Math.floor(Date.now() / 1000) + Number(token.expires_in || 3600) }
    const headers = {
      Authorization: `Bearer ${await workloadAuth.getToken()}`,
      'X-Fuze-Delegation': `Bearer ${state.subjectToken}`,
    }
    await axios.put(`${FUZEKEYS_URL}/api/v1/connectors/google-gmail/credential`, {
      credential,
      identity_email: account.email,
      google_identity: account.identity,
      scopes: String(token.scope || '').split(/\s+/).filter(Boolean),
      configuration: { query: 'in:inbox', include_spam_trash: false },
    }, { headers, timeout: 5000 })
    const separator = state.returnTo.includes('?') ? '&' : '?'
    res.redirect(`${state.returnTo}${separator}connected=google-gmail`)
  } catch (error) {
    if (error instanceof GoogleReauthorizationRequired || (axios.isAxiosError(error) && error.response?.status === 409)) {
      return res.status(409).json({ error: 'Google account authorization cannot be combined. Disconnect existing Google connectors and authorize the same Google account again.', code: 'GOOGLE_REAUTHORIZATION_REQUIRED' })
    }
    res.status(400).json({ error: 'Unable to complete Google authorization' })
  }
})

router.get('/google-gmail/messages/recent', requireChatDelegation, async (req, res) => {
  try {
    const headers = await delegatedHeaders(req, ['connectors:credentials:read', 'connectors:credentials:write'], delegationBearer(req))
    const leased = await axios.get(`${FUZEKEYS_URL}/api/v1/connectors/google-gmail/credential`, { headers, timeout: 5000 })
    let credential = leased.data.credential as Record<string, any>
    const oauth = googleOAuthConfig()
    const identity = requireGoogleBinding(leased.data.google_identity, oauth.clientId)
    if (Number(credential.expires_at || 0) <= Math.floor(Date.now() / 1000) + 60) {
      credential = await refreshGoogleCredential(credential, identity, oauth.clientId, oauth.clientSecret, GOOGLE_SCOPES)
      await axios.put(`${FUZEKEYS_URL}/api/v1/connectors/google-gmail/credential`, { credential, google_identity: identity }, { headers, timeout: 5000 })
    }
    requireGoogleScopes(credential, GOOGLE_SCOPES)
    const config = leased.data.configuration || {}
    const limit = Math.min(Number(req.query.limit) || 5, 20)
    const listing = await axios.get('https://gmail.googleapis.com/gmail/v1/users/me/messages', {
      headers: { Authorization: `Bearer ${credential.access_token}` },
      params: { maxResults: limit, q: config.query || 'in:inbox', includeSpamTrash: !!config.include_spam_trash },
    })
    const messages = await Promise.all((listing.data.messages || []).slice(0, limit).map(async (item: { id: string }) => {
      const detail = await axios.get(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${item.id}`, {
        headers: { Authorization: `Bearer ${credential.access_token}` },
        params: { format: 'metadata', metadataHeaders: ['From', 'Subject', 'Date'] },
      })
      const hs = detail.data.payload?.headers || []
      return { id: detail.data.id, thread_id: detail.data.threadId, from: header(hs, 'From'), subject: header(hs, 'Subject') || '(no subject)', date: header(hs, 'Date'), snippet: detail.data.snippet || '' }
    }))
    res.json({ identity_email: leased.data.identity_email, messages })
  } catch (error) {
    if (error instanceof GoogleReauthorizationRequired || (error as AxiosError).response?.status === 409) return res.status(409).json({ error: 'Reconnect Gmail using the same Google account to grant mail access.', code: 'GOOGLE_REAUTHORIZATION_REQUIRED' })
    const status = (error as AxiosError).response?.status || 502
    res.status(status).json({ error: 'Unable to read Gmail', code: (error as AxiosError).code || 'EUPSTREAM' })
  }
})

router.use(authenticateToken)

router.get('/google-gmail', (req, res) => forward(req, res, 'GET', ''))
router.patch('/google-gmail', (req, res) => forward(req, res, 'PATCH', '', req.body))
router.delete('/google-gmail', (req, res) => forward(req, res, 'DELETE', ''))
router.post('/google-gmail/connect', async (req, res) => {
  const returnTo = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/connectors`
  try {
    const oauth = googleOAuthConfig()
    const continuation = await delegation.exchange({
      subjectToken: userBearer(req),
      audience: 'service:fuzekeys',
      scopes: ['connectors:credentials:write'],
      tenant: connectorResourceTenant(),
    })
    const state = sealState({ subjectToken: continuation.accessToken, returnTo, exp: Math.floor(Date.now() / 1000) + 300 })
    const params = new URLSearchParams({
      client_id: oauth.clientId,
      redirect_uri: oauth.redirectUri,
      response_type: 'code',
      scope: GOOGLE_SCOPES.join(' '),
      access_type: 'offline',
      include_granted_scopes: 'true',
      prompt: 'consent',
      state,
    })
    res.json({ authorization_url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` })
  } catch {
    res.status(503).json({ error: 'Google OAuth is not configured' })
  }
})

export default router
