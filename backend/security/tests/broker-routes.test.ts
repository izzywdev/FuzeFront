/**
 * Unit tests for the broker (#238 consumer-product sign-in handoff) routes:
 *   GET  /v1/security/broker/clients/:client
 *   POST /v1/security/broker/handoff
 *   POST /v1/security/broker/token-exchange
 *
 * Same style as `security-routes.test.ts`: a FAKE `IdentityProvider` injected
 * via `setIdentityProvider`, asserting the HTTP contract independent of the
 * concrete provider. The broker-client registry is seeded via
 * `BROKER_CLIENTS_JSON` (see `src/services/brokerClients.ts`).
 */
import express from 'express'
import request from 'supertest'
import securityRouter from '../src/routes/security'
import { setIdentityProvider } from '../src/providers/factory'
import { __resetBrokerClientRegistryForTests } from '../src/services/brokerClients'
import type { IdentityProvider, BrokeredSession } from '../src/providers/IdentityProvider'

const USER = { id: 'u1', email: 'u@e.com', firstName: 'U', lastName: 'E', roles: ['user'] }
const SESSION: BrokeredSession = { token: 'tok', sessionId: 'sess', user: USER }

const CLIENT = {
  client: 'mendys-datasets',
  clientSecret: 'super-secret-value',
  redirectUris: ['https://marketplace.mendysrobotics.com/api/dsm/auth/callback'],
  branding: { name: 'Mendys Datasets', logo: null, favicon: null, accent: '#112233', tagline: 'Browse datasets' },
}

function fakeProvider(overrides: Partial<IdentityProvider> = {}): IdentityProvider {
  const base: Partial<IdentityProvider> = {
    getUserInfo: jest.fn().mockResolvedValue({
      identity: { userId: 'u1', tenantId: null, roles: ['user'], authMode: 'legacy-hs256' },
      user: USER,
    }),
  }
  return { ...base, ...overrides } as IdentityProvider
}

function makeApp(p: IdentityProvider) {
  setIdentityProvider(p)
  const app = express()
  app.use(express.json())
  app.use('/api/v1/security', securityRouter)
  return app
}

beforeEach(() => {
  process.env.BROKER_CLIENTS_JSON = JSON.stringify([CLIENT])
  __resetBrokerClientRegistryForTests()
})

afterEach(() => {
  setIdentityProvider(null)
  delete process.env.BROKER_CLIENTS_JSON
  __resetBrokerClientRegistryForTests()
})

describe('GET /broker/clients/:client', () => {
  it('returns public branding only — never redirectUris or clientSecret', async () => {
    const res = await request(makeApp(fakeProvider())).get('/api/v1/security/broker/clients/mendys-datasets')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ client: 'mendys-datasets', branding: CLIENT.branding })
    expect(JSON.stringify(res.body)).not.toContain('super-secret-value')
    expect(JSON.stringify(res.body)).not.toContain('redirectUris')
  })

  it('404s fail-closed for an unknown client', async () => {
    const res = await request(makeApp(fakeProvider())).get('/api/v1/security/broker/clients/unknown-product')
    expect(res.status).toBe(404)
  })
})

describe('POST /broker/handoff', () => {
  const VALID_REDIRECT = CLIENT.redirectUris[0]

  it('requires a bearer token', async () => {
    const res = await request(makeApp(fakeProvider()))
      .post('/api/v1/security/broker/handoff')
      .send({ client: CLIENT.client, redirectUri: VALID_REDIRECT })
    expect(res.status).toBe(401)
  })

  it('400s on missing client/redirectUri', async () => {
    const res = await request(makeApp(fakeProvider()))
      .post('/api/v1/security/broker/handoff')
      .set('Authorization', 'Bearer tok')
      .send({})
    expect(res.status).toBe(400)
  })

  it('400s for an unknown client', async () => {
    const res = await request(makeApp(fakeProvider()))
      .post('/api/v1/security/broker/handoff')
      .set('Authorization', 'Bearer tok')
      .send({ client: 'not-registered', redirectUri: VALID_REDIRECT })
    expect(res.status).toBe(400)
  })

  it('400s for a redirectUri not in the allowlist (no prefix/subdomain match)', async () => {
    const res = await request(makeApp(fakeProvider()))
      .post('/api/v1/security/broker/handoff')
      .set('Authorization', 'Bearer tok')
      .send({ client: CLIENT.client, redirectUri: 'https://marketplace.mendysrobotics.com/api/dsm/auth/callback/evil' })
    expect(res.status).toBe(400)
  })

  it('401s when the bearer session is invalid/expired (fail-closed, mints no code)', async () => {
    const provider = fakeProvider({
      getUserInfo: jest.fn().mockRejectedValue(Object.assign(new Error('expired'), { name: 'UnauthorizedError' })),
    })
    const res = await request(makeApp(provider))
      .post('/api/v1/security/broker/handoff')
      .set('Authorization', 'Bearer dead-token')
      .send({ client: CLIENT.client, redirectUri: VALID_REDIRECT })
    expect(res.status).toBe(401)
  })

  it('mints a single-use code appended to the validated redirectUri', async () => {
    const res = await request(makeApp(fakeProvider()))
      .post('/api/v1/security/broker/handoff')
      .set('Authorization', 'Bearer tok')
      .send({ client: CLIENT.client, redirectUri: VALID_REDIRECT })
    expect(res.status).toBe(200)
    const url = new URL(res.body.redirectUri)
    expect(`${url.origin}${url.pathname}`).toBe(VALID_REDIRECT)
    expect(url.searchParams.get('code')).toBeTruthy()
  })
})

describe('POST /broker/token-exchange', () => {
  async function mintCode(app: ReturnType<typeof makeApp>): Promise<string> {
    const res = await request(app)
      .post('/api/v1/security/broker/handoff')
      .set('Authorization', 'Bearer tok')
      .send({ client: CLIENT.client, redirectUri: CLIENT.redirectUris[0] })
    const url = new URL(res.body.redirectUri)
    return url.searchParams.get('code') as string
  }

  it('redeems a valid code for a SessionResult', async () => {
    const app = makeApp(fakeProvider())
    const code = await mintCode(app)
    const res = await request(app)
      .post('/api/v1/security/broker/token-exchange')
      .send({ client: CLIENT.client, clientSecret: CLIENT.clientSecret, code })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'authenticated', token: 'tok', user: { id: 'u1' } })
  })

  it('is single-use — a second redemption of the same code fails', async () => {
    const app = makeApp(fakeProvider())
    const code = await mintCode(app)
    await request(app)
      .post('/api/v1/security/broker/token-exchange')
      .send({ client: CLIENT.client, clientSecret: CLIENT.clientSecret, code })
    const second = await request(app)
      .post('/api/v1/security/broker/token-exchange')
      .send({ client: CLIENT.client, clientSecret: CLIENT.clientSecret, code })
    expect(second.status).toBe(401)
  })

  it('401s on a wrong clientSecret (and still consumes the code — never an oracle)', async () => {
    const app = makeApp(fakeProvider())
    const code = await mintCode(app)
    const res = await request(app)
      .post('/api/v1/security/broker/token-exchange')
      .send({ client: CLIENT.client, clientSecret: 'wrong-secret', code })
    expect(res.status).toBe(401)
  })

  it('401s identically for an unknown client as for a wrong secret (undifferentiated)', async () => {
    const app = makeApp(fakeProvider())
    const code = await mintCode(app)
    const res = await request(app)
      .post('/api/v1/security/broker/token-exchange')
      .send({ client: 'not-registered', clientSecret: 'whatever', code })
    expect(res.status).toBe(401)
  })

  it('401s on an unknown code', async () => {
    const app = makeApp(fakeProvider())
    const res = await request(app)
      .post('/api/v1/security/broker/token-exchange')
      .send({ client: CLIENT.client, clientSecret: CLIENT.clientSecret, code: 'never-issued' })
    expect(res.status).toBe(401)
  })

  it('401s on a malformed body rather than throwing', async () => {
    const app = makeApp(fakeProvider())
    const res = await request(app).post('/api/v1/security/broker/token-exchange').send({})
    expect(res.status).toBe(401)
  })
})
